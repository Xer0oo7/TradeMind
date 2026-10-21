"""
Voice Call Handler — AI Call Agent Architecture

Inspired by production AI call platforms (Vapi, Retell, Bland AI):
  ┌────────────┐    ┌──────────┐    ┌────────────┐    ┌───────────┐
  │ User Audio  │───▶│ STT (ASR)│───▶│ LLM / NLU  │───▶│ TTS (Speak)│
  └────────────┘    └──────────┘    └────────────┘    └───────────┘
        ▲                                                    │
        │               ┌──────────────┐                     │
        └───────────────│ Client Audio  │◀────────────────────┘
                        └──────────────┘

Key design principles:
  1. UTTERANCE QUEUE — Transcript batching with debounce timer. Short
     silence windows accumulate words before sending to LLM. Prevents
     split-word issues and reduces LLM calls.
  2. ASYNC PIPELINE — STT, LLM, TTS run as decoupled async stages
     connected by asyncio.Queue. Each stage can be interrupted independently.
  3. LLM TIMEOUT — Every LLM call has a hard timeout (12s). If exceeded,
     the processing lock releases and a retry-prompt is spoken.
  4. SMART FILLER FILTER — Recognises filler words but NEVER drops anything
     that looks like a price (digits, dollar signs, number words).
  5. BARGE-IN — User speech during AI playback immediately cancels TTS,
     drains queues, and processes the new user input.
  6. SENTENCE-LEVEL TTS — AI response is split into sentences; first
     sentence goes to TTS immediately while rest are queued.
  7. TURN MANAGEMENT — Explicit state machine: LISTENING → PROCESSING → SPEAKING
     with proper transitions and guards.
"""
import asyncio
import base64
import json
import re
import time
from enum import Enum
from typing import Optional
from uuid import UUID

import structlog

from ..core.config import get_settings
from ..core.engine import NegotiationEngine
from ..models import ChatMessage
from .sarvam_service import SarvamSTTStream, SarvamTTSStream, sarvam_tts_rest

logger = structlog.get_logger(__name__)
settings = get_settings()

# ── Configuration ────────────────────────────────────────────────
MAX_AUDIO_CHUNK_B64 = 90_000       # Cap base64 chunk size (~64KB decoded)
SILENCE_TIMEOUT_S = 1.5            # STT flush after this much silence
LLM_TIMEOUT_S = 12.0               # Hard timeout for LLM calls
UTTERANCE_DEBOUNCE_S = 0.9         # Wait after last transcript before processing
                                    # (allows user to finish multi-word price offers)


# ── Turn State Machine ──────────────────────────────────────────
class TurnState(str, Enum):
    LISTENING = "listening"        # Waiting for user speech
    PROCESSING = "processing"      # LLM is thinking
    SPEAKING = "speaking"          # AI is talking via TTS


# ── Filler Detection ────────────────────────────────────────────
_FILLER_WORDS = frozenset({
    "hmm", "hm", "um", "uh", "uhm", "ah", "oh",
    "mmm", "mhm", "mmhmm", "uh huh", "huh",
    "so", "well", "like", "in the", "uh the", "the", "a",
    "go on", "continue",
})

# Words that indicate a price — NEVER filter these
_PRICE_WORDS = frozenset({
    "dollar", "dollars", "bucks", "cents", "rupee", "rupees",
    "ten", "twenty", "thirty", "forty", "fifty", "sixty",
    "seventy", "eighty", "ninety", "hundred", "thousand",
    "one", "two", "three", "four", "five", "six", "seven",
    "eight", "nine", "zero", "eleven", "twelve",
    "offer", "bid", "price", "pay", "cost", "budget",
    "deal", "discount", "half", "quarter",
})

_HAS_DIGIT = re.compile(r'\d')
_HAS_CURRENCY = re.compile(r'[$₹]')


def _is_filler(text: str) -> bool:
    """
    Check if text is just filler/noise that shouldn't trigger a response.

    CRITICAL: Never filter anything that looks like a price offer.
    """
    cleaned = text.lower().strip().rstrip('.!?,;:')

    # NEVER filter if it contains digits or currency signs
    if _HAS_DIGIT.search(cleaned) or _HAS_CURRENCY.search(cleaned):
        return False

    # NEVER filter if it contains price-related words
    words_set = set(cleaned.split())
    if words_set & _PRICE_WORDS:
        return False

    # Known filler words
    if cleaned in _FILLER_WORDS:
        return True

    # Very short (1-2 words, < 5 chars) AND not containing price signals
    words = cleaned.split()
    if len(words) <= 2 and len(cleaned) < 5:
        return True

    return False


# ── Sentence Splitting ──────────────────────────────────────────
_SENTENCE_RE = re.compile(r'(?<=[.!?])\s+|(?<=\n)')


def _split_sentences(text: str) -> list[str]:
    """Split text into sentence chunks for streaming TTS."""
    parts = _SENTENCE_RE.split(text.strip())
    merged = []
    for p in parts:
        p = p.strip()
        if not p:
            continue
        if merged and len(merged[-1]) < 20:
            merged[-1] = merged[-1] + " " + p
        else:
            merged.append(p)
    return merged if merged else [text.strip()]


# ═════════════════════════════════════════════════════════════════
# VOICE CALL HANDLER
# ═════════════════════════════════════════════════════════════════

class VoiceCallHandler:
    """
    AI Call Agent — manages a single voice negotiation session.

    Architecture (like Vapi/Retell):
      - Three async pipeline stages: STT -> LLM -> TTS
      - Utterance debouncing: collects words before sending to LLM
      - Hard LLM timeout: prevents stuck calls
      - Smart barge-in: user can interrupt AI at any time
      - Explicit turn state machine with clean transitions
    """

    def __init__(self, session_id: str, client_ws):
        self.session_id = session_id
        self.client_ws = client_ws
        self.engine = NegotiationEngine()

        # Sarvam streams
        self.stt = SarvamSTTStream(language=settings.sarvam_language)
        self.tts = SarvamTTSStream(
            language=settings.sarvam_language,
            speaker=settings.sarvam_tts_speaker,
        )

        # Turn state
        self.turn_state = TurnState.LISTENING
        self.is_active = False
        self.call_start_time = None

        # Pipeline queues
        self._tts_queue: asyncio.Queue[str | None] = asyncio.Queue()
        self._interrupt_event = asyncio.Event()

        # Utterance buffer (debounce multiple STT transcripts into one)
        self._utterance_buffer: list[str] = []
        self._utterance_timer: Optional[asyncio.Task] = None
        self._utterance_lock = asyncio.Lock()

        # REST TTS is default (complete WAV files = reliable playback)
        self._use_rest_tts = True

        # Silence tracking
        self._last_audio_ts = 0.0
        self._silence_flushed = False  # Prevent repeated flushes

        # Tasks
        self._tasks: list[asyncio.Task] = []

    # ── Lifecycle ────────────────────────────────────────────────

    async def start(self):
        """Initialize connections and run the call loop."""
        self.is_active = True
        self.call_start_time = time.time()
        self._last_audio_ts = time.time()

        await self._send_client({
            "type": "status",
            "status": "connecting",
            "message": "Setting up voice connection...",
        })

        # Connect STT
        try:
            await self.stt.connect()
        except Exception as e:
            await self._send_client({
                "type": "error",
                "message": f"Failed to connect to speech recognition: {e}",
            })
            return

        logger.info("voice_call_started", session=self.session_id, tts_mode="rest")

        await self._set_turn(TurnState.LISTENING, "Connected! Start speaking...")

        try:
            self._tasks = [
                asyncio.create_task(self._stt_receive_loop(), name="stt_rx"),
                asyncio.create_task(self._tts_send_loop(), name="tts_tx"),
                asyncio.create_task(self._silence_monitor(), name="silence"),
            ]
            await asyncio.gather(*self._tasks, return_exceptions=True)
        except Exception as e:
            logger.error("voice_call_error", error=str(e))
        finally:
            await self.cleanup()

    async def handle_client_message(self, raw_message: str):
        """Process a message from the client WebSocket."""
        try:
            msg = json.loads(raw_message)
            msg_type = msg.get("type", "")

            if msg_type == "audio":
                audio_b64 = msg.get("data", "")
                if not audio_b64 or len(audio_b64) > MAX_AUDIO_CHUNK_B64:
                    return

                audio_bytes = base64.b64decode(audio_b64)
                self._last_audio_ts = time.time()
                self._silence_flushed = False  # Reset since we got audio

                await self.stt.send_audio(audio_bytes)

                # Barge-in: user speaking during AI playback
                if self.turn_state == TurnState.SPEAKING:
                    await self._handle_interrupt()

            elif msg_type == "end_call":
                self.is_active = False
                for task in self._tasks:
                    task.cancel()

            elif msg_type == "flush":
                await self.stt.flush()

            elif msg_type == "ping":
                await self._send_client({
                    "type": "pong",
                    "ts": int(time.time() * 1000),
                })

        except json.JSONDecodeError:
            logger.warning("invalid_client_message")
        except Exception as e:
            logger.error("client_message_error", error=str(e))

    async def cleanup(self):
        """Clean up all resources."""
        self.is_active = False

        # Cancel utterance timer
        if self._utterance_timer and not self._utterance_timer.done():
            self._utterance_timer.cancel()

        for task in self._tasks:
            if not task.done():
                task.cancel()

        await self.stt.close()
        await self.tts.close()

        logger.info(
            "voice_call_ended",
            session=self.session_id,
            duration_s=round(time.time() - self.call_start_time, 1) if self.call_start_time else 0,
        )

    # ── Turn State Machine ──────────────────────────────────────

    async def _set_turn(self, state: TurnState, message: str = ""):
        """Transition the turn state and notify the client."""
        self.turn_state = state
        payload = {"type": "status", "status": state.value}
        if message:
            payload["message"] = message
        await self._send_client(payload)

    # ── Stage 1: STT Receive ────────────────────────────────────

    async def _stt_receive_loop(self):
        """
        Read transcripts from Sarvam STT.

        Instead of processing each transcript immediately, we buffer them
        with a debounce timer. This prevents split-word issues where
        "fifty dollars" comes as two separate transcripts "fifty" and "dollars".

        Auto-restarts if the STT connection drops and reconnects.
        """
        max_retries = 5
        retry = 0
        while self.is_active and retry < max_retries:
            try:
                async for msg in self.stt.receive_transcripts():
                    if not self.is_active:
                        return
                    retry = 0  # Reset on successful message

                    if msg["type"] == "transcript":
                        transcript = msg["transcript"].strip()
                        if not transcript:
                            continue

                        is_final = msg.get("is_final", False)

                        # Send live transcript to client for display
                        await self._send_client({
                            "type": "user_transcript",
                            "text": transcript,
                            "is_final": is_final,
                        })

                        if is_final and transcript:
                            # Barge-in on final transcript too
                            if self.turn_state == TurnState.SPEAKING:
                                await self._handle_interrupt()

                            # Skip pure filler (but smart — never drops prices)
                            if _is_filler(transcript):
                                logger.debug("skipping_filler", text=transcript)
                                continue

                            # Buffer the transcript and (re)start debounce timer
                            await self._buffer_transcript(transcript)

                    elif msg["type"] == "vad":
                        event = msg.get("event", "")
                        if event == "speech_start" and self.turn_state == TurnState.SPEAKING:
                            await self._handle_interrupt()

                # receive_transcripts ended (WS closed) — try reconnect
                if self.is_active and not self.stt._cancelled:
                    retry += 1
                    logger.info("stt_receive_loop_reconnecting", retry=retry)
                    await asyncio.sleep(0.5 * retry)
                    # The next send_audio call will trigger reconnect
                else:
                    break

            except asyncio.CancelledError:
                return
            except Exception as e:
                retry += 1
                logger.error("stt_receive_loop_error", error=str(e), retry=retry)
                if self.is_active and retry < max_retries:
                    await asyncio.sleep(0.5 * retry)

    async def _buffer_transcript(self, transcript: str):
        """
        Add transcript to buffer and reset the debounce timer.

        The debounce timer waits UTTERANCE_DEBOUNCE_S after the last
        transcript before processing. This handles:
        - "fifty" -> (0.3s) -> "dollars" -> (0.9s silence) -> process "fifty dollars"
        - "I offer $50" -> (0.9s silence) -> process "I offer $50"
        """
        async with self._utterance_lock:
            self._utterance_buffer.append(transcript)

            # Cancel existing timer
            if self._utterance_timer and not self._utterance_timer.done():
                self._utterance_timer.cancel()

            # Start new debounce timer
            self._utterance_timer = asyncio.create_task(self._utterance_debounce())

    async def _utterance_debounce(self):
        """Wait for debounce period, then process the buffered utterance."""
        try:
            await asyncio.sleep(UTTERANCE_DEBOUNCE_S)

            # Grab buffer
            async with self._utterance_lock:
                if not self._utterance_buffer:
                    return
                full_text = " ".join(self._utterance_buffer)
                self._utterance_buffer.clear()

            # If already processing or speaking, re-buffer for later
            if self.turn_state != TurnState.LISTENING:
                async with self._utterance_lock:
                    self._utterance_buffer.append(full_text)
                return

            # Process through the LLM pipeline
            await self._process_user_utterance(full_text)

        except asyncio.CancelledError:
            pass  # Timer was reset — new transcript arrived

    # ── Stage 2: LLM Processing ─────────────────────────────────

    async def _process_user_utterance(self, text: str):
        """
        Send transcribed text to negotiation engine and queue AI response.

        Has a hard timeout to prevent the call from getting stuck.
        """
        await self._set_turn(TurnState.PROCESSING)

        try:
            session_uuid = UUID(self.session_id)
            chat_msg = ChatMessage(message=text)

            # Run sync LLM call in thread executor WITH TIMEOUT
            loop = asyncio.get_running_loop()
            try:
                response = await asyncio.wait_for(
                    loop.run_in_executor(
                        None, self.engine.process_chat, session_uuid, chat_msg
                    ),
                    timeout=LLM_TIMEOUT_S,
                )
            except asyncio.TimeoutError:
                logger.error("llm_timeout", text=text, timeout_s=LLM_TIMEOUT_S)
                ai_text = "Sorry about that, I didn't quite catch that. Could you say that again?"
                await self._send_ai_response(ai_text, {})
                return

            ai_text = response.message
            if not ai_text:
                ai_text = "I'm sorry, could you repeat that?"

            # Build metadata for client
            meta = {
                "pricing": {
                    "decision": response.pricing.decision.value if response.pricing else None,
                    "counter_offer": str(response.pricing.counter_offer_price) if response.pricing and response.pricing.counter_offer_price else None,
                    "accepted_price": str(response.pricing.accepted_price) if response.pricing and response.pricing.accepted_price else None,
                } if response.pricing else None,
                "has_price_offer": response.has_price_offer,
                "round_number": response.round_number,
                "can_continue": response.can_continue,
                "rounds_remaining": response.rounds_remaining,
                "status": response.status.value if response.status else None,
            }

            await self._send_ai_response(ai_text, meta)

        except ValueError as e:
            error_msg = str(e)
            logger.warning("negotiation_error", error=error_msg)
            await self._send_ai_response(error_msg, {})
        except Exception as e:
            logger.error("process_utterance_error", error=str(e))
            await self._send_client({
                "type": "error",
                "message": "Something went wrong. Please try again.",
            })
            # Always return to listening on error
            await self._set_turn(TurnState.LISTENING)

    async def _send_ai_response(self, ai_text: str, meta: dict):
        """Send AI text transcript and queue sentences for TTS."""
        payload = {"type": "ai_transcript", "text": ai_text}
        payload.update(meta)
        await self._send_client(payload)

        # Queue sentences for TTS
        sentences = _split_sentences(ai_text)
        for sentence in sentences:
            await self._tts_queue.put(sentence)

    # ── Stage 3: TTS Output ─────────────────────────────────────

    async def _tts_send_loop(self):
        """
        Read sentences from TTS queue, synthesize, stream to client.

        Each sentence is synthesized independently for low latency:
        the first sentence starts playing while others are still being generated.
        """
        try:
            while self.is_active:
                text = await self._tts_queue.get()
                if text is None:
                    break

                # Transition to SPEAKING
                if self.turn_state != TurnState.SPEAKING:
                    await self._set_turn(TurnState.SPEAKING)
                self._interrupt_event.clear()

                try:
                    if self._use_rest_tts:
                        await self._tts_rest(text)
                    else:
                        await self._tts_websocket(text)
                except Exception as e:
                    logger.error("tts_error", error=str(e), text=text[:50])
                    # REST fallback
                    if not self._use_rest_tts:
                        try:
                            await self._tts_rest(text)
                        except Exception:
                            pass

                # All sentences spoken -> back to listening
                if self._tts_queue.empty():
                    await self._send_client({"type": "ai_audio_end"})
                    await self._set_turn(TurnState.LISTENING)

                    # Check if there's a buffered user utterance waiting
                    async with self._utterance_lock:
                        if self._utterance_buffer:
                            full_text = " ".join(self._utterance_buffer)
                            self._utterance_buffer.clear()
                            # Process the waiting utterance
                            asyncio.create_task(self._process_user_utterance(full_text))

        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error("tts_loop_error", error=str(e))

    async def _tts_rest(self, text: str):
        """Synthesize via REST API (returns complete WAV file)."""
        audio_b64 = await sarvam_tts_rest(
            text=text,
            language=settings.sarvam_language,
            speaker=settings.sarvam_tts_speaker,
        )
        if audio_b64 and not self._interrupt_event.is_set():
            await self._send_client({
                "type": "ai_audio",
                "data": audio_b64,
                "content_type": "audio/wav",
                "sample_rate": 24000,
                "format": "wav",
            })
            logger.debug("tts_rest_sent", text_len=len(text))

    async def _tts_websocket(self, text: str):
        """Synthesize via WebSocket (streaming chunks)."""
        await self.tts.send_text(text)

        async for chunk in self.tts.receive_audio():
            if self._interrupt_event.is_set():
                break
            if chunk["type"] == "audio":
                await self._send_client({
                    "type": "ai_audio",
                    "data": chunk["audio"],
                    "content_type": chunk.get("content_type", "audio/wav"),
                    "sample_rate": 24000,
                })
            elif chunk["type"] in ("completion", "error"):
                break

    # ── Silence Monitor ──────────────────────────────────────────

    async def _silence_monitor(self):
        """
        Flush STT after silence — but only ONCE per silence gap,
        and only after audio has actually been sent to STT.
        """
        try:
            while self.is_active:
                await asyncio.sleep(0.5)

                if self.turn_state != TurnState.LISTENING:
                    continue  # Only monitor silence during listening

                # Don't flush if STT hasn't received any audio yet
                if not self.stt.has_sent_audio:
                    continue

                elapsed = time.time() - self._last_audio_ts
                if elapsed >= SILENCE_TIMEOUT_S and not self._silence_flushed:
                    await self.stt.flush()
                    self._silence_flushed = True  # Don't flush again until new audio
                    logger.debug("silence_flush", elapsed_s=round(elapsed, 1))

        except asyncio.CancelledError:
            pass

    # ── Barge-In (Interrupt) ─────────────────────────────────────

    async def _handle_interrupt(self):
        """Handle user interrupting the AI mid-speech."""
        if self.turn_state != TurnState.SPEAKING:
            return

        logger.info("barge_in", session=self.session_id)
        self._interrupt_event.set()
        self.tts.cancel()

        # Drain TTS queue
        while not self._tts_queue.empty():
            try:
                self._tts_queue.get_nowait()
            except asyncio.QueueEmpty:
                break

        # Notify client and switch to listening
        await self._send_client({"type": "ai_audio_end"})
        await self._set_turn(TurnState.LISTENING)

        # Reconnect WS TTS if needed
        if not self._use_rest_tts:
            try:
                await self.tts.reconnect()
            except Exception:
                logger.warning("tts_reconnect_failed_switching_to_rest")
                self._use_rest_tts = True

    # ── Utility ──────────────────────────────────────────────────

    async def _send_client(self, data: dict):
        """Send JSON to client WebSocket."""
        try:
            await self.client_ws.send_json(data)
        except Exception as e:
            logger.warning("client_send_error", error=str(e))
