"""
Negotiation Engine Backend - Configuration Module
"""
from pydantic_settings import BaseSettings
from functools import lru_cache
from typing import Literal


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""
    
    # Environment
    env: Literal["development", "staging", "production"] = "development"
    debug: bool = False  # SECURITY: default to False, explicitly set True in dev .env
    log_level: str = "INFO"
    
    # Server
    host: str = "0.0.0.0"
    port: int = 8000
    
    # Rate Limiting
    rate_limit_per_minute: int = 60
    rate_limit_per_hour: int = 1000
    
    # Session Management
    session_ttl_seconds: int = 7200  # 2 hours (longer than JWT to avoid mid-negotiation drops)
    max_sessions_per_client: int = 10
    
    # Security
    jwt_secret: str = ""  # REQUIRED — set in .env
    encryption_key: str = ""  # For encrypting PII at rest
    allowed_origins: str = "http://localhost:5173,http://127.0.0.1:5173"  # Comma-separated origins
    
    # MySQL Database
    mysql_host: str = "127.0.0.1"
    mysql_port: int = 3306
    mysql_user: str = ""  # REQUIRED — set in .env
    mysql_password: str = ""  # REQUIRED — set in .env
    mysql_db: str = "trademind"
    
    # OpenRouter LLM
    openrouter_api_key: str = ""  # Get from https://openrouter.ai/keys
    openrouter_model: str = "google/gemini-2.0-flash-001"  # Fast & cheap
    llm_max_tokens: int = 200
    llm_temperature: float = 0.7
    llm_timeout_seconds: float = 10.0
    
    # Sarvam AI (Voice)
    sarvam_api_key: str = ""  # Set in .env — get from https://dashboard.sarvam.ai
    sarvam_stt_ws_url: str = "wss://api.sarvam.ai/speech-to-text/ws"
    sarvam_tts_ws_url: str = "wss://api.sarvam.ai/text-to-speech/ws"
    sarvam_tts_rest_url: str = "https://api.sarvam.ai/text-to-speech"
    sarvam_stt_model: str = "saaras:v3"
    sarvam_tts_model: str = "bulbul:v3-beta"
    sarvam_tts_speaker: str = "Shubh"
    sarvam_language: str = "en-IN"
    
    # Peitho Live Assistant (STT & Copilot)
    peitho_stt_provider: str = "typed"  # "elevenlabs" | "typed"
    elevenlabs_api_key: str = ""        # ElevenLabs Scribe API key (set in .env later)
    elevenlabs_stt_model: str = "scribe_v2_realtime"
    elevenlabs_language: str = "en"
    elevenlabs_vad_threshold: float = 0.4
    elevenlabs_vad_silence_threshold_secs: float = 0.7  # Reduced from 1.5s to cut ~800ms dead latency
    elevenlabs_min_speech_duration_ms: int = 250
    elevenlabs_min_silence_duration_ms: int = 300

    # Peitho Tactical Intel Generation
    peitho_intel_model: str = "google/gemini-2.5-flash"
    peitho_intel_max_tokens: int = 260
    peitho_intel_timeout_seconds: float = 4.0
    peitho_debug: bool = False

    # Market Comparison
    serp_api_key: str = ""
    market_sources: str = "html,seeded"  # comma-sep: serp,html,seeded
    comparison_mode: str = "we_are_cheaper"  # only show cheaper-than-market items
    market_comparison_ttl: int = 21600  # 6 hours in seconds
    market_allowed_domains: str = "amazon.in,flipkart.com,croma.com"  # for HTML scraper
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache()
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
