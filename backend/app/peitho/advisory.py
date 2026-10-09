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

from .normalizer import normalize_transcript

logger = structlog.get_logger(__name__)


# ── Patterns to filter out non-price numeric expressions from price extraction ──
NON_PRICE_PATTERNS = [
    # Durations / time: "5 minutes", "2 mins", "30 seconds", "2 hours", "3 days", "4 weeks", "6 months", "2 years"
    re.compile(
        r"\b[0-9]+(?:\.[0-9]+)?\s*(?:minutes?|mins?|seconds?|secs?|hours?|hrs?|days?|weeks?|months?|years?|मिनट|घंटे|घंटा|दिन|हफ्ते|हफ्ता)\b",
        re.IGNORECASE,
    ),
    # Time of day: "5 pm", "5 am", "5:00", "5 o'clock"
    re.compile(r"\b[0-9]{1,2}(?::[0-9]{2})?\s*(?:pm|am|o'?clock)\b", re.IGNORECASE),
    # Percentages: "10%", "10 percent"
    re.compile(r"\b[0-9]+(?:\.[0-9]+)?\s*(?:%|percent(?:age)?|प्रतिशत)\b", re.IGNORECASE),
    # Ordinals, steps, counts: "step 1", "round 2", "option 3", "part 1", "page 5", "version 2", "v1", "tier 3"
    re.compile(
        r"\b(?:step|round|option|part|page|version|v|tier|phase|item|model|choice|point|question)\s+[0-9]+\b",
        re.IGNORECASE,
    ),
    # Ordinal numbers: "1st", "2nd", "3rd", "4th", "5th"
    re.compile(r"\b[0-9]+(?:st|nd|rd|th)\b", re.IGNORECASE),
    # Non-monetary counts: "3 questions", "2 points", "5 people", "4 times", "2 calls"
    re.compile(
        r"\b[0-9]+\s*(?:questions?|points?|times?|people|calls?|meetings?|chances?|options?|steps?|rounds?)\b",
        re.IGNORECASE,
    ),
]

# ── Regex patterns for robust price & quantity extraction from live speech ──
PRICE_PATTERNS = [
    # "$95" or "₹95" or "$ 95.50" or "$1,200"
    re.compile(r"[\$₹]\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)", re.IGNORECASE),
    # "95 dollars" or "95.50 bucks" or "95 rupees" or "95 rs" or "95 inr"
    re.compile(r"\b([0-9]+(?:\.[0-9]{1,2})?)\s*(?:dollars|dollar|bucks|usd|rupees|rupee|rs|inr|रुपये|रुपए)\b", re.IGNORECASE),
    # Explicit offer verbs or prepositions: "at 95", "for 95", "give you 95", "offer 95", "do 95", "settle at 95", "budget is 95"
    re.compile(r"\b(?:at|for|offer|offering|pay|do|counter|about|give\s+you|settle\s+at|budget\s+(?:is|of)?|limit\s+(?:is|of)?|rate\s+(?:is|of)?|price\s+(?:is|of)?|दे\s+सकता|mein|में)\s+([0-9]+(?:\.[0-9]{1,2})?)\b", re.IGNORECASE),
    # "95 apiece" or "95 per unit" or "95 each" or "95 per piece"
    re.compile(r"\b([0-9]+(?:\.[0-9]{1,2})?)\s*(?:each|apiece|per\s+unit|a\s+unit|per\s+piece|a\s+piece)\b", re.IGNORECASE),
]

QUANTITY_PATTERNS = [
    # "10 units" or "10 pieces" or "10 items"
    re.compile(r"\b([0-9]+)\s*(?:units|unit|pcs|pieces|items|quantity|qty|peice|piece)\b", re.IGNORECASE),
    # "take 10" or "order 10" or "buy 10"
    re.compile(r"\b(?:take|order|buy|need|want)\s+([0-9]+)\b", re.IGNORECASE),
]

TOTAL_FOR_QTY_PATTERNS = [
    # "$500 for 10" or "500 for 10 units" or "5000 rupees for 10"
    re.compile(
        r"(?:[\$₹])?([0-9]+(?:\.[0-9]{1,2})?)\s*(?:dollars|rupees|rs|bucks)?\s+(?:total\s+)?for\s+([0-9]+)\s*(?:units|pcs|pieces)?",
        re.IGNORECASE,
    ),
]

# Intent heuristic keywords
ACCEPT_KEYWORDS = [
    "deal", "sounds good", "i'll take it", "ill take it", "take it", "agreed",
    "accept", "works for me", "sold", "let's do it", "lets do it", "done deal",
    "मंजूर", "deal done", "pakka",
]

REJECT_KEYWORDS = [
    "too expensive", "no way", "can't do that", "cant do that", "impossible",
    "too high", "forget it", "no deal", "walk away", "i'll pass", "ill pass",
    "बहुत महंगा", "nahi hoga", "nahi ho payega",
]

INQUIRY_KEYWORDS = [
    "how much", "what is the price", "what's the price", "what can you do",
    "any discount", "best price", "what's your best", "whats your best",
    "kitne ka", "kya price", "kitna discount",
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
        # Pre-normalize spoken numbers, Hindi/Hinglish terms, and currency
        norm_text = normalize_transcript(text) if text else ""
        text_lower = norm_text.lower().strip()

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
            "normalized_message": norm_text,
        }

        # Check for bundle / total patterns: "$500 for 10"
        for pattern in TOTAL_FOR_QTY_PATTERNS:
            match = pattern.search(norm_text)
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

        # Mask non-price numeric expressions (e.g., "5 minutes", "step 2", "10%", "3 questions")
        clean_text = norm_text
        for npp in NON_PRICE_PATTERNS:
            clean_text = npp.sub(" ", clean_text)

        # Extract quantity from clean text
        extracted_qty = None
        for pattern in QUANTITY_PATTERNS:
            match = pattern.search(clean_text)
            if match:
                try:
                    qty = int(match.group(1))
                    if qty > 0:
                        extracted_qty = qty
                        extraction["quantity"] = qty
                        break
                except (ValueError, IndexError):
                    pass

        # Extract price from clean text
        detected_price = None
        has_explicit_currency = bool(
            re.search(r"[\$₹]|dollars?|bucks?|usd|rupees?|rupee|rs|inr|रुपय", norm_text, re.IGNORECASE)
        )

        for pattern in PRICE_PATTERNS:
            match = pattern.search(clean_text)
            if match:
                try:
                    val_str = match.group(1).replace(",", "")
                    val = float(val_str)
                    if val > 0:
                        detected_price = val
                        break
                except (ValueError, IndexError):
                    pass

        # Standalone numbers: only accept if there is negotiation question framing or exact single number
        if detected_price is None:
            stripped_clean = clean_text.strip()
            # 1. Exact single number utterance (e.g. "450?" or "450." or "450")
            exact_match = re.fullmatch(r"^([0-9]+(?:\.[0-9]{1,2})?)\s*[\?\.]*$", stripped_clean)
            if exact_match:
                try:
                    cand = float(exact_match.group(1).replace(",", ""))
                    if cand > 0:
                        detected_price = cand
                except ValueError:
                    pass

            # 2. Conversational negotiation question cues: "Can you do 450?", "How about 450?", "What about 450?"
            if detected_price is None:
                cue_match = re.search(
                    r"\b(?:can\s+(?:we|you)\s+do|how\s+about|what\s+about|could\s+(?:we|you)\s+do|would\s+you\s+take)\s+([0-9]+(?:\.[0-9]{1,2})?)\b",
                    clean_text,
                    re.IGNORECASE,
                )
                if cue_match:
                    try:
                        cand = float(cue_match.group(1).replace(",", ""))
                        if cand > 0:
                            detected_price = cand
                    except ValueError:
                        pass

        # Sanity / plausibility check:
        # If there is NO explicit currency symbol/word, reject numbers that are < 10% of base_price (when base_price >= 20)
        # to prevent random digits (e.g., "3", "1", "2") from masquerading as price offers on high-value products.
        if detected_price is not None and not has_explicit_currency:
            if base_price >= 20.0 and detected_price < (base_price * 0.1):
                detected_price = None

        if detected_price is not None:
            # Sane bounds check: if price is over 2x base price, it might be a total for quantity
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
            # Plausibility check for seller:
            # A human seller wouldn't quote below 50% of cost_price without explicit currency
            has_explicit_currency = bool(
                re.search(r"[\$₹]|dollars?|bucks?|usd|rupees?|rupee|rs|inr|रुपय", seller_text, re.IGNORECASE)
            )
            if not has_explicit_currency and state.cost_price > 0 and detected_price < (state.cost_price * 0.5):
                return None

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
