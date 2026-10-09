"""
ElevenLabs Scribe Realtime STT Adapter.

Streams PCM16 16kHz audio to ElevenLabs Realtime Scribe WebSocket API and
dispatches partial and final transcript events.
"""
import asyncio
import base64
import inspect
import json
import os
import time
from typing import Callable, Optional
import structlog
import websockets

from .base import BaseSTTAdapter

logger = structlog.get_logger(__name__)


def is_peitho_debug() -> bool:
    return os.getenv("PEITHO_DEBUG", "false").lower() in ("true", "1", "yes")


class ElevenLabsSTTAdapter(BaseSTTAdapter):
    """
    Real-time speech-to-text adapter using ElevenLabs Scribe API over WebSocket.
    
    Endpoint: wss://api.elevenlabs.io/v1/speech-to-text/realtime
    Audio format: PCM 16kHz, mono, 16-bit
    Commit strategy: vad (Voice Activity Detection auto-commit)
    """

    DEFAULT_WS_URL = "wss://api.elevenlabs.io/v1/speech-to-text/realtime"

    def __init__(
        self,
        api_key: Optional[str] = None,
        model_id: str = "scribe_v2_realtime",
        language_code: str = "en",
        channel_name: str = "default",
        ws_url: Optional[str] = None,
        on_status_change: Optional[Callable[[str, str], None]] = None,
        vad_threshold: Optional[float] = None,
        vad_silence_threshold_secs: Optional[float] = None,
        min_speech_duration_ms: Optional[int] = None,
        min_silence_duration_ms: Optional[int] = None,
    ):
        super().__init__(channel_name=channel_name)
        from ...core.config import get_settings
        settings = get_settings()

        self._api_key = (api_key if api_key is not None else settings.elevenlabs_api_key).strip()
        self._model_id = model_id or settings.elevenlabs_stt_model
        self._language_code = language_code if language_code is not None else settings.elevenlabs_language
        self._ws_url = ws_url or self.DEFAULT_WS_URL
        self._on_status_change = on_status_change

        self._vad_threshold = (
            vad_threshold if vad_threshold is not None else settings.elevenlabs_vad_threshold
        )
        self._vad_silence_threshold_secs = (
            vad_silence_threshold_secs
            if vad_silence_threshold_secs is not None
            else settings.elevenlabs_vad_silence_threshold_secs
        )
        self._min_speech_duration_ms = (
            min_speech_duration_ms
            if min_speech_duration_ms is not None
            else settings.elevenlabs_min_speech_duration_ms
        )
        self._min_silence_duration_ms = (
            min_silence_duration_ms
            if min_silence_duration_ms is not None
            else settings.elevenlabs_min_silence_duration_ms
        )
        
        self._ws: Optional[websockets.WebSocketClientProtocol] = None
        self._send_queue: asyncio.Queue[bytes] = asyncio.Queue(maxsize=100)
        self._receive_task: Optional[asyncio.Task] = None
        self._send_task: Optional[asyncio.Task] = None
        self._keepalive_task: Optional[asyncio.Task] = None
        self._closing = False

        # Content-free metrics
        self._audio_bytes_sent = 0
        self._audio_chunks_sent = 0
        self._partial_events_count = 0
        self._final_events_count = 0
        self._last_audio_send_time = time.time()
        self._time_first_final: Optional[float] = None
        self._start_time = 0.0

    @property
    def has_api_key(self) -> bool:
        return bool(self._api_key)

    @property
    def metrics(self) -> dict:
        return {
            "bytes_sent": self._audio_bytes_sent,
            "chunks_sent": self._audio_chunks_sent,
            "partial_count": self._partial_events_count,
            "final_count": self._final_events_count,
            "time_to_first_final": (
                round(self._time_first_final - self._start_time, 3)
                if self._time_first_final and self._start_time
                else None
            ),
        }

    def _notify_status(self, state: str, reason: str = "") -> None:
        if self._on_status_change:
            try:
                self._on_status_change(state, reason)
            except Exception:
                pass

    async def start(self) -> None:
        """Connect to ElevenLabs Scribe realtime WebSocket."""
        if not self._api_key:
            self._is_active = False
            self._notify_status("error", "ElevenLabs API key missing")
            logger.warning(
                "elevenlabs_stt_not_configured",
                channel=self.channel_name,
            )
            return

        self._closing = False
        self._start_time = time.time()
        self._notify_status("connecting", "Connecting to ElevenLabs Scribe...")
        await self._connect()

    async def _connect(self) -> None:
        """Establish WebSocket connection with VAD commit strategy and 16kHz PCM."""
        query_params = [
            f"model_id={self._model_id}",
            "audio_format=pcm_16000",
            "commit_strategy=vad",
            f"vad_threshold={self._vad_threshold}",
            f"vad_silence_threshold_secs={self._vad_silence_threshold_secs}",
            f"min_speech_duration_ms={self._min_speech_duration_ms}",
            f"min_silence_duration_ms={self._min_silence_duration_ms}",
        ]
        lang = (self._language_code or "").strip().lower()
        if lang and lang not in ("auto", "none"):
            query_params.append(f"language_code={lang}")

        url = f"{self._ws_url}?{'&'.join(query_params)}"
        headers = {
            "xi-api-key": self._api_key,
        }

        # Handle websockets parameter change across versions
        connect_kwargs = {
            "ping_interval": 20,
            "ping_timeout": 10,
        }
        try:
            sig = inspect.signature(websockets.connect)
            if "additional_headers" in sig.parameters:
                connect_kwargs["additional_headers"] = headers
            else:
                connect_kwargs["extra_headers"] = headers
        except Exception:
            connect_kwargs["additional_headers"] = headers

        try:
            self._ws = await websockets.connect(url, **connect_kwargs)
            self._is_active = True
            self._notify_status("live", "Connected to ElevenLabs Scribe")
            logger.info(
                "elevenlabs_stt_connected",
                channel=self.channel_name,
                provider="elevenlabs",
                model=self._model_id,
            )

            self._receive_task = asyncio.create_task(self._receive_loop())
            self._receive_task.add_done_callback(self._on_task_done)

            self._send_task = asyncio.create_task(self._send_loop())
            self._send_task.add_done_callback(self._on_task_done)

            self._keepalive_task = asyncio.create_task(self._keepalive_loop())
            self._keepalive_task.add_done_callback(self._on_task_done)

        except Exception as e:
            self._is_active = False
            self._notify_status("error", f"Connection failed: {type(e).__name__}")
            logger.error(
                "elevenlabs_stt_connection_failed",
                channel=self.channel_name,
                provider="elevenlabs",
                error_type=type(e).__name__,
            )

    def _on_task_done(self, t: asyncio.Task) -> None:
        """Done callback that logs background task exceptions by type only."""
        if not t.cancelled():
            exc = t.exception()
            if exc:
                logger.error(
                    "elevenlabs_task_exception",
                    channel=self.channel_name,
                    error_type=type(exc).__name__,
                )

    async def send_audio(self, pcm_chunk: bytes) -> None:
        """Enqueue PCM16 audio chunk to be forwarded to ElevenLabs."""
        if not self._is_active or not self._api_key or not pcm_chunk:
            return

        try:
            self._send_queue.put_nowait(pcm_chunk)
        except asyncio.QueueFull:
            try:
                _ = self._send_queue.get_nowait()
                self._send_queue.put_nowait(pcm_chunk)
            except Exception:
                pass

    async def _send_loop(self) -> None:
        """Worker task sending audio chunks to ElevenLabs."""
        while not self._closing and self._is_active and self._ws:
            try:
                chunk = await self._send_queue.get()
                b64_audio = base64.b64encode(chunk).decode("ascii")
                payload = {
                    "message_type": "input_audio_chunk",
                    "audio_base_64": b64_audio,
                }
                await self._ws.send(json.dumps(payload))
                self._send_queue.task_done()

                self._audio_bytes_sent += len(chunk)
                self._audio_chunks_sent += 1
                self._last_audio_send_time = time.time()

                if is_peitho_debug() and (self._audio_chunks_sent % 50 == 0):
                    logger.debug(
                        "elevenlabs_audio_progress",
                        channel=self.channel_name,
                        chunks=self._audio_chunks_sent,
                        total_bytes=self._audio_bytes_sent,
                    )
            except asyncio.CancelledError:
                break
            except Exception as e:
                self._is_active = False
                self._notify_status("error", f"Send error: {type(e).__name__}")
                logger.error(
                    "elevenlabs_send_error",
                    channel=self.channel_name,
                    error_type=type(e).__name__,
                )
                break

    async def _keepalive_loop(self) -> None:
        """Sends small silence frames during idle periods to prevent connection drops."""
        # 100ms of silence at 16kHz PCM16 = 1600 samples * 2 bytes = 3200 bytes
        silence_frame = b"\x00" * 3200
        while not self._closing and self._is_active and self._ws:
            try:
                await asyncio.sleep(4.0)
                idle_secs = time.time() - self._last_audio_send_time
                if idle_secs >= 4.0 and self._is_active and self._ws:
                    # Enqueue silence keepalive
                    await self.send_audio(silence_frame)
            except asyncio.CancelledError:
                break
            except Exception:
                break

    async def _receive_loop(self) -> None:
        """Worker task reading incoming transcript messages from ElevenLabs."""
        while not self._closing and self._is_active and self._ws:
            try:
                raw_msg = await self._ws.recv()
                data = json.loads(raw_msg)
                msg_type = data.get("message_type") or data.get("type")

                if msg_type == "session_started":
                    if is_peitho_debug():
                        logger.debug("elevenlabs_session_started", channel=self.channel_name)

                elif msg_type == "partial_transcript":
                    text = data.get("text", "")
                    self._partial_events_count += 1
                    if is_peitho_debug() and (self._partial_events_count % 10 == 0):
                        logger.debug(
                            "elevenlabs_partial_received",
                            channel=self.channel_name,
                            count=self._partial_events_count,
                        )
                    # Dispatch to listeners without blocking
                    asyncio.create_task(self._emit_partial(text))

                elif msg_type in ("committed_transcript", "edited_transcript"):
                    text = data.get("text", "")
                    self._final_events_count += 1
                    if self._time_first_final is None:
                        self._time_first_final = time.time()

                    if is_peitho_debug():
                        logger.debug(
                            "elevenlabs_final_received",
                            channel=self.channel_name,
                            count=self._final_events_count,
                        )
                    # Dispatch to listeners without blocking
                    asyncio.create_task(self._emit_final(text))

                elif msg_type == "error":
                    code = data.get("code") or data.get("error_code", "GENERIC_ERROR")
                    logger.error(
                        "elevenlabs_stt_error_message",
                        channel=self.channel_name,
                        error_code=str(code),
                    )
                    self._notify_status("error", f"ElevenLabs error code {code}")

            except asyncio.CancelledError:
                break
            except websockets.ConnectionClosed as cc:
                self._is_active = False
                logger.warning(
                    "elevenlabs_connection_closed",
                    channel=self.channel_name,
                    close_code=getattr(cc, "code", None),
                )
                self._notify_status("error", f"Closed: code {getattr(cc, 'code', 'unknown')}")
                break
            except Exception as e:
                self._is_active = False
                logger.error(
                    "elevenlabs_receive_error",
                    channel=self.channel_name,
                    error_type=type(e).__name__,
                )
                self._notify_status("error", f"Receive error: {type(e).__name__}")
                break

    async def close(self) -> None:
        """Close connection and cancel tasks."""
        self._closing = True
        self._is_active = False

        if self._send_task:
            self._send_task.cancel()
        if self._receive_task:
            self._receive_task.cancel()
        if self._keepalive_task:
            self._keepalive_task.cancel()

        if self._ws:
            try:
                await self._ws.close()
            except Exception:
                pass
            self._ws = None

        logger.info(
            "elevenlabs_stt_adapter_closed",
            channel=self.channel_name,
            total_bytes=self._audio_bytes_sent,
            total_chunks=self._audio_chunks_sent,
            partial_count=self._partial_events_count,
            final_count=self._final_events_count,
        )
