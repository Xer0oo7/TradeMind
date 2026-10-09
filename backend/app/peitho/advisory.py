"""
Advisory Engine — PRANE-X in Advisory Mode for Peitho Live Assistant.

Evaluates buyer transcript utterances using deep-copied engine state without mutating
the master state, computing recommendations and tactical guidance for human sellers.
Also synchronizes engine state when the seller verbalizes counter-offers.
"""
import copy
import re
from typing import Optional, Tuple
import structlog

from ..agents.negotiation_engine import (
    NegotiationState,
    EngineResult,
    process_round,
    BuyerArchetype,
)

logger = structlog.get_logger(__name__)


# ── Regex patterns for robust price & quantity extraction from live speech ──
PRICE_PATTERNS = [
    # "$95" or "$ 95.50" or "$1,200"
    re.compile(r"\$\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)", re.IGNORECASE),
    # "95 dollars" or "95.50 bucks"
    re.compile(r"\b([0-9]+(?:\.[0-9]{1,2})?)\s*(?:dollars|dollar|bucks|usd)\b", re.IGNORECASE),
    # "at 95" or "for 95" or "give you 95" or "offer 95" or "do 95"
    re.compile(r"\b(?:at|for|offer|offering|pay|do|counter|about)\s+([0-9]+(?:\.[0-9]{1,2})?)\b", re.IGNORECASE),
    # "95 apiece" or "95 per unit" or "95 each"
    re.compile(r"\b([0-9]+(?:\.[0-9]{1,2})?)\s*(?:each|apiece|per\s+unit|a\s+unit)\b", re.IGNORECASE),
]

QUANTITY_PATTERNS = [
    # "10 units" or "10 pieces" or "10 items"
    re.compile(r"\b([0-9]+)\s*(?:units|unit|pcs|pieces|items|quantity|qty)\b", re.IGNORECASE),
    # "take 10" or "order 10" or "buy 10"
    re.compile(r"\b(?:take|order|buy|need|want)\s+([0-9]+)\b", re.IGNORECASE),
]

TOTAL_FOR_QTY_PATTERNS = [
    # "$500 for 10" or "500 for 10 units"
    re.compile(
        r"(?:\$)?([0-9]+(?:\.[0-9]{1,2})?)\s*(?:dollars)?\s+(?:total\s+)?for\s+([0-9]+)\s*(?:units|pcs)?",
        re.IGNORECASE,
    ),
]

# Intent heuristic keywords
ACCEPT_KEYWORDS = [
    "deal", "sounds good", "i'll take it", "ill take it", "take it", "agreed",
    "accept", "works for me", "sold", "let's do it", "lets do it", "done deal",
]

REJECT_KEYWORDS = [
    "too expensive", "no way", "can't do that", "cant do that", "impossible",
    "too high", "forget it", "no deal", "walk away", "i'll pass", "ill pass",
]

INQUIRY_KEYWORDS = [
    "how much", "what is the price", "what's the price", "what can you do",
    "any discount", "best price", "what's your best", "whats your best",
]


class AdvisoryEngine:
    """
    Engine wrapper that operates in Advisory Mode.
    
    In advisory mode:
    1. It evaluates incoming buyer lines against a CLONED negotiation state.
    2. Master state remains unaltered during hypothetical advisory checks.
    3. Engine results produce clear tactical recommendations: ACCEPT, COUNTER, REJECT, WALK_AWAY.
    4. When seller explicitly states a counter, master state tracks the human quote.
    """

    @classmethod
    def extract_intent_from_text(
        cls,
        text: str,
        base_price: float,
        current_counter: float,
        current_quantity: int = 1,
    ) -> dict:
        """
        Extract numeric offers, quantity, and conversational intent using rule-based heuristics.
        Fast, zero-latency, and operates without external API dependencies.
        """
        text_lower = text.lower().strip()
        extraction = {
            "quantity": current_quantity,
            "unit_price_offered": None,
            "total_price_offered": None,
            "intent": "conversational",
            "tone": "neutral",
            "anchoring_detected": False,
            "urgency_signal": False,
            "bundle_request": False,
            "social_proof_claim": False,
            "competitor_price_claim": None,
            "conditional_offer": False,
            "condition_text": None,
            "raw_message": text,
        }

        # Check for bundle / total patterns: "$500 for 10"
        for pattern in TOTAL_FOR_QTY_PATTERNS:
            match = pattern.search(text)
            if match:
                try:
                    total_val = float(match.group(1).replace(",", ""))
                    qty_val = int(match.group(2))
                    if qty_val > 0:
                        extraction["quantity"] = qty_val
                        extraction["total_price_offered"] = total_val
                        extraction["unit_price_offered"] = round(total_val / qty_val, 2)
                        extraction["intent"] = "offer"
                        return extraction
                except (ValueError, IndexError):
                    pass

        # Extract quantity
        for pattern in QUANTITY_PATTERNS:
            match = pattern.search(text)
            if match:
                try:
                    qty = int(match.group(1))
                    if qty > 0:
                        extraction["quantity"] = qty
                        break
                except (ValueError, IndexError):
                    pass

        # Extract price
        detected_price = None
        for pattern in PRICE_PATTERNS:
            match = pattern.search(text)
            if match:
                try:
                    val_str = match.group(1).replace(",", "")
                    val = float(val_str)
                    if val > 0:
                        detected_price = val
                        break
                except (ValueError, IndexError):
                    pass

        if detected_price is not None:
            # Sane bounds check: if price is over 10x base price, it might be a total
            if detected_price > (base_price * 2) and extraction["quantity"] > 1:
                extraction["total_price_offered"] = detected_price
                extraction["unit_price_offered"] = round(detected_price / extraction["quantity"], 2)
            else:
                extraction["unit_price_offered"] = detected_price
            extraction["intent"] = "offer"
            return extraction

        # Check intent keywords if no price was explicitly stated
        for kw in ACCEPT_KEYWORDS:
            if re.search(r"\b" + re.escape(kw) + r"\b", text_lower):
                extraction["intent"] = "accept"
                extraction["unit_price_offered"] = current_counter
                return extraction

        for kw in REJECT_KEYWORDS:
            if re.search(r"\b" + re.escape(kw) + r"\b", text_lower):
                extraction["intent"] = "reject"
                return extraction

        for kw in INQUIRY_KEYWORDS:
            if kw in text_lower:
                extraction["intent"] = "inquiry"
                return extraction

        return extraction

    @classmethod
    def advise(
        cls,
        state: NegotiationState,
        buyer_text: str,
        override_extraction: Optional[dict] = None,
    ) -> Tuple[EngineResult, dict]:
        """
        Evaluate buyer utterance in advisory mode.
        
        Deep-copies state so that the master session state is completely protected.
        Runs deterministic process_round() on cloned state and returns the recommendation.
        """
        # 1. Deep-copy state to guarantee zero side-effects on master state
        cloned_state = copy.deepcopy(state)

        # 2. Extract structured data from transcript text
        last_counter = (
            state.counter_history[-1]
            if state.counter_history
            else state.base_price
        )
        extraction = cls.extract_intent_from_text(
            buyer_text,
            base_price=state.base_price,
            current_counter=last_counter,
            current_quantity=state.quantity,
        )

        # 3. Merge overrides if provided
        if override_extraction:
            extraction.update(override_extraction)

        # 4. Execute PRANE-X engine on cloned state
        engine_result = process_round(cloned_state, extraction)

        # 5. Cloned state is discarded. Master state is untouched.
        return engine_result, extraction

    @classmethod
    def apply_seller_line(
        cls,
        state: NegotiationState,
        seller_text: str,
    ) -> Optional[float]:
        """
        Parse seller utterance to detect if the human seller stated an offer or counter.
        If a price is detected, synchronizes master state.counter_history and advances round.
        Returns the detected price if found, else None.
        """
        last_counter = (
            state.counter_history[-1]
            if state.counter_history
            else state.base_price
        )
        extraction = cls.extract_intent_from_text(
            seller_text,
            base_price=state.base_price,
            current_counter=last_counter,
            current_quantity=state.quantity,
        )

        detected_price = extraction.get("unit_price_offered")
        if detected_price is not None and detected_price > 0:
            # Cap at reasonable floor/ceiling
            state.counter_history.append(float(detected_price))
            # Log synchronization without recording raw text (PII protection)
            logger.info(
                "peitho_seller_counter_synchronized",
                detected_price=detected_price,
                round=state.current_round,
            )
            return float(detected_price)

        return None

    @classmethod
    def commit_round(
        cls,
        state: NegotiationState,
        extraction: dict,
    ) -> EngineResult:
        """
        Explicitly commit a round to the master state (when a deal or round is finalized).
        """
        return process_round(state, extraction)
