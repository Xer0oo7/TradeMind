"""
Typed STT Adapter — Text pass-through adapter for testing and fallback mode.
"""
from typing import Optional
import structlog

from .base import BaseSTTAdapter

logger = structlog.get_logger(__name__)


class TypedSTTAdapter(BaseSTTAdapter):
    """
    Adapter that receives direct transcript strings (typed or test-injected).
    
    Provides an always-available implementation when external STT credentials
    (such as ElevenLabs) are not yet provided.
    """

    def __init__(self, channel_name: str = "default"):
        super().__init__(channel_name=channel_name)
        self._is_active = True

    async def start(self) -> None:
        """Start the typed adapter."""
        self._is_active = True
        logger.info("typed_stt_adapter_started", channel=self.channel_name)

    async def send_audio(self, pcm_chunk: bytes) -> None:
        """
        Audio is ignored by the typed adapter since no STT model is connected.
        Logs at debug level.
        """
        # No-op for audio chunks when in typed mode
        pass

    async def send_text(self, text: str, is_final: bool = True) -> None:
        """
        Directly inject text into the transcript flow.
        """
        cleaned = text.strip()
        if not cleaned:
            return

        if is_final:
            await self._emit_final(cleaned)
        else:
            await self._emit_partial(cleaned)

    async def close(self) -> None:
        """Close adapter."""
        self._is_active = False
        logger.info("typed_stt_adapter_closed", channel=self.channel_name)
