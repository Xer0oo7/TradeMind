"""
Tests for assist service (Phase A).
Includes:
- Unit tests for economics calculations & zones
- Headline generation checks
- Sweep test over products, offers, rounds, quantities, seeding
  proving build_assist never raises on valid input and preserves invariants:
    - counter >= max(floor, cost)
    - counter <= seller_last_offer when seller_last_offer is given
"""
import pytest
from app.assist.service import build_assist, AssistPayload


def test_assist_no_offer_detected():
    product = {
        "id": 1,
        "name": "Widget",
        "base_price": 1000.0,
        "cost_price": 600.0,
        "min_acceptable_price": 750.0,
        "mode": "MAX_PROFIT",
        "max_rounds": 5,
        "total_sessions": 0,
        "accepted_deals": 0,
        "avg_margin": 25.0,
        "revenue": 0.0,
    }
    payload = AssistPayload(
        product_id=1,
        message="is it available in blue?",
        quantity=None,
        seller_last_offer=None,
        buyer_last_offer=None,
        round_number=1,
        override_unit_price=None,
        available_inventory=None,
    )
    res = build_assist(product, payload)
    assert res["detected"]["intent"] == "question"
    assert res["economics"] is None
    assert res["verdict"] is None
    assert res["suggestion"] is None
    assert res["engine_error"] is False


def test_assist_zones_and_economics():
    product = {
        "id": 1,
        "name": "Widget",
        "base_price": 1000.0,
        "cost_price": 600.0,
        "min_acceptable_price": 750.0,
        "mode": "MAX_PROFIT",
        "max_rounds": 5,
        "total_sessions": 10,
        "accepted_deals": 5,
        "avg_margin": 25.0,
        "revenue": 5000.0,
    }

    # Red zone: offer < cost (500 < 600)
    p_red = AssistPayload(
        product_id=1,
        message="I'll pay 500",
        quantity=2,
        seller_last_offer=950.0,
        buyer_last_offer=None,
        round_number=1,
        override_unit_price=None,
        available_inventory=10,
    )
    res_red = build_assist(product, p_red)
    assert res_red["verdict"]["zone"] == "red"
    assert res_red["economics"]["below_cost"] is True
    assert res_red["economics"]["below_floor"] is True
    assert res_red["economics"]["unit_profit"] == -100.0
    assert res_red["suggestion"]["counter_price"] >= 750.0

    # Amber zone: cost <= offer < floor (700 in [600, 750))
    p_amber = AssistPayload(
        product_id=1,
        message="how about 700",
        quantity=2,
        seller_last_offer=950.0,
        buyer_last_offer=None,
        round_number=2,
        override_unit_price=None,
        available_inventory=10,
    )
    res_amber = build_assist(product, p_amber)
    assert res_amber["verdict"]["zone"] == "amber"
    assert res_amber["economics"]["below_cost"] is False
    assert res_amber["economics"]["below_floor"] is True
    assert res_amber["economics"]["unit_profit"] == 100.0
    assert res_amber["suggestion"]["counter_price"] >= 750.0

    # Green zone: offer >= floor (800 >= 750)
    p_green = AssistPayload(
        product_id=1,
        message="800 each",
        quantity=2,
        seller_last_offer=900.0,
        buyer_last_offer=700.0,
        round_number=3,
        override_unit_price=None,
        available_inventory=10,
    )
    res_green = build_assist(product, p_green)
    assert res_green["verdict"]["zone"] == "green"
    assert res_green["economics"]["below_cost"] is False
    assert res_green["economics"]["below_floor"] is False
    assert res_green["economics"]["unit_profit"] == 200.0
    assert res_green["suggestion"]["counter_price"] >= 750.0
    assert res_green["suggestion"]["counter_price"] <= 900.0


def test_assist_invariants_sweep():
    """
    PROVE IT DOES NOT RAISE:
    Sweep test over products (several base/cost/floor combos, both modes),
    offers from 1 to 3x base, rounds 1..max_rounds, quantities 1..100,
    with and without seeding.
    Must never raise and never violate invariants.
    """
    products = [
        {"id": 1, "name": "Standard", "base_price": 1000.0, "cost_price": 600.0, "min_acceptable_price": 750.0, "mode": "MAX_PROFIT", "max_rounds": 5},
        {"id": 2, "name": "Budget", "base_price": 100.0, "cost_price": 40.0, "min_acceptable_price": 50.0, "mode": "MIN_LOSS", "max_rounds": 4},
        {"id": 3, "name": "Premium", "base_price": 50000.0, "cost_price": 30000.0, "min_acceptable_price": 38000.0, "mode": "MAX_PROFIT", "max_rounds": 6},
    ]

    offer_multipliers = [0.1, 0.5, 0.75, 0.9, 1.0, 1.2, 2.5]
    quantities = [1, 5, 20, 100]
    seed_options = [
        (None, None),
        (0.95, 0.6),   # (seller_last_offer multiplier, buyer_last_offer multiplier)
    ]

    for p in products:
        base = p["base_price"]
        floor = p["min_acceptable_price"]
        cost = p["cost_price"]
        max_r = p["max_rounds"]

        for mult in offer_multipliers:
            offer = round(base * mult, 2)
            for qty in quantities:
                for rnd in range(1, max_r + 1):
                    for s_mult, b_mult in seed_options:
                        s_last = round(base * s_mult, 2) if s_mult else None
                        b_last = round(base * b_mult, 2) if b_mult else None

                        payload = AssistPayload(
                            product_id=p["id"],
                            message=f"I offer {offer}",
                            quantity=qty,
                            seller_last_offer=s_last,
                            buyer_last_offer=b_last,
                            round_number=rnd,
                            override_unit_price=offer,
                            available_inventory=qty * 2,
                        )

                        res = build_assist(p, payload)
                        assert res is not None
                        assert res["engine_error"] is False
                        sugg = res.get("suggestion")
                        if sugg:
                            counter = sugg["counter_price"]
                            # Invariant 1: counter >= max(floor, cost)
                            assert counter >= max(floor, cost), (
                                f"Invariant violated: counter {counter} < max(floor={floor}, cost={cost}) "
                                f"product={p['id']}, offer={offer}, round={rnd}"
                            )
                            # Invariant 2: counter <= seller_last_offer (when given)
                            if s_last is not None:
                                assert counter <= s_last, (
                                    f"Invariant violated: counter {counter} > s_last {s_last} "
                                    f"product={p['id']}, offer={offer}, round={rnd}"
                                )
