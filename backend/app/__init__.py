"""
Negotiation Engine Backend

A profit-aware negotiation engine for commercial use.
"""
from .core import NegotiationEngine, get_engine
from .models import (
    NegotiationMode,
    CreateSessionRequest,
    CreateSessionResponse,
    BuyerOffer,
    NegotiationTurnResponse,
)

__version__ = "1.0.0"

def __getattr__(name: str):
    if name in ("app", "create_app"):
        from .main import app, create_app
        return app if name == "app" else create_app
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

__all__ = [
    "app",
    "create_app",
    "NegotiationEngine",
    "get_engine",
    "NegotiationMode",
    "CreateSessionRequest",
    "CreateSessionResponse",
    "BuyerOffer",
    "NegotiationTurnResponse",
]
