"""
Base STT Adapter — Abstract contract for speech-to-text providers.
"""
from abc import ABC, abstractmethod
from typing import Awaitable, Callable, List, Optional
import structlog

logger = structlog.get_logger(__name__)

TranscriptCallback = Callable[[str], Awaitable[None]]


class BaseSTTAdapter(ABC):
    """
    Abstract interface for streaming speech-to-text adapters.
    
    Receives live PCM16 16kHz audio chunks and invokes registered callbacks
    for partial and final transcript segments.
    """

    def __init__(self, channel_name: str = "default"):
        self.channel_name = channel_name
        self._partial_callbacks: List[TranscriptCallback] = []
        self._final_callbacks: List[TranscriptCallback] = []
        self._is_active = False

    @property
    def is_active(self) -> bool:
        """Whether the adapter connection is currently open and healthy."""
        return self._is_active

    def on_partial(self, callback: TranscriptCallback) -> None:
        """Register an async callback for interim/partial transcripts."""
        self._partial_callbacks.append(callback)

    def on_final(self, callback: TranscriptCallback) -> None:
        """Register an async callback for committed/final transcripts."""
        self._final_callbacks.append(callback)

    async def _emit_partial(self, text: str) -> None:
        """Trigger all registered partial transcript listeners."""
        if not text:
            return
        for cb in self._partial_callbacks:
            try:
                await cb(text)
            except Exception as e:
                logger.error("partial_transcript_callback_failed", error=str(e), channel=self.channel_name)

    async def _emit_final(self, text: str) -> None:
        """Trigger all registered final transcript listeners."""
        if not text:
            return
        for cb in self._final_callbacks:
            try:
                await cb(text)
            except Exception as e:
                logger.error("final_transcript_callback_failed", error=str(e), channel=self.channel_name)

    @abstractmethod
    async def start(self) -> None:
        """Initialize upstream connection or worker task."""
        pass

    @abstractmethod
    async def send_audio(self, pcm_chunk: bytes) -> None:
        """Send a chunk of PCM16 16kHz audio to the STT provider."""
        pass

    @abstractmethod
    async def close(self) -> None:
        """Gracefully close the adapter and cleanup upstream connections."""
        pass
