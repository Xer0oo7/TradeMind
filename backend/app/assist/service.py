"""
service.py — Seller assist: economics, zone, engine suggestion, verdict.

build_assist(product_row: dict, payload: AssistPayload) -> dict

SECURITY:
- Never logs message bodies with money fields.
- Never passes cost/floor/margin to any LLM.
- All computations are pure arithmetic; no network calls.
- Response time < 300 ms.
"""
from __future__ import annotations

import math
import logging
from typing import Optional, Any

from .extractor import extract_offer
from ..agents.negotiation_engine import (
    NegotiationState,
    BuyerArchetype,
    process_round,
    TUNING,
)

_log = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# PAYLOAD SCHEMA (used by routes.py — validated via Pydantic there)
# ─────────────────────────────────────────────────────────────────────────────

class AssistPayload:
    """Lightweight container, validated upstream by Pydantic."""
    def __init__(
        self,
        product_id: int,
        message: str,
        quantity: Optional[int],
        seller_last_offer: Optional[float],
        buyer_last_offer: Optional[float],
        round_number: int,
        override_unit_price: Optional[float],
        available_inventory: Optional[int],
    ):
        self.product_id = product_id
        self.message = message
        self.quantity = quantity
        self.seller_last_offer = seller_last_offer
        self.buyer_last_offer = buyer_last_offer
        self.round_number = round_number
        self.override_unit_price = override_unit_price
        self.available_inventory = available_inventory


# ─────────────────────────────────────────────────────────────────────────────
# NEUTRAL REFERENCE_INVENTORY that yields inventory_ratio == 1.0
# ─────────────────────────────────────────────────────────────────────────────

def _neutral_reference(available: int) -> int:
    """Returns a reference_inventory so that inventory_ratio == 1.0."""
    return max(available, 1)


# ─────────────────────────────────────────────────────────────────────────────
# ECONOMICS
# ─────────────────────────────────────────────────────────────────────────────

def _compute_economics(
    offer: float,
    cost: float,
    floor: float,
    base: float,
    qty: int,
    seller_last_offer: Optional[float],
) -> dict:
    """
    Compute seller-side economics for the offer.
    Uses the same margin formula as pricing_agent.py:
        margin_pct = (offer - cost) / offer * 100
    """
    unit_profit = round(offer - cost, 2)
    margin_pct = round(unit_profit / offer * 100, 2) if offer > 0 else 0.0
    total_profit = round(unit_profit * qty, 2)
    discount_vs_base_pct = round((base - offer) / base * 100, 2) if base > 0 else 0.0
    gap_to_floor = round(offer - floor, 2)
    below_cost = offer < cost
    below_floor = offer < floor

    result = {
        "unit_profit": unit_profit,
        "margin_pct": margin_pct,
        "total_profit": total_profit,
        "discount_vs_base_pct": discount_vs_base_pct,
        "gap_to_floor": gap_to_floor,
        "below_cost": below_cost,
        "below_floor": below_floor,
    }

    if seller_last_offer is not None and seller_last_offer > 0:
        result["vs_seller_offer"] = round(offer - seller_last_offer, 2)
        result["seller_offer_gap_pct"] = round(
            (seller_last_offer - offer) / seller_last_offer * 100, 2
        )

    return result


def _zone(economics: dict) -> str:
    if economics["below_cost"]:
        return "red"
    if economics["below_floor"]:
        return "amber"
    return "green"


# ─────────────────────────────────────────────────────────────────────────────
# ENGINE SUGGESTION
# ─────────────────────────────────────────────────────────────────────────────

def _build_state(product_row: dict, payload: AssistPayload, qty: int) -> NegotiationState:
    """
    Construct a NegotiationState from the DB product row and payload.
    Seeds offer_history and counter_history from the payload.
    Uses neutral inventory ratio (1.0) when available_inventory is None.
    """
    available = payload.available_inventory
    if available is None:
        # Neutral: inventory_ratio = 1.0 → no pressure adjustment
        available = qty  # ratio = qty/qty = 1.0
    ref_inv = _neutral_reference(available)

    offer_hist: list[float] = []
    if payload.buyer_last_offer is not None:
        offer_hist = [payload.buyer_last_offer]

    counter_hist: list[float] = []
    if payload.seller_last_offer is not None:
        counter_hist = [payload.seller_last_offer]

    state = NegotiationState(
        base_price=float(product_row["base_price"]),
        cost_price=float(product_row["cost_price"]),
        min_floor=float(product_row["min_acceptable_price"]),
        mode=product_row["mode"],
        max_rounds=int(product_row["max_rounds"]),
        quantity=qty,
        total_sessions=int(product_row.get("total_sessions") or 0),
        accepted_deals=int(product_row.get("accepted_deals") or 0),
        historical_avg_margin=float(product_row.get("avg_margin") or TUNING["target_margin_default"]),
        historical_revenue=float(product_row.get("revenue") or 0.0),
        available_inventory=available,
        reference_inventory=ref_inv,
        buyer_archetype=BuyerArchetype.UNKNOWN,
        offer_history=offer_hist,
        counter_history=counter_hist,
        current_round=max(0, payload.round_number - 1),
    )
    return state


def _get_engine_suggestion(
    offer: float,
    product_row: dict,
    payload: AssistPayload,
    qty: int,
    seller_last_offer: Optional[float],
    floor: float,
    cost: float,
) -> tuple[Optional[dict], bool]:
    """
    Call process_round with a synthetic extraction dict.
    Returns (suggestion dict | None, engine_error bool).

    Invariants enforced on counter:
    - counter >= max(floor, cost)
    - counter <= seller_last_offer (when given)
    """
    try:
        state = _build_state(product_row, payload, qty)

        extraction = {
            "unit_price_offered": offer,
            "total_price_offered": round(offer * qty, 2),
            "quantity": qty,
            "resolved_unit_price": offer,
            "tone": "neutral",
            "anchoring_detected": False,
            "urgency_signal": False,
            "raw_message": None,
        }

        result = process_round(state, extraction)

        counter = float(result.counter_unit_price)

        # Enforce floor/cost
        counter = max(counter, max(floor, cost))

        # Enforce counter <= seller_last_offer
        if seller_last_offer is not None:
            counter = min(counter, seller_last_offer)

        counter = round(counter, 2)

        reply = (
            f"I can do ₹{counter:,.2f} per unit"
            + (f" for {qty} units." if qty > 1 else ".")
        )

        return {
            "counter_price": counter,
            "reply_text": reply,
            "source": "engine",
            "action": result.decision,
        }, False

    except Exception as exc:
        # Log ids only — no price/message data
        _log.exception(
            "assist_engine_error product_id=%s round=%d",
            product_row.get("id"),
            payload.round_number,
        )
        return None, True


# ─────────────────────────────────────────────────────────────────────────────
# VERDICT
# ─────────────────────────────────────────────────────────────────────────────

def _make_headline(
    economics: dict,
    zone: str,
    suggestion: Optional[dict],
    accepts: bool,
    floor: float,
    cost: float,
    base: float,
) -> str:
    offer = economics.get("unit_profit", 0) + cost  # recover offer
    # Recover the actual offer price from unit_profit
    actual_offer = round(cost + economics["unit_profit"], 2)

    if accepts:
        if zone == "green":
            return (
                f"Buyer accepted at ₹{actual_offer:,.2f} — above floor. "
                "Closing this deal is profitable."
            )
        elif zone == "amber":
            return (
                f"Buyer accepted at ₹{actual_offer:,.2f} — below floor but above cost. "
                "Margin is thin; closing at your discretion."
            )
        else:
            return (
                f"Buyer accepted at ₹{actual_offer:,.2f} — BELOW COST. "
                "This deal results in a loss."
            )

    if zone == "green":
        if suggestion and suggestion.get("action") == "counter":
            ctr = suggestion["counter_price"]
            return (
                f"Offer ₹{actual_offer:,.2f} is acceptable (above floor). "
                f"Engine suggests countering at ₹{ctr:,.2f} to maximize profit."
            )
        return f"Offer ₹{actual_offer:,.2f} is above floor. Consider accepting."

    if zone == "amber":
        return (
            f"Offer ₹{actual_offer:,.2f} is above cost but below your floor. "
            "Negotiate up or walk away."
        )

    return (
        f"Offer ₹{actual_offer:,.2f} is BELOW COST — accepting loses money. "
        "Counter or walk away."
    )


# ─────────────────────────────────────────────────────────────────────────────
# PUBLIC ENTRY POINT
# ─────────────────────────────────────────────────────────────────────────────

def build_assist(product_row: dict, payload: AssistPayload) -> dict:
    """
    Main assist computation. Returns a dict with:
        detected: dict | None
        economics: dict | None
        verdict: {zone, action, headline} | None
        suggestion: {counter_price, reply_text, source} | None
        engine_error: bool
        warnings: list[str]
    """
    warnings: list[str] = []

    # ── 1. Detect offer ─────────────────────────────────────────────
    base_price = float(product_row["base_price"])
    cost_price = float(product_row["cost_price"])
    floor_price = float(product_row["min_acceptable_price"])
    qty = payload.quantity or 1

    detected: Optional[dict] = None
    offer_price: Optional[float] = None

    if payload.override_unit_price is not None:
        offer_price = payload.override_unit_price
        detected = {
            "unit_price": offer_price,
            "quantity": qty,
            "price_basis": "unit",
            "confidence": "high",
            "accepts": False,
            "intent": "offer",
            "flags": ["override"],
            "alt_unit_price": None,
            "currency": None,
        }
    else:
        detected = extract_offer(
            payload.message,
            base_price=base_price,
            seller_last_offer=payload.seller_last_offer,
        )

        if detected.get("unit_price"):
            offer_price = detected["unit_price"]
        elif detected.get("intent") == "accept" and payload.seller_last_offer:
            offer_price = payload.seller_last_offer
        elif detected.get("total_price") and qty > 0:
            offer_price = round(detected["total_price"] / qty, 2)

    # No offer detected → return minimal response
    if offer_price is None:
        return {
            "detected": detected,
            "economics": None,
            "verdict": None,
            "suggestion": None,
            "engine_error": False,
            "warnings": warnings,
        }

    # ── 2. Warnings ─────────────────────────────────────────────────
    if detected and "basis_assumed" in detected.get("flags", []):
        alt = detected.get("alt_unit_price")
        if alt:
            warnings.append(
                f"basis_assumed: read as ₹{offer_price:,.2f} each; "
                f"alternative: ₹{alt:,.2f} each."
            )

    if detected and "possible_typo" in detected.get("flags", []):
        warnings.append("possible_typo: price is far from the base price.")

    # ── 3. Economics ─────────────────────────────────────────────────
    economics = _compute_economics(
        offer=offer_price,
        cost=cost_price,
        floor=floor_price,
        base=base_price,
        qty=qty,
        seller_last_offer=payload.seller_last_offer,
    )

    zone = _zone(economics)

    # ── 4. Engine suggestion ─────────────────────────────────────────
    suggestion, engine_error = _get_engine_suggestion(
        offer=offer_price,
        product_row=product_row,
        payload=payload,
        qty=qty,
        seller_last_offer=payload.seller_last_offer,
        floor=floor_price,
        cost=cost_price,
    )

    action = suggestion["action"] if suggestion else "unknown"

    # ── 5. Verdict ───────────────────────────────────────────────────
    headline = _make_headline(
        economics=economics,
        zone=zone,
        suggestion=suggestion,
        accepts=bool(detected and detected.get("accepts")),
        floor=floor_price,
        cost=cost_price,
        base=base_price,
    )

    verdict = {"zone": zone, "action": action, "headline": headline}

    if engine_error:
        warnings.append("No engine suggestion for this offer (engine error).")

    # Round money fields to 2 decimals
    for k in list(economics.keys()):
        v = economics[k]
        if isinstance(v, float):
            economics[k] = round(v, 2)

    return {
        "detected": detected,
        "economics": economics,
        "verdict": verdict,
        "suggestion": suggestion,
        "engine_error": engine_error,
        "warnings": warnings,
    }
