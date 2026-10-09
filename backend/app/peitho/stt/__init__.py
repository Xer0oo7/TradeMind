"""
Peitho STT Adapter Layer.

Provides factory functions to initialize streaming STT adapters.
Supports ElevenLabs Scribe (realtime WebSocket) and Typed (text pass-through).
Sarvam STT is excluded as requested.
"""
from typing import Optional
import structlog

from ...core.config import get_settings
from .base import BaseSTTAdapter
from .elevenlabs import ElevenLabsSTTAdapter
from .typed import TypedSTTAdapter

logger = structlog.get_logger(__name__)


def get_stt_adapter(
    provider: Optional[str] = None,
    channel: str = "default",
) -> BaseSTTAdapter:
    """
    Factory function to obtain an STT adapter instance.
    
    If ElevenLabs is requested but the API key is not yet configured,
    gracefully falls back to TypedSTTAdapter.
    """
    settings = get_settings()
    selected_provider = (provider or settings.peitho_stt_provider or "typed").lower().strip()

    if selected_provider == "elevenlabs":
        if settings.elevenlabs_api_key:
            return ElevenLabsSTTAdapter(
                api_key=settings.elevenlabs_api_key,
                model_id=settings.elevenlabs_stt_model,
                language_code=settings.elevenlabs_language,
                channel_name=channel,
            )
        else:
            logger.info(
                "elevenlabs_credentials_not_found_fallback_to_typed",
                channel=channel,
                notice="ElevenLabs API key is not configured. Falling back to Typed STT adapter.",
            )
            return TypedSTTAdapter(channel_name=channel)

    return TypedSTTAdapter(channel_name=channel)


__all__ = ["BaseSTTAdapter", "ElevenLabsSTTAdapter", "TypedSTTAdapter", "get_stt_adapter"]
