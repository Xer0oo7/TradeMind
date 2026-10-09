"""
Peitho STT Adapter Layer.

Provides factory functions to initialize streaming STT adapters.
Supports ElevenLabs Scribe (realtime WebSocket), Sarvam AI (fallback), and Typed.
"""
from typing import Callable, Optional
import structlog

from ...core.config import get_settings
from .base import BaseSTTAdapter
from .elevenlabs import ElevenLabsSTTAdapter
from .sarvam import SarvamSTTAdapter
from .typed import TypedSTTAdapter

logger = structlog.get_logger(__name__)


def get_stt_adapter(
    provider: Optional[str] = None,
    channel: str = "default",
    on_status_change: Optional[Callable[[str, str], None]] = None,
    language_code: Optional[str] = None,
    vad_threshold: Optional[float] = None,
    vad_silence_threshold_secs: Optional[float] = None,
) -> BaseSTTAdapter:
    """
    Factory function to obtain an STT adapter instance with tiered fallback:
    ElevenLabs -> Sarvam (if configured) -> Typed.
    """
    settings = get_settings()
    selected_provider = (provider or settings.peitho_stt_provider or "typed").lower().strip()
    target_lang = language_code if language_code is not None else settings.elevenlabs_language

    if selected_provider == "elevenlabs":
        if settings.elevenlabs_api_key:
            return ElevenLabsSTTAdapter(
                api_key=settings.elevenlabs_api_key,
                model_id=settings.elevenlabs_stt_model,
                language_code=target_lang,
                channel_name=channel,
                on_status_change=on_status_change,
                vad_threshold=vad_threshold,
                vad_silence_threshold_secs=vad_silence_threshold_secs,
            )
        elif settings.sarvam_api_key:
            logger.info(
                "elevenlabs_key_missing_falling_back_to_sarvam",
                channel=channel,
            )
            return SarvamSTTAdapter(
                api_key=settings.sarvam_api_key,
                model=settings.sarvam_stt_model,
                language_code=settings.sarvam_language,
                channel_name=channel,
                on_status_change=on_status_change,
            )
        else:
            logger.info(
                "elevenlabs_key_missing_falling_back_to_typed",
                channel=channel,
            )
            return TypedSTTAdapter(channel_name=channel)

    elif selected_provider == "sarvam":
        if settings.sarvam_api_key:
            return SarvamSTTAdapter(
                api_key=settings.sarvam_api_key,
                model=settings.sarvam_stt_model,
                language_code=settings.sarvam_language,
                channel_name=channel,
                on_status_change=on_status_change,
            )
        else:
            logger.info(
                "sarvam_key_missing_falling_back_to_typed",
                channel=channel,
            )
            return TypedSTTAdapter(channel_name=channel)

    return TypedSTTAdapter(channel_name=channel)


__all__ = [
    "BaseSTTAdapter",
    "ElevenLabsSTTAdapter",
    "SarvamSTTAdapter",
    "TypedSTTAdapter",
    "get_stt_adapter",
]

