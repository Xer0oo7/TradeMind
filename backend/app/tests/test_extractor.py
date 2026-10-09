"""
Tests for the offer extractor (Phase A).

Run:  pytest backend/app/tests/test_extractor.py -v
"""
import pytest
from app.assist.extractor import extract_offer


# ─────────────────────────────────────────────────────────────────────────────
# REQUIRED CORPUS (from prompt)
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("text,base,seller_lo,expect", [
    # --- Per-unit / quantity combos ---
    ("650 each for 10 units", 1000, None,
     {"unit_price": 650.0, "quantity": 10, "intent": "offer"}),
    ("650 for 10 units", 1000, None,
     {"unit_price": 650.0, "quantity": 10, "flags_has": "basis_assumed", "alt_unit_price_approx": 65.0}),
    ("650 for 10 units", 100, None,
     {"unit_price": 65.0, "quantity": 10, "flags_has": "basis_assumed", "alt_unit_price_approx": 650.0}),
    ("45 each for 10", 50, None,
     {"unit_price": 45.0, "quantity": 10}),

    # --- Currency symbols ---
    ("₹80", 100, None, {"unit_price": 80.0}),
    ("Rs 80 per piece", 100, None, {"unit_price": 80.0}),
    ("Rs.800/-", 1000, None, {"unit_price": 800.0}),
    ("800 rupees", 1000, None, {"unit_price": 800.0}),

    # --- Magnitudes ---
    ("80k", 100_000, None, {"unit_price": 80_000.0}),
    ("6.5k", 10_000, None, {"unit_price": 6500.0}),
    ("1.2 lakh", 150_000, None, {"unit_price": 120_000.0}),

    # --- Indian grouping ---
    ("can you do 1,200?", 1500, None, {"unit_price": 1200.0}),
    ("1,20,000", 1000, None, {"unit_price": 120_000.0}),

    # --- N units at / @ ---
    ("10 units at 640", 1000, None, {"unit_price": 640.0, "quantity": 10}),
    ("10 pcs @ 640", 1000, None, {"unit_price": 640.0, "quantity": 10}),

    # --- Total cues ---
    ("total 6500 for 10", 1000, None,
     {"total_price": 6500.0, "unit_price": 650.0, "quantity": 10, "price_basis": "total"}),

    # --- Number words ---
    ("eight hundred", 1000, None, {"unit_price": 800.0}),
    ("twelve hundred", 1000, None, {"unit_price": 1200.0}),

    # --- Intent phrases ---
    ("I can pay 700", 1000, None, {"unit_price": 700.0, "intent": "offer"}),
    ("700 max", 1000, None, {"unit_price": 700.0}),
    ("how about 700 and I take 5", 1000, None, {"unit_price": 700.0, "quantity": 5}),

    # --- Percent ---
    ("10% off?", 1000, None, {"unit_price": 900.0, "price_basis": "derived", "flags_has": "from_percent"}),
    ("20 percent discount for 10 units", 1000, None,
     {"unit_price": 800.0, "quantity": 10, "price_basis": "derived", "flags_has": "from_percent"}),

    # --- Delta ---
    ("reduce by 100", 1000, None, {"unit_price": 900.0, "price_basis": "derived", "flags_has": "from_delta"}),

    # --- Acceptance ---
    ("ok deal", 1000, 850.0, {"accepts": True, "unit_price": 850.0, "intent": "accept"}),
    ("ok 800 deal", 1000, 850.0, {"accepts": True, "unit_price": 800.0, "intent": "accept"}),

    # --- Rejection ---
    ("that's too expensive", 1000, None, {"unit_price": None, "intent": "reject"}),

    # --- Question ---
    ("is it in stock?", 1000, None, {"intent": "question"}),

    # --- Quantity only ---
    ("I need 20 pieces", 1000, None, {"intent": "quantity_only", "quantity": 20}),

    # --- Other ---
    ("hello", 1000, None, {"intent": "other"}),

    # --- Possible typo ---
    ("$5", 1000, None, {"flags_has": "possible_typo"}),

    # --- Bare quantity ---
    ("10 units", 1000, None, {"quantity": 10, "unit_price": None}),

    # --- Multiplication ---
    ("800 x 12", 1000, None, {"unit_price": 800.0, "quantity": 12}),

    # --- N for X each ---
    ("12 for 800 each", 1000, None, {"unit_price": 800.0, "quantity": 12}),

    # --- Consistent offer ---
    ("800 per unit, 12 units, 9,600 total", 1000, None,
     {"unit_price": 800.0, "quantity": 12, "total_price": 9600.0}),
])
def test_required_corpus(text, base, seller_lo, expect):
    result = extract_offer(text, base_price=base, seller_last_offer=seller_lo)
    for k, v in expect.items():
        if k == "flags_has":
            assert v in result["flags"], (
                f"Expected flag '{v}' in {result['flags']} for: {text!r}"
            )
        elif k == "alt_unit_price_approx":
            assert result["alt_unit_price"] is not None, f"alt_unit_price is None for: {text!r}"
            assert abs(result["alt_unit_price"] - v) < 1.0, (
                f"alt_unit_price={result['alt_unit_price']} expected ≈{v} for: {text!r}"
            )
        elif v is None:
            assert result.get(k) is None, f"Expected {k}=None, got {result.get(k)} for: {text!r}"
        else:
            actual = result.get(k)
            if isinstance(v, float):
                assert actual is not None and abs(actual - v) < 0.5, (
                    f"{k}: expected {v}, got {actual} for: {text!r}"
                )
            else:
                assert actual == v, f"{k}: expected {v}, got {actual} for: {text!r}"


# ─────────────────────────────────────────────────────────────────────────────
# ADDITIONAL REALISTIC PHRASES (>= 15)
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("text,base,seller_lo,expect", [
    # Indian English
    ("can do 750 final", 1000, None, {"unit_price": 750.0, "intent": "offer"}),
    ("last price 700 bhai", 1000, None, {"unit_price": 700.0, "intent": "offer"}),
    ("give me 5% discount yaar", 1000, None, {"unit_price": 950.0, "flags_has": "from_percent"}),
    ("max I can do is 850", 1000, None, {"unit_price": 850.0}),
    ("my budget is 600 per piece", 1000, None, {"unit_price": 600.0, "price_basis": "unit"}),
    ("take 800 or leave it", 1000, None, {"unit_price": 800.0}),
    ("Rs 1200 each, 5 pieces", 1000, None, {"unit_price": 1200.0, "quantity": 5}),
    ("one thousand rupees", 1000, None, {"unit_price": 1000.0}),
    ("seven fifty per unit", 1000, None, {"unit_price": 750.0, "price_basis": "unit"}),
    ("2000 for 4 units", 1000, None,
     {"quantity": 4, "flags_has": "basis_assumed"}),  # ambiguous
    ("knock off 50 from your price", 1000, 900.0,
     {"unit_price": 850.0, "flags_has": "from_delta"}),  # 900 - 50
    ("how about 6500 for the lot of 10", 1000, None,
     {"total_price": 6500.0, "quantity": 10, "price_basis": "total"}),
    ("ok agreed", 1000, 850.0, {"accepts": True, "intent": "accept", "unit_price": 850.0}),
    ("done deal", 1000, 900.0, {"accepts": True, "intent": "accept"}),
    ("let's finalize at 750", 1000, None, {"unit_price": 750.0}),
    ("5 pieces at 900 each", 1000, None, {"unit_price": 900.0, "quantity": 5}),
    ("total for all 10 is 8500", 1000, None, {"total_price": 8500.0, "quantity": 10}),
    ("I'll take it all for Rs.9000", 1000, None, {"accepts": False, "unit_price": 9000.0}),
])
def test_additional_corpus(text, base, seller_lo, expect):
    result = extract_offer(text, base_price=base, seller_last_offer=seller_lo)
    for k, v in expect.items():
        if k == "flags_has":
            assert v in result["flags"], (
                f"Expected flag '{v}' in {result['flags']} for: {text!r}"
            )
        elif v is None:
            assert result.get(k) is None, f"Expected {k}=None, got {result.get(k)} for: {text!r}"
        else:
            actual = result.get(k)
            if isinstance(v, float):
                assert actual is not None and abs(actual - v) < 1.0, (
                    f"{k}: expected {v}, got {actual} for: {text!r}"
                )
            else:
                assert actual == v, f"{k}: expected {v}, got {actual} for: {text!r}"


# ─────────────────────────────────────────────────────────────────────────────
# NEVER-RAISE PROPERTY
# ─────────────────────────────────────────────────────────────────────────────

def test_never_raises_on_garbage():
    """extract_offer must never raise — always return a dict."""
    bad_inputs = [
        "", "   ", None, "₹₹₹", "xyz abc", "999999999999", "0.0001",
        "abc 123 def 456 ghi", "the price is maybe around 700 or so",
        "👋💰", "@#$%^&*()", "\n\n\n", "一千円", "mille",
    ]
    for t in bad_inputs:
        try:
            r = extract_offer(t or "")
            assert isinstance(r, dict), f"Expected dict for {t!r}"
            assert "intent" in r
        except Exception as exc:
            pytest.fail(f"extract_offer raised {exc!r} for input {t!r}")
