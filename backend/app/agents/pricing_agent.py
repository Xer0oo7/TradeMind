"""
Pricing Strategy Agent — PRANE-X Integration

Purpose: Orchestrate LLM extraction, the deterministic PRANE-X negotiation
engine, and LLM verbalisation.  ALL economic logic lives in
negotiation_engine.py — this module performs NO arithmetic on prices.

Architecture:
    1. LLM extracts structured intent from buyer message
    2. process_round() (pure function) computes the pricing decision
    3. LLM verbalises the EngineResult into natural language
    4. Post-generation price validator sanitises the LLM output

HARD RULE:  The LLM must NEVER see cost_price, dynamic_floor,
            bbi (raw), p_high_wtp, remaining_concession_budget,
            or any field that reveals internal engine state.
"""
from __future__ import annotations

import json
import re
import structlog
from decimal import Decimal, ROUND_HALF_UP, InvalidOperation
from dataclasses import dataclass, field
from typing import Optional, List, Tuple

from ..models import (
    ProductData,
    InventoryContext,
    StrategicControls,
    BuyerOffer,
    PricingDecision,
    NegotiationMode,
    OfferDecision,
)
from .context_agent import StrategicPosture
from .negotiation_engine import (
    NegotiationState,
    EngineResult,
    NegotiationPhase,
    BuyerArchetype,
    ReasoningTag,
    process_round,
    derive_archetype,
    compute_bulk_target_price,
    TUNING,
)
from ..infrastructure.llm.openai_client import get_llm_client, OpenRouterClient
from ..infrastructure.llm import prompt_templates as llm_prompts

logger = structlog.get_logger(__name__)


# ═══════════════════════════════════════════════════════════════════════════════
# Legacy PricingState kept for backward compatibility with engine.py / session.py
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class PricingState:
    """Mutable state tracking for a negotiation session."""

    current_round: int
    current_offer: Decimal          # Our last offer to the buyer
    buyer_last_offer: Optional[Decimal]
    concession_used: Decimal        # Total $ conceded so far
    offers_history: List[Decimal]   # All our offers (chronological)
    buyer_history: List[Decimal]    # All buyer offers (chronological)

    # ── PRANE-X extension ──────────────────────────────────────
    engine_state: Optional[NegotiationState] = None
    chat_history: list = field(default_factory=list)   # [{"role":"Buyer"/"Seller", "text":...}]

    def __post_init__(self):
        if not isinstance(self.concession_used, Decimal):
            self.concession_used = Decimal(str(self.concession_used))


# ═══════════════════════════════════════════════════════════════════════════════
# LLM EXTRACTION PROMPT
# ═══════════════════════════════════════════════════════════════════════════════

_EXTRACTION_SYSTEM_PROMPT = """You are a structured-data extraction module inside a negotiation engine.
You receive the buyer's raw message and output ONLY a JSON object.
You must NEVER calculate, suggest, or modify any prices.
You must NEVER add commentary. Return ONLY valid JSON."""

_EXTRACTION_USER_TEMPLATE = """Extract structured negotiation intent from this buyer message.

BUYER MESSAGE:
\"\"\"{buyer_message}\"\"\"

CONTEXT:
- Product base price: ₹{base_price}
- Seller's current counter: ₹{current_counter}
- Quantity previously agreed: {quantity}

TOTAL PRICE EXTRACTION PATTERNS:
"X for N units"     → total_price_offered=X, quantity=N, unit_price=X/N
"total of X"        → total_price_offered=X
"X total"           → total_price_offered=X
"total for X"       → total_price_offered=X
"X for all of them" → total_price_offered=X
"X for everything"  → total_price_offered=X
"for both" / "for all" / "for the lot" → always total
When total_price_offered is extracted, always compute unit_price = total / known_quantity.

CONVERSATIONAL INTENT examples (intent=conversational, no price extraction):
"for how many units?"       → conversational (asking current qty)
"what quantity are we at?"  → conversational
"how many are we talking?"  → conversational
"what's the current offer?" → conversational (asking current counter)
"why should I buy this?"    → conversational (value question)
"what was my last offer?"   → conversational (history question)

Return ONLY this JSON (no markdown, no commentary):
{{
  "quantity":               <int or null — if buyer mentions a new quantity>,
  "unit_price_offered":     <float or null — buyer's per-unit price offer>,
  "total_price_offered":    <float or null — buyer's total-price offer>,
  "intent":                 "<offer|inquiry|accept|reject|walkaway|conditional|conversational>",
  "tone":                   "<aggressive|neutral|cooperative|desperate>",
  "anchoring_detected":     <true or false>,
  "urgency_signal":         <true or false>,
  "bundle_request":         <true or false>,
  "social_proof_claim":     <true or false>,
  "competitor_price_claim": <float or null — if buyer claims a cheaper price elsewhere>,
  "conditional_offer":      <true or false — offer contingent on something>,
  "condition_text":         <string or null — what condition the buyer attached>
}}"""


# ═══════════════════════════════════════════════════════════════════════════════
# LLM VERBALIZER PROMPT
# ═══════════════════════════════════════════════════════════════════════════════

_VERBALIZER_SYSTEM_PROMPT = """You are a professional sales negotiator in an active negotiation. The pricing system has
already calculated the exact offer price — your job is ONLY to communicate it naturally.

RULES:
1. Sound human. Natural speech, no corporate filler, no "I appreciate your offer" every time.
2. Vary phrasing every round. If previous_responses exist, use none of their sentence structures.
3. Reference buyer_last_message when relevant — address what they actually said.
4. Firmness level governs tone:
   - firmness_level=0: warm, open, collaborative
   - firmness_level=1: measured, watching — "I need to see some real movement here"
   - firmness_level=2: firm, low on room — "I'm running thin on what I can do"
   - firmness_level=3: genuinely final — "This is as far as I go. I mean it."
5. If budget_exhausted=true AND firmness_level < 3: the reason the counter won't move is
   economic, not strategic. Say so: "I've genuinely hit the floor on what the numbers allow."
   Do NOT say "this is my final offer" — that implies a strategic hold, not a hard limit.
6. If buyer_moving_toward_counter=true AND firmness_level >= 2: acknowledge their movement.
   Give a directional hint: "You're getting close — a little more and we have a deal."
7. Unless the decision is "reject", always include the exact_counter_str value verbatim somewhere in the response.
8. 1–3 sentences maximum. No lists. No bullet points.

PRICE ACCURACY RULE (non-negotiable):
Unless the decision is "reject", your response must include the exact price string from exact_counter_str verbatim.
Copy it character for character. Do not round, abbreviate, or restate it.
Placement is your choice — work it naturally into the sentence.
"""

_VERBALIZER_USER_TEMPLATE = """Generate a short negotiation response.

DECISION CONTEXT:
- Decision: {decision}
{price_line}
- Phase: {phase}
- Reasoning: {reasoning_tag}
- Round: {round_number} of {max_rounds} ({rounds_remaining} remaining)
- Buyer behavior: {bbi_category}
- Quantity: {quantity} unit(s)

REASONING TAG GUIDANCE (use this to set your tone and phrasing):
- BELOW_FLOOR_REJECT: Firm, clear. Do not say "we're getting closer." Invite a better offer.
- BBI_LOWBALL: Push back on the low anchor. Signal it's significantly off. Stay professional.
- RETROGRADE_FINAL: Short and firm. Buyer moved backwards. One sentence, no concession language.
- STAGNATION_FINAL: Note the lack of progress. You need real movement to continue.
- ANCHOR_RESIST: Deflect the anchoring attempt. Restate your value.
- BAYESIAN_HOLD: Brief and confident. No urgency. The offer stands.
- PHASE_CLOSE: Mild urgency. Encourage closure.
- UTILITY_ACCEPT / EXTENDED_UTILITY / LAST_ROUND_ACCEPT: Warm, genuine. Confirm the deal.
- ZOPA_NO_OVERLAP: Signal a real gap. Make the final offer clear. Be respectful.
- ROUND1_HOLD: Polite firmness. It's early. Hold the opening position.
- HISTORICAL_TARGET: Standard counter, no special tone.
- BUDGET_EXHAUSTED: This is the floor. Nothing more to give. Be direct.

CRITICAL LANGUAGE RULES:
- If below_floor is True: NEVER say "we're getting closer" or use positive progress language.
- If offer_gap_pct > 20: Do not express enthusiasm. Be direct and firm.
- If offer_gap_pct < 5: Use encouraging, closing language.
- Match language intensity to the actual gap.

Below floor: {below_floor}
Offer gap pct: {offer_gap_pct}
Firmness level: {firmness_level} (0=normal, 1=cautious, 2=firm, 3=final — higher = more firm)
Buyer moving up: {buyer_moving_up}

PREVIOUS RESPONSES (do NOT reuse any of these phrases or sentence structures):
{previous_responses}

RULES:
{decision_rules}
{conditional_note}
Generate the response:"""


# ═══════════════════════════════════════════════════════════════════════════════
# TEMPLATE FALLBACKS (when LLM is unavailable)
# ═══════════════════════════════════════════════════════════════════════════════

_TEMPLATE_FALLBACKS = {
    "accept": "We have a deal at ₹{counter_unit_price} per unit for {quantity} unit(s) (₹{counter_total_price} total). Thank you!",
    "counter": "I appreciate your offer. My best price is ₹{counter_unit_price} per unit for {quantity} unit(s) (₹{counter_total_price} total).",
    "final_offer": "This is my final offer: ₹{counter_unit_price} per unit for {quantity} unit(s) (₹{counter_total_price} total). I can't go lower.",
    "reject": "Unfortunately we couldn't reach an agreement. Thank you for your time.",
}

# Bug F: Firmness-aware fallback variants for when template fallback triggers
_FIRMNESS_FALLBACKS = {
    0: "I appreciate your offer. My best price is ₹{counter_unit_price} per unit for {quantity} unit(s) (₹{counter_total_price} total).",
    1: "I can offer ₹{counter_unit_price} per unit for {quantity} unit(s) (₹{counter_total_price} total). There's limited room to move further.",
    2: "Our price is ₹{counter_unit_price} per unit for {quantity} unit(s) (₹{counter_total_price} total). We're near our best offer.",
    3: "This is our final offer: ₹{counter_unit_price} per unit for {quantity} unit(s) (₹{counter_total_price} total). I can't go lower.",
}


class PricingStrategyAgent:
    """
    PRANE-X integration layer.

    Internally delegates all pricing logic to the deterministic
    negotiation engine.  The LLM is used strictly for:
    (a) extracting structured data from buyer messages, and
    (b) verbalising the EngineResult into natural language.
    """

    def __init__(self, llm_client: Optional[OpenRouterClient] = None):
        self.llm = llm_client or get_llm_client()

    # ══════════════════════════════════════════════════════════════════════
    # PUBLIC API (unchanged signatures — engine.py keeps working)
    # ══════════════════════════════════════════════════════════════════════

    def compute_initial_offer(
        self,
        product: ProductData,
        inventory: InventoryContext,
        posture: StrategicPosture,
        strategy: Optional["StrategicControls"] = None,
    ) -> Decimal:
        """Seller opens at base price, quantity-adjusted via bulk target."""
        qty = inventory.requested_quantity
        if qty > 1 and strategy is not None:
            mode = strategy.mode.value
            bulk_target = compute_bulk_target_price(
                float(product.base_price), qty, mode,
            )
            initial = Decimal(str(bulk_target))
        elif qty > 1:
            # Fallback: use posture-based discount if strategy not available
            initial = product.base_price * posture.quantity_discount_factor
        else:
            initial = product.base_price
        return self._round_price(max(initial, product.min_acceptable_price))

    def evaluate_offer(
        self,
        buyer_offer: BuyerOffer,
        product: ProductData,
        inventory: InventoryContext,
        strategy: StrategicControls,
        posture: StrategicPosture,
        state: PricingState,
    ) -> PricingDecision:
        """
        Evaluate buyer's offer via the PRANE-X engine.

        1. Ensure NegotiationState exists (lazy-init on first call)
        2. Extract structured intent from buyer message via LLM
        3. Feed extraction to process_round()
        4. Map EngineResult -> PricingDecision for the legacy pipeline
        """
        offered = buyer_offer.offered_price
        quantity = buyer_offer.offered_quantity or inventory.requested_quantity

        # ── 1. Lazy-initialise PRANE-X state ──────────────────────
        if state.engine_state is None:
            buyer_history = []  # No cross-session history available in this path
            archetype = derive_archetype(buyer_history)
            state.engine_state = NegotiationState(
                base_price=float(product.base_price),
                cost_price=float(product.cost_price),
                min_floor=float(product.min_acceptable_price),
                mode=strategy.mode.value,
                max_rounds=strategy.max_rounds,
                quantity=quantity,
                total_sessions=0,
                accepted_deals=0,
                historical_avg_margin=TUNING["target_margin_default"],
                historical_revenue=0.0,
                available_inventory=inventory.available_quantity,
                reference_inventory=inventory.available_quantity,
                buyer_archetype=archetype,
            )

        # ── 2. Build extraction dict ──────────────────────────────
        extraction = self._extract_intent(buyer_offer, state)

        # ── 3. Run engine ─────────────────────────────────────────
        result: EngineResult = process_round(state.engine_state, extraction)

        # ── 4. Map to PricingDecision ─────────────────────────────
        return self._engine_result_to_pricing_decision(
            result, offered, product, posture, state, quantity,
        )

    # ══════════════════════════════════════════════════════════════════════
    # LLM EXTRACTION
    # ══════════════════════════════════════════════════════════════════════

    def _extract_intent(
        self,
        buyer_offer: BuyerOffer,
        state: PricingState,
    ) -> dict:
        """
        Build the extraction dict consumed by process_round().

        When the offer arrives through the structured BuyerOffer path
        (already has a numeric price), we bypass full LLM extraction
        and construct the dict directly.  LLM extraction is attempted
        only when a free-text message is present.
        """
        eng = state.engine_state
        base_extraction = {
            "quantity": buyer_offer.offered_quantity,
            "unit_price_offered": float(buyer_offer.offered_price),
            "total_price_offered": None,
            "intent": "offer",
            "tone": "neutral",
            "anchoring_detected": False,
            "urgency_signal": False,
            "bundle_request": False,
            "social_proof_claim": False,
            "competitor_price_claim": None,
            "conditional_offer": False,
            "condition_text": None,
            "raw_message": buyer_offer.message or "",  # Patch 3: pass through for verbalize
        }

        if not buyer_offer.message or not self.llm.enabled:
            return base_extraction

        # Attempt LLM extraction for richer signal
        try:
            prompt = _EXTRACTION_USER_TEMPLATE.format(
                buyer_message=buyer_offer.message,
                base_price=eng.base_price if eng else "N/A",
                current_counter=(
                    eng.counter_history[-1]
                    if eng and eng.counter_history
                    else eng.base_price if eng else "N/A"
                ),
                quantity=eng.quantity if eng else 1,
            )
            llm_result = self.llm.generate_sync(
                system_prompt=_EXTRACTION_SYSTEM_PROMPT,
                user_prompt=prompt,
                temperature=0.1,
            )
            if llm_result.success:
                data = json.loads(self._clean_json(llm_result.content))
                # Merge LLM signals into base (keep the hard price from BuyerOffer)
                base_extraction["tone"] = data.get("tone", "neutral")
                base_extraction["anchoring_detected"] = bool(data.get("anchoring_detected"))
                base_extraction["urgency_signal"] = bool(data.get("urgency_signal"))
                base_extraction["bundle_request"] = bool(data.get("bundle_request"))
                base_extraction["social_proof_claim"] = bool(data.get("social_proof_claim"))
                # Upgrade 4: enriched extraction fields
                comp_claim = data.get("competitor_price_claim")
                if comp_claim is not None:
                    try:
                        base_extraction["competitor_price_claim"] = float(comp_claim)
                    except (ValueError, TypeError):
                        pass
                base_extraction["conditional_offer"] = bool(data.get("conditional_offer"))
                base_extraction["condition_text"] = data.get("condition_text")
                if data.get("intent") in ("accept", "reject", "walkaway", "conditional"):
                    # Guard: "I'll take it for $X" where X diverges
                    # from the counter is a counter-offer, NOT acceptance.
                    if (
                        data["intent"] == "accept"
                        and base_extraction["unit_price_offered"] is not None
                    ):
                        last_ctr = (
                            eng.counter_history[-1]
                            if eng and eng.counter_history
                            else eng.base_price if eng else None
                        )
                        if last_ctr and last_ctr > 0:
                            divergence = abs(
                                base_extraction["unit_price_offered"] - last_ctr
                            ) / last_ctr
                            if divergence > 0.02:
                                # >2% away from counter — it's an offer
                                pass  # keep intent as "offer"
                            else:
                                base_extraction["intent"] = "accept"
                        else:
                            base_extraction["intent"] = "accept"
                    else:
                        base_extraction["intent"] = data["intent"]
                # Merge quantity from LLM if not already set
                llm_qty = data.get("quantity")
                if llm_qty and base_extraction["quantity"] is None:
                    try:
                        llm_qty = int(llm_qty)
                        if llm_qty > 0:
                            base_extraction["quantity"] = llm_qty
                    except (ValueError, TypeError):
                        pass
        except Exception as e:
            logger.warning("llm_extraction_failed", error=str(e))

        return base_extraction

    # ══════════════════════════════════════════════════════════════════════
    # RESULT MAPPING
    # ══════════════════════════════════════════════════════════════════════

    def _engine_result_to_pricing_decision(
        self,
        result: EngineResult,
        offered: Decimal,
        product: ProductData,
        posture: StrategicPosture,
        state: PricingState,
        quantity: int,
    ) -> PricingDecision:
        """Map EngineResult -> legacy PricingDecision."""

        # Translate decision
        if result.decision == "accept":
            decision = OfferDecision.ACCEPT
        elif result.decision == "reject":
            decision = OfferDecision.REJECT
        else:
            decision = OfferDecision.COUNTER

        counter_price = (
            Decimal(str(result.counter_unit_price))
            if decision == OfferDecision.COUNTER
            else None
        )

        # Deterministic metrics
        margin_pct, profit_unit, total_profit = self._compute_metrics(
            offered if decision == OfferDecision.ACCEPT else Decimal(str(result.counter_unit_price)),
            product.cost_price,
            quantity,
        )

        concession_made = Decimal("0")
        if decision == OfferDecision.COUNTER and counter_price is not None:
            if counter_price < state.current_offer:
                concession_made = state.current_offer - counter_price

        remaining_budget = Decimal(str(result.remaining_concession_budget))
        if state.engine_state and state.engine_state.total_concession_budget > 0:
            total_budget = Decimal(str(state.engine_state.total_concession_budget))
        else:
            total_budget = posture.total_concession_budget
        if total_budget <= 0:
            budget_used_pct = Decimal("0")
        else:
            budget_used_pct = (total_budget - remaining_budget) / total_budget * 100
            budget_used_pct = max(Decimal("0"), min(Decimal("100"), budget_used_pct))

        violations = []
        if offered < product.min_acceptable_price:
            violations.append(f"below_min_acceptable: {offered} < {product.min_acceptable_price}")
        if offered < product.cost_price:
            violations.append(f"below_cost: {offered} < {product.cost_price}")

        return PricingDecision(
            decision=decision,
            counter_offer_price=counter_price,
            accepted_price=Decimal(str(result.counter_unit_price)) if decision == OfferDecision.ACCEPT else None,
            is_final_offer=result.decision == "final_offer",
            reasoning_tag=result.reasoning_tag.value,
            margin_percentage=margin_pct,
            profit_per_unit=profit_unit,
            total_profit=total_profit,
            within_constraints=len(violations) == 0,
            constraint_violations=violations,
            concession_made=concession_made,
            remaining_concession_budget=self._round_price(remaining_budget),
            concession_percentage_used=self._round_price(budget_used_pct),
        )

    # ══════════════════════════════════════════════════════════════════════
    # PRICE VALIDATOR (mandatory on every verbalizer output)
    # ══════════════════════════════════════════════════════════════════════

    @staticmethod
    def validate_and_sanitize_prices(
        text: str,
        counter_unit_price: float,
        counter_total_price: float,
    ) -> str:
        """
        Scan LLM output for prices and replace any that diverge from
        the engine's counter_unit_price / counter_total_price.

        Skips small numbers (< 20) that are likely round numbers,
        quantities, or other non-price references.
        """
        pattern = re.compile(r'[$₹][\d,]+\.?\d*')
        def _replacer(match: re.Match) -> str:
            raw = match.group(0).replace(",", "").lstrip("$₹")
            try:
                value = float(raw)
            except ValueError:
                return match.group(0)
            # Skip numbers too small to be prices (round numbers, quantities)
            if value < 20.0:
                return match.group(0)
            if abs(value - counter_unit_price) <= 1.00:
                return match.group(0)
            if abs(value - counter_total_price) <= 1.00:
                return match.group(0)
            # Divergent price — replace with unit price
            prefix = "₹" if match.group(0).startswith(("₹", "$")) else ""
            return f"{prefix}{counter_unit_price:.2f}"
        return pattern.sub(_replacer, text)

    # ══════════════════════════════════════════════════════════════════════
    # LLM VERBALIZER
    # ══════════════════════════════════════════════════════════════════════

    def verbalize(self, result: EngineResult, state: NegotiationState) -> str:
        """
        Convert an EngineResult into a natural-language response.

        The LLM must NEVER see internal state. Only the verb_context
        (a curated subset) is passed.
        """
        # Compute gap metrics for language calibration (Upgrade 8)
        last_counter_val = result.counter_unit_price
        current_bid = state.offer_history[-1] if state.offer_history else 0.0
        below_floor = current_bid < state.dynamic_floor
        offer_gap_pct = round(
            abs(last_counter_val - current_bid) / last_counter_val * 100, 1
        ) if last_counter_val > 0 else 0.0

        # Collect previous Seller responses for variety (Upgrade 5)
        prev_responses: List[str] = []
        for entry in getattr(state, '_chat_history_cache', []):
            if isinstance(entry, dict) and entry.get("role") == "Seller":
                prev_responses.append(entry["text"])
        prev_str = "\n".join(f"- {r}" for r in prev_responses[-3:]) if prev_responses else "(none yet)"

        # Conditional note for conditional offers
        conditional_note = ""

        # ── Graduated firmness context (for LLM tone calibration) ──
        firmness_level = getattr(state, 'firmness_level', 0)
        buyer_moving = False
        if len(state.offer_history) >= 2:
            buyer_moving = state.offer_history[-1] > state.offer_history[-2]

        verb_context = {
            "counter_unit_price":       result.counter_unit_price,
            "counter_total_price":      result.counter_total_price,
            "decision":                 result.decision,
            "reasoning_tag":            result.reasoning_tag.value,
            "phase":                    result.phase.value,
            "round_number":             result.round_number,
            "max_rounds":               state.max_rounds,
            "rounds_remaining":         result.rounds_remaining,
            "bbi_category":             result.bbi_category,
            "quantity":                 state.quantity,
            "below_floor":              below_floor,
            "offer_gap_pct":            offer_gap_pct,
            "previous_responses":       prev_str,
            "conditional_note":         conditional_note,
            "firmness_level":           firmness_level,
            "buyer_moving_up":          buyer_moving,
            # Patch 3: enriched verbalize context
            "exact_counter_str":        f"₹{result.counter_unit_price:.2f}",
            "exact_total_str":          f"₹{result.counter_unit_price * state.quantity:.2f}",
            "exact_qty":                str(int(state.quantity)),
            "buyer_last_message":       getattr(state, '_last_buyer_message', None) or "",
            "buyer_moving_toward_counter": buyer_moving,
            "budget_exhausted":         (
                state.remaining_concession_budget < float(state.base_price) * 0.01
            ),
        }

        raw_response: Optional[str] = None

        if self.llm.enabled:
            try:
                # Escape any curly braces in previous_responses before formatting.
                # If a prior LLM response contained "{" or "}" (e.g. JSON snippets,
                # quantity references like "{5 units}"), Python's str.format() would
                # try to interpret them as format fields and raise KeyError, causing
                # every subsequent round to silently fall back to templates.
                is_reject = result.decision == "reject"
                if is_reject:
                    price_line = "- No counter offer is made (negotiation terminated)"
                    decision_rules = (
                        "- Since decision is \"reject\", end the negotiation respectfully.\n"
                        "- Do NOT mention any prices, counter-offers, minimum acceptable price, cost, floors, or financial limits in your response. Just say that we cannot meet their requirements and wish them the best."
                    )
                else:
                    price_line = f"- Our counter price: ₹{result.counter_unit_price:.2f} per unit (total: ₹{result.counter_unit_price * state.quantity:.2f} for {state.quantity} unit(s))"
                    decision_rules = (
                        f"- If decision is \"accept\": confirm the deal at ₹{result.counter_unit_price:.2f} per unit.\n"
                        f"- If decision is \"counter\": present ₹{result.counter_unit_price:.2f} as our offer.\n"
                        f"- If decision is \"final_offer\": make clear this is our final offer at ₹{result.counter_unit_price:.2f}.\n"
                        f"- You MUST mention the price ₹{result.counter_unit_price:.2f} per unit in your response.\n"
                        f"- When quantity is more than 1, ALWAYS also state the total of ₹{result.counter_unit_price * state.quantity:.2f} for {state.quantity} units.\n"
                        f"- Do NOT mention any price other than ₹{result.counter_unit_price:.2f} (unit) or ₹{result.counter_unit_price * state.quantity:.2f} (total)."
                    )

                safe_ctx = dict(verb_context)
                safe_ctx["price_line"] = price_line
                safe_ctx["decision_rules"] = decision_rules
                if is_reject:
                    safe_ctx["counter_unit_price"] = ""
                    safe_ctx["counter_total_price"] = ""
                    safe_ctx["exact_counter_str"] = ""
                    safe_ctx["exact_total_str"] = ""

                safe_ctx["previous_responses"] = (
                    safe_ctx.get("previous_responses", "(none yet)")
                    .replace("{", "(")
                    .replace("}", ")")
                )
                prompt = _VERBALIZER_USER_TEMPLATE.format(**safe_ctx)
                llm_result = self.llm.generate_sync(
                    system_prompt=_VERBALIZER_SYSTEM_PROMPT,
                    user_prompt=prompt,
                    temperature=0.7,
                )
                if llm_result.success and len(llm_result.content.strip()) > 10:
                    raw_response = llm_result.content.strip()
                else:
                    logger.warning(
                        "verbalizer_llm_no_content",
                        success=llm_result.success,
                        error=llm_result.error,
                        content_len=len(llm_result.content.strip()),
                        round=verb_context.get("round_number"),
                    )
            except Exception as e:
                logger.warning(
                    "verbalizer_format_error",
                    error=str(e),
                    error_type=type(e).__name__,
                    round=verb_context.get("round_number"),
                )

        if raw_response is None:
            raw_response = self._template_fallback(verb_context)

        # MANDATORY price validator
        return self.validate_and_sanitize_prices(
            raw_response,
            result.counter_unit_price,
            result.counter_total_price,
        )

    @staticmethod
    def _template_fallback(ctx: dict) -> str:
        decision = ctx["decision"]
        # Bug F: Use firmness-aware fallback for counter decisions
        if decision == "counter":
            firmness = ctx.get("firmness_level", 0)
            tpl = _FIRMNESS_FALLBACKS.get(firmness, _FIRMNESS_FALLBACKS[0])
        else:
            tpl = _TEMPLATE_FALLBACKS.get(decision, _TEMPLATE_FALLBACKS["counter"])
        return tpl.replace("₹{counter_unit_price}", f'{ctx["counter_unit_price"]:.2f}').replace(
            "₹{counter_total_price}", f'{ctx["counter_total_price"]:.2f}'
        ).replace("${counter_unit_price}", f'{ctx["counter_unit_price"]:.2f}').replace(
            "${counter_total_price}", f'{ctx["counter_total_price"]:.2f}'
        ).replace("{quantity}", str(ctx["quantity"]))

    # ══════════════════════════════════════════════════════════════════════
    # UTILITIES
    # ══════════════════════════════════════════════════════════════════════

    def _compute_metrics(
        self,
        price: Decimal,
        cost: Decimal,
        quantity: int,
    ) -> Tuple[Decimal, Decimal, Decimal]:
        """Compute margin %, profit per unit, total profit."""
        profit_unit = price - cost
        total_profit = profit_unit * quantity
        if price > 0:
            margin_pct = (profit_unit / price * 100).quantize(
                Decimal("0.01"), rounding=ROUND_HALF_UP
            )
        else:
            margin_pct = Decimal("0")
        return margin_pct, profit_unit, total_profit

    def _round_price(self, price: Decimal) -> Decimal:
        """Round price to 2 decimal places. Handles edge cases."""
        try:
            return price.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        except (InvalidOperation, OverflowError):
            logger.warning("price_rounding_error", price=str(price))
            return Decimal("0.00")

    def _clean_json(self, content: str) -> str:
        """Strip markdown fences from LLM JSON response."""
        content = content.strip()
        if content.startswith("```"):
            content = content.split("\n", 1)[1] if "\n" in content else content[3:]
            if content.endswith("```"):
                content = content[:-3]
            content = content.strip()
        return content
