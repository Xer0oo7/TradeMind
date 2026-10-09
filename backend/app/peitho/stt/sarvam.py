"""
Sarvam AI Realtime STT Adapter for Peitho (Fallback Provider).
Streams PCM16 16kHz audio to Sarvam STT WebSocket API.
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


class SarvamSTTAdapter(BaseSTTAdapter):
    """
    Real-time speech-to-text adapter using Sarvam AI WebSocket API.
    Used as an automatic fallback when ElevenLabs fails or is unavailable.
    """

    DEFAULT_WS_URL = "wss://api.sarvam.ai/speech-to-text/ws"

    def __init__(
        self,
        api_key: Optional[str] = None,
        model: str = "saaras:v3",
        language_code: str = "en-IN",
        channel_name: str = "default",
        ws_url: Optional[str] = None,
        on_status_change: Optional[Callable[[str, str], None]] = None,
    ):
        super().__init__(channel_name=channel_name)
        self._api_key = (api_key or "").strip()
        self._model = model
        self._language_code = language_code
        self._ws_url = ws_url or self.DEFAULT_WS_URL
        self._on_status_change = on_status_change

        self._ws: Optional[websockets.WebSocketClientProtocol] = None
        self._send_queue: asyncio.Queue[bytes] = asyncio.Queue(maxsize=100)
        self._receive_task: Optional[asyncio.Task] = None
        self._send_task: Optional[asyncio.Task] = None
        self._keepalive_task: Optional[asyncio.Task] = None
        self._closing = False

        self._audio_bytes_sent = 0
        self._audio_chunks_sent = 0
        self._final_events_count = 0
        self._last_send_time = time.time()

    @property
    def has_api_key(self) -> bool:
        return bool(self._api_key)

    def _notify_status(self, state: str, reason: str = "") -> None:
        if self._on_status_change:
            try:
                self._on_status_change(state, reason)
            except Exception:
                pass

    async def start(self) -> None:
        if not self._api_key:
            self._is_active = False
            self._notify_status("error", "Sarvam API key missing")
            return

        self._closing = False
        self._notify_status("connecting", "Connecting to Sarvam STT...")
        await self._connect()

    async def _connect(self) -> None:
        params = (
            f"?language-code={self._language_code}"
            f"&model={self._model}"
            f"&mode=transcribe"
            f"&sample_rate=16000"
            f"&high_vad_sensitivity=true"
            f"&vad_signals=true"
        )
        url = self._ws_url + params
        headers = {"Api-Subscription-Key": self._api_key}

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
            self._notify_status("live", "Connected to Sarvam STT")
            logger.info("sarvam_stt_connected", channel=self.channel_name, provider="sarvam")

            self._receive_task = asyncio.create_task(self._receive_loop())
            self._receive_task.add_done_callback(self._on_task_done)

            self._send_task = asyncio.create_task(self._send_loop())
            self._send_task.add_done_callback(self._on_task_done)

            self._keepalive_task = asyncio.create_task(self._keepalive_loop())
            self._keepalive_task.add_done_callback(self._on_task_done)

        except Exception as e:
            self._is_active = False
            self._notify_status("error", f"Sarvam connect error: {type(e).__name__}")
            logger.error("sarvam_stt_connection_failed", channel=self.channel_name, error_type=type(e).__name__)

    def _on_task_done(self, t: asyncio.Task) -> None:
        if not t.cancelled():
            exc = t.exception()
            if exc:
                logger.error("sarvam_task_exception", channel=self.channel_name, error_type=type(exc).__name__)

    async def send_audio(self, pcm_chunk: bytes) -> None:
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
        while not self._closing and self._is_active and self._ws:
            try:
                chunk = await self._send_queue.get()
                b64_audio = base64.b64encode(chunk).decode("ascii")
                payload = {"audio": b64_audio}
                await self._ws.send(json.dumps(payload))
                self._send_queue.task_done()

                self._audio_bytes_sent += len(chunk)
                self._audio_chunks_sent += 1
                self._last_send_time = time.time()
            except asyncio.CancelledError:
                break
            except Exception as e:
                self._is_active = False
                self._notify_status("error", f"Send error: {type(e).__name__}")
                break

    async def _keepalive_loop(self) -> None:
        silence_frame = b"\x00" * 3200
        while not self._closing and self._is_active and self._ws:
            try:
                await asyncio.sleep(4.0)
                if (time.time() - self._last_send_time >= 4.0) and self._is_active:
                    await self.send_audio(silence_frame)
            except asyncio.CancelledError:
                break
            except Exception:
                break

    async def _receive_loop(self) -> None:
        while not self._closing and self._is_active and self._ws:
            try:
                raw_msg = await self._ws.recv()
                msg = json.loads(raw_msg)
                msg_type = msg.get("type", "data")

                if msg_type == "data":
                    data = msg.get("data", {})
                    transcript = data.get("transcript", "")
                    if transcript:
                        self._final_events_count += 1
                        asyncio.create_task(self._emit_final(transcript))
                elif msg_type == "vad":
                    pass

            except asyncio.CancelledError:
                break
            except websockets.ConnectionClosed:
                self._is_active = False
                self._notify_status("error", "Sarvam connection closed")
                break
            except Exception as e:
                self._is_active = False
                self._notify_status("error", f"Sarvam error: {type(e).__name__}")
                break

    async def close(self) -> None:
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
