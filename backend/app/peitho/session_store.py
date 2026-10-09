"""
Peitho Session Store — In-memory session management with TTL tracking.
"""
import time
from typing import Dict, List, Optional
from uuid import uuid4
import structlog

from ..agents.negotiation_engine import NegotiationState, BuyerArchetype
from .schemas import PeithoSession, PeithoSessionConfig, PeithoSessionSummary

logger = structlog.get_logger(__name__)


class PeithoSessionStore:
    """Manages active Peitho live assistant negotiation sessions."""

    def __init__(self, ttl_seconds: int = 7200):
        self._sessions: Dict[str, PeithoSession] = {}
        self._ttl_seconds = ttl_seconds

    def create_session(self, config: PeithoSessionConfig) -> PeithoSession:
        """Create and register a new Peitho live negotiation session."""
        self.cleanup_expired()

        session_id = str(uuid4())

        # Resolve archetype safely
        try:
            archetype = BuyerArchetype[config.buyer_archetype.upper()]
        except (KeyError, AttributeError):
            archetype = BuyerArchetype.UNKNOWN

        # Initialize PRANE-X NegotiationState
        master_state = NegotiationState(
            base_price=float(config.base_price),
            cost_price=float(config.cost_price),
            min_floor=float(config.min_floor),
            mode=config.mode,
            max_rounds=config.max_rounds,
            quantity=config.quantity,
            total_sessions=0,
            accepted_deals=0,
            historical_avg_margin=0.0,
            historical_revenue=0.0,
            available_inventory=config.available_inventory,
            reference_inventory=config.reference_inventory,
            buyer_archetype=archetype,
        )

        # Seed initial seller opening offer in counter history
        master_state.counter_history.append(float(config.base_price))

        session = PeithoSession(
            session_id=session_id,
            config=config,
            master_state=master_state,
        )

        self._sessions[session_id] = session
        logger.info(
            "peitho_session_created",
            session_id=session_id,
            product_name=config.product_name,
            base_price=config.base_price,
            mode=config.mode,
        )
        return session

    def get_session(self, session_id: str) -> Optional[PeithoSession]:
        """Retrieve an active session by ID and update timestamp."""
        session = self._sessions.get(session_id)
        if not session:
            return None

        # Check expiration
        now = time.time()
        if now - session.updated_at > self._ttl_seconds:
            logger.info("peitho_session_expired", session_id=session_id)
            del self._sessions[session_id]
            return None

        session.touch()
        return session

    def delete_session(self, session_id: str) -> bool:
        """Explicitly end and remove a session."""
        if session_id in self._sessions:
            del self._sessions[session_id]
            logger.info("peitho_session_deleted", session_id=session_id)
            return True
        return False

    def list_active_sessions(self) -> List[PeithoSessionSummary]:
        """List active sessions for monitoring and health check."""
        self.cleanup_expired()
        summaries = []
        for s in self._sessions.values():
            last_counter = (
                s.master_state.counter_history[-1]
                if s.master_state.counter_history
                else None
            )
            summaries.append(
                PeithoSessionSummary(
                    session_id=s.session_id,
                    product_name=s.config.product_name,
                    created_at=s.created_at,
                    current_round=s.master_state.current_round,
                    max_rounds=s.config.max_rounds,
                    is_active=s.is_active,
                    last_counter=last_counter,
                    transcript_count=len(s.transcript_history),
                )
            )
        return summaries

    def cleanup_expired(self) -> int:
        """Purge sessions that have exceeded TTL."""
        now = time.time()
        expired = [
            sid
            for sid, s in self._sessions.items()
            if now - s.updated_at > self._ttl_seconds
        ]
        for sid in expired:
            del self._sessions[sid]
        if expired:
            logger.info("peitho_expired_sessions_purged", count=len(expired))
        return len(expired)


# Singleton session store instance
peitho_store = PeithoSessionStore()
