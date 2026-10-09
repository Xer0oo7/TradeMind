"""
Peitho Schemas — Pydantic models and data structures for the Peitho Live Assistant.
"""
from dataclasses import dataclass, field
from enum import Enum
import time
from typing import Dict, List, Literal, Optional
from uuid import uuid4
from pydantic import BaseModel, Field

from ..agents.negotiation_engine import NegotiationState, BuyerArchetype


class ChannelType(str, Enum):
    SELLER = "SELLER"
    BUYER = "BUYER"


class PeithoSessionConfig(BaseModel):
    """Configuration required to start a Peitho copilot session."""
    product_id: Optional[str] = Field(default=None, description="Optional DB product identifier")
    product_name: str = Field(default="Standard Item", description="Name of the product")
    base_price: float = Field(gt=0, description="Seller asking price / MSRP")
    cost_price: float = Field(gt=0, description="Seller unit cost")
    min_floor: float = Field(gt=0, description="Absolute floor price seller cannot go below")
    mode: Literal["MAX_PROFIT", "MIN_LOSS"] = Field(
        default="MAX_PROFIT", description="Negotiation engine strategy mode"
    )
    max_rounds: int = Field(default=5, ge=1, le=20, description="Max allowed rounds")
    quantity: int = Field(default=1, ge=1, description="Quantity being negotiated")
    available_inventory: int = Field(default=100, ge=1, description="Current stock level")
    reference_inventory: int = Field(default=100, ge=1, description="Baseline inventory")
    buyer_archetype: str = Field(
        default="UNKNOWN",
        description="Buyer archetype (UNKNOWN, ENTERPRISE, SMB, BUDGET_CONSCIOUS, PROCUREMENT)",
    )
    stt_provider: Optional[str] = Field(
        default=None,
        description="STT provider override ('typed' or 'elevenlabs')",
    )
    language: Optional[str] = Field(
        default=None,
        description="STT language code override (e.g. 'en', 'hi', or 'auto')",
    )


class TranscriptLine(BaseModel):
    """A line of transcribed speech or typed utterance."""
    id: str = Field(default_factory=lambda: str(uuid4()))
    channel: ChannelType
    text: str
    is_partial: bool = False
    timestamp: float = Field(default_factory=time.time)
    confidence: Optional[float] = None


class AdvisoryMetrics(BaseModel):
    """Deterministic telemetry from PRANE-X engine state."""
    bbi: float = Field(description="Buyer Bargaining Index [0-100]")
    p_high_wtp: float = Field(description="Probability of high willingness to pay")
    surplus_share: float = Field(description="Current seller surplus share [0-1]")
    buyer_concession_velocity: float = Field(description="Rate of buyer concession")
    consecutive_stagnant: int = Field(description="Number of stagnant rounds")
    firmness_level: int = Field(description="Engine firmness level [0-3]")
    current_round: int
    max_rounds: int


class AdvisoryResult(BaseModel):
    """Recommendation produced for the human seller when a buyer line is processed."""
    action: str = Field(description="ACCEPT | COUNTER | REJECT | WALK_AWAY")
    counter_price: float = Field(description="Recommended per-unit counter price")
    walk_away: bool = Field(default=False)
    reasoning: str = Field(description="Explanation of why this action was advised")
    extracted_buyer_offer: Optional[float] = None
    extracted_buyer_intent: Optional[str] = None
    extracted_quantity: Optional[int] = None
    suggested_replies: List[str] = Field(
        default_factory=list,
        description="1-2 suggested natural spoken replies for the seller",
    )
    metrics: AdvisoryMetrics
    timestamp: float = Field(default_factory=time.time)
    recommendation_id: Optional[str] = Field(
        default=None,
        description="Unique identifier for this recommendation turn",
    )
    source: Literal["template", "ai"] = Field(
        default="template",
        description="Source of tactical responses: 'template' (Stage 1) or 'ai' (Stage 2)",
    )
    timing: Optional[Dict[str, float]] = Field(
        default=None,
        description="Content-free millisecond timing markers for the turn",
    )


@dataclass
class PeithoSession:
    """Live state container for an active Peitho call session."""
    session_id: str
    config: PeithoSessionConfig
    master_state: NegotiationState
    transcript_history: List[TranscriptLine] = field(default_factory=list)
    last_advisory: Optional[AdvisoryResult] = None
    is_active: bool = True
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)

    def touch(self) -> None:
        self.updated_at = time.time()


class PeithoSessionSummary(BaseModel):
    """Summary of a session for status and health checks."""
    session_id: str
    product_name: str
    created_at: float
    current_round: int
    max_rounds: int
    is_active: bool
    last_counter: Optional[float] = None
    transcript_count: int = 0
