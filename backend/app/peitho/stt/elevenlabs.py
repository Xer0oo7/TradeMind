"""
ElevenLabs Scribe Realtime STT Adapter.

Streams PCM16 16kHz audio to ElevenLabs Realtime Scribe WebSocket API and
dispatches partial and final transcript events.
Gracefully handles missing API keys so the rest of the application runs smoothly.
"""
import asyncio
import base64
import json
from typing import Optional
import structlog
import websockets

from .base import BaseSTTAdapter

logger = structlog.get_logger(__name__)


class ElevenLabsSTTAdapter(BaseSTTAdapter):
    """
    Real-time speech-to-text adapter using ElevenLabs Scribe API over WebSocket.
    
    Endpoint: wss://api.elevenlabs.io/v1/speech-to-text/realtime
    Audio format: PCM 16kHz, mono, 16-bit
    """

    DEFAULT_WS_URL = "wss://api.elevenlabs.io/v1/speech-to-text/realtime"

    def __init__(
        self,
        api_key: Optional[str] = None,
        model_id: str = "scribe_v2_realtime",
        language_code: str = "en",
        channel_name: str = "default",
        ws_url: Optional[str] = None,
    ):
        super().__init__(channel_name=channel_name)
        self._api_key = (api_key or "").strip()
        self._model_id = model_id
        self._language_code = language_code
        self._ws_url = ws_url or self.DEFAULT_WS_URL
        
        self._ws: Optional[websockets.WebSocketClientProtocol] = None
        self._send_queue: asyncio.Queue[bytes] = asyncio.Queue(maxsize=100)
        self._receive_task: Optional[asyncio.Task] = None
        self._send_task: Optional[asyncio.Task] = None
        self._closing = False

    @property
    def has_api_key(self) -> bool:
        return bool(self._api_key)

    async def start(self) -> None:
        """
        Connect to ElevenLabs Scribe realtime WebSocket.
        If no API key is configured, enters inactive/mock mode gracefully.
        """
        if not self._api_key:
            logger.warning(
                "elevenlabs_stt_not_configured",
                channel=self.channel_name,
                msg="ElevenLabs API key is missing. Adapter running in placeholder mode.",
            )
            self._is_active = False
            return

        self._closing = False
        await self._connect()

    async def _connect(self) -> None:
        """Establish WebSocket connection with retry."""
        url = f"{self._ws_url}?model_id={self._model_id}&language_code={self._language_code}"
        headers = {
            "xi-api-key": self._api_key,
        }

        try:
            self._ws = await websockets.connect(
                url,
                extra_headers=headers,
                ping_interval=20,
                ping_timeout=10,
            )
            self._is_active = True
            logger.info("elevenlabs_stt_connected", channel=self.channel_name)

            self._receive_task = asyncio.create_task(self._receive_loop())
            self._send_task = asyncio.create_task(self._send_loop())
        except Exception as e:
            self._is_active = False
            logger.error(
                "elevenlabs_stt_connection_failed",
                channel=self.channel_name,
                error=str(e),
            )

    async def send_audio(self, pcm_chunk: bytes) -> None:
        """Enqueue PCM16 audio chunk to be forwarded to ElevenLabs."""
        if not self._is_active or not self._api_key:
            return

        try:
            self._send_queue.put_nowait(pcm_chunk)
        except asyncio.QueueFull:
            # Drop older audio to prevent lag under backpressure
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
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("elevenlabs_send_error", error=str(e), channel=self.channel_name)
                break

    async def _receive_loop(self) -> None:
        """Worker task reading incoming transcript messages from ElevenLabs."""
        while not self._closing and self._is_active and self._ws:
            try:
                raw_msg = await self._ws.recv()
                data = json.loads(raw_msg)
                msg_type = data.get("message_type") or data.get("type")

                if msg_type == "partial_transcript":
                    text = data.get("text", "")
                    await self._emit_partial(text)

                elif msg_type in ("committed_transcript", "edited_transcript"):
                    text = data.get("text", "")
                    await self._emit_final(text)

                elif msg_type == "error":
                    err_msg = data.get("error", "Unknown ElevenLabs STT error")
                    logger.error("elevenlabs_stt_error_message", error=err_msg, channel=self.channel_name)

            except asyncio.CancelledError:
                break
            except websockets.ConnectionClosed:
                logger.warning("elevenlabs_connection_closed", channel=self.channel_name)
                self._is_active = False
                break
            except Exception as e:
                logger.error("elevenlabs_receive_error", error=str(e), channel=self.channel_name)
                break

    async def close(self) -> None:
        """Close connection and cancel tasks."""
        self._closing = True
        self._is_active = False

        if self._send_task:
            self._send_task.cancel()
        if self._receive_task:
            self._receive_task.cancel()

        if self._ws:
            try:
                await self._ws.close()
            except Exception:
                pass
            self._ws = None

        logger.info("elevenlabs_stt_adapter_closed", channel=self.channel_name)
