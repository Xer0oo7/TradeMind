"""
extractor.py — Pure regex/rule-based offer extraction from buyer messages.

No network, no session, no LLM. Returns a structured dict from free-text.

Public API: extract_offer(text, base_price=None, seller_last_offer=None) -> dict
"""
from __future__ import annotations

import math
import re
from typing import Optional

# ─────────────────────────────────────────────────────────────────────────────
# QUANTITY PATTERNS
# Strip quantity phrases BEFORE price detection so "10 units" ≠ price 10.
# ─────────────────────────────────────────────────────────────────────────────

_QTY_PATTERNS = [
    # "10 units", "5 pcs", "3 pieces", "2 items"
    re.compile(
        r"\b(\d{1,6})\s*(?:units?|pcs?|pieces?|items?|no\.?|nos?\.?)\b",
        re.IGNORECASE,
    ),
    # "quantity 10", "qty: 5"
    re.compile(r"\b(?:qty|quantity)\s*(?:is|=|:)?\s*(\d{1,6})\b", re.IGNORECASE),
    # "I need 20 pieces", "want 10 pcs"
    re.compile(
        r"\b(?:need|want|order|take|buy|get|send|give\s+me|make\s+it)\s+(\d{1,6})\s+"
        r"(?:units?|pcs?|pieces?|items?|no\.?|nos?\.?)\b",
        re.IGNORECASE,
    ),
    # "and I take 5" (exclude "take 800 or leave it")
    re.compile(
        r"\b(?:and\s+)?(?:i\s+)?(?:take|order|want|need)\s+(\d{1,4})\b(?!\s*(?:or\s+leave|\$|₹|rs|usd))",
        re.IGNORECASE,
    ),
]

# "N units at X" / "N pcs @ X" — quantity + unit price in one phrase
_QTY_AT_PRICE_RE = re.compile(
    r"\b(\d{1,6})\s*(?:units?|pcs?|pieces?|items?)\s*(?:at|@)\s*"
    r"([\d,]+(?:\.\d{1,2})?(?:\s*(?:k|K|lakh|lac|thousand|hundred|crore))?\s*/?-?)\b",
    re.IGNORECASE,
)

# "N for X each" — quantity + unit price
_QTY_FOR_EACH_RE = re.compile(
    r"\b(\d{1,6})\s+for\s+"
    r"([\d,]+(?:\.\d{1,2})?(?:\s*(?:k|K|lakh|lac|thousand|hundred|crore))?)"
    r"\s*(?:each|per\s+(?:piece|unit|item|pc))\b",
    re.IGNORECASE,
)

# "X each for N" / "45 each for 10"
_PRICE_EACH_FOR_QTY_RE = re.compile(
    r"\b([\d,]+(?:\.\d{1,2})?)\s*(?:each|per\s+(?:piece|unit|item|pc))\s+for\s+(\d{1,6})\b",
    re.IGNORECASE,
)

# "X for the lot of N" / "6500 for the lot of 10"
_PRICE_FOR_LOT_RE = re.compile(
    r"\b([\d,]+(?:\.\d{1,2})?)\s+for\s+(?:the\s+)?(?:lot|whole|batch)\s*(?:of\s+(\d{1,6}))?\b",
    re.IGNORECASE,
)

# "total for all 10 is 8500"
_TOTAL_FOR_ALL_QTY_IS_PRICE_RE = re.compile(
    r"\btotal\s+(?:for\s+(?:all\s+)?)?(\d{1,6})\s+(?:is|at|=)\s*([\d,]+(?:\.\d{1,2})?)\b",
    re.IGNORECASE,
)

# Multiplication: "800 x 12" or "12 x 800"
_MULT_RE = re.compile(
    r"\b([\d,]+(?:\.\d{1,2})?)\s*[x×]\s*(\d{1,6})\b",
    re.IGNORECASE,
)

# "X for N units" — number before "for N units" (total or unit-ambiguous)
_X_FOR_N_RE = re.compile(
    r"^[\s₹$£€]*([\d,]+(?:\.\d{1,2})?(?:\s*(?:k|K|lakh|lac|thousand|hundred|crore))?)"
    r"\s+for\s+(?:all\s+)?(\d{1,6})\s*(?:units?|pcs?|pieces?|items?)\b",
    re.IGNORECASE,
)


# ─────────────────────────────────────────────────────────────────────────────
# MAGNITUDE / NUMBER WORD HELPERS
# ─────────────────────────────────────────────────────────────────────────────

_WORD_TENS = {
    "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50,
    "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90,
}
_WORD_ONES = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14,
    "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18,
    "nineteen": 19,
}

_WORD_HUNDREDS_RE = re.compile(
    r"\b(one|two|three|four|five|six|seven|eight|nine)\s+hundred"
    r"(?:\s+(?:and\s+)?"
    r"(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)?"
    r"\s*(?:-\s*)?"
    r"(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|"
    r"thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)?)?"
    r"\b",
    re.IGNORECASE,
)

_WORD_TENS_ONES_RE = re.compile(
    r"\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)"
    r"(?:\s*-\s*|\s+)?"
    r"(one|two|three|four|five|six|seven|eight|nine)?\b",
    re.IGNORECASE,
)

_WORD_SIMPLE_RE = re.compile(
    r"\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|"
    r"thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)\b",
    re.IGNORECASE,
)

# "twelve hundred" / "eight hundred" style
_WORD_N_HUNDRED_RE = re.compile(
    r"\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|"
    r"thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)\s+"
    r"(?:hundred|k|thousand)\b",
    re.IGNORECASE,
)

# "one thousand two hundred" / "one thousand"
_WORD_THOUSAND_RE = re.compile(
    r"\b(one|two|three|four|five|six|seven|eight|nine)\s+thousand"
    r"(?:\s+(?:and\s+)?"
    r"(one|two|three|four|five|six|seven|eight|nine)?\s*hundred"
    r"(?:\s+(?:and\s+)?"
    r"(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)?"
    r"\s*(?:-\s*)?"
    r"(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|"
    r"thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)?"
    r")?"
    r")?\b",
    re.IGNORECASE,
)


def _word_to_number(text: str) -> Optional[float]:
    """Convert simple English number words to a float. Returns None if no match."""
    t = text.strip().lower()

    # "twelve hundred", "eight hundred" (Nxx00 style)
    m = _WORD_N_HUNDRED_RE.search(t)
    if m:
        n_word = m.group(1).lower()
        suffix = m.group(0).split()[-1].lower()
        n = _WORD_ONES.get(n_word, 0)
        if n == 0:
            return None
        if suffix in ("hundred",):
            return float(n * 100)
        if suffix in ("k", "thousand"):
            return float(n * 1000)

    # "one thousand two hundred [forty-five]"
    m2 = _WORD_THOUSAND_RE.search(t)
    if m2 and m2.group(1):
        val = _WORD_ONES.get(m2.group(1).lower(), 0) * 1000
        if m2.group(2):  # hundreds digit
            val += _WORD_ONES.get(m2.group(2).lower(), 0) * 100
        if m2.group(3):  # tens
            val += _WORD_TENS.get(m2.group(3).lower(), 0)
        if m2.group(4):  # ones
            val += _WORD_ONES.get(m2.group(4).lower(), 0)
        if val > 0:
            return float(val)

    # "eight hundred [and] [forty] [five]"
    m3 = _WORD_HUNDREDS_RE.search(t)
    if m3 and m3.group(1):
        val = _WORD_ONES.get(m3.group(1).lower(), 0) * 100
        if m3.group(2):
            val += _WORD_TENS.get(m3.group(2).lower(), 0)
        if m3.group(3):
            val += _WORD_ONES.get(m3.group(3).lower(), 0)
        if val > 0:
            return float(val)

    # "seven fifty" (750), "twelve fifty" (1250)
    m_colloq = re.search(
        r"\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)\s+"
        r"(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)"
        r"(?:\s+(one|two|three|four|five|six|seven|eight|nine))?\b",
        t,
        re.IGNORECASE,
    )
    if m_colloq:
        c_h = _WORD_ONES.get(m_colloq.group(1).lower(), 0) * 100
        c_t = _WORD_TENS.get(m_colloq.group(2).lower(), 0)
        c_o = _WORD_ONES.get(m_colloq.group(3).lower(), 0) if m_colloq.group(3) else 0
        if c_h > 0:
            return float(c_h + c_t + c_o)

    # "forty-five", "twenty three"
    m4 = _WORD_TENS_ONES_RE.search(t)
    if m4 and m4.group(1):
        val = _WORD_TENS.get(m4.group(1).lower(), 0)
        if m4.group(2):
            val += _WORD_ONES.get(m4.group(2).lower(), 0)
        if val > 0:
            return float(val)

    # simple one-word numbers
    m5 = _WORD_SIMPLE_RE.search(t)
    if m5:
        val = _WORD_ONES.get(m5.group(1).lower(), 0)
        if val > 0:
            return float(val)

    return None


_MAGNITUDE_RE = re.compile(
    r"([\d,]+(?:\.\d{1,2})?)\s*(k|K|lakh|lac|crore|thousand|hundred)\b",
    re.IGNORECASE,
)

# Indian number grouping: 1,20,000
_INDIAN_NUMBER_RE = re.compile(r"\d{1,2}(?:,\d{2})+(?:,\d{3})?|\d{1,3}(?:,\d{3})+")


def _parse_raw_number(raw: str) -> Optional[float]:
    """
    Parse a raw numeric string that may contain:
    - Indian grouping (1,20,000)
    - Western grouping (1,200,000)
    - Magnitudes (k, lakh, crore)
    - Decimals
    Returns float or None.
    """
    raw = raw.strip().replace(" ", "")
    # Magnitude suffix
    m = _MAGNITUDE_RE.fullmatch(raw) or _MAGNITUDE_RE.search(raw)
    if m:
        base_str = m.group(1).replace(",", "")
        suffix = m.group(2).lower()
        try:
            base = float(base_str)
        except ValueError:
            return None
        multipliers = {
            "k": 1_000, "thousand": 1_000, "hundred": 100,
            "lakh": 100_000, "lac": 100_000, "crore": 10_000_000,
        }
        return round(base * multipliers[suffix], 2)

    # Remove commas (both Indian and Western grouping)
    cleaned = raw.replace(",", "")
    try:
        return float(cleaned)
    except ValueError:
        return None


# ─────────────────────────────────────────────────────────────────────────────
# PRICE DETECTION PATTERNS
# ─────────────────────────────────────────────────────────────────────────────

# Currency prefix
_CURRENCY_PREFIX_RE = re.compile(
    r"(?:₹|Rs\.?\s*|INR\s*|USD?\s*|\$|€|£)\s*"
    r"([\d,]+(?:\.\d{1,2})?(?:\s*(?:k|K|lakh|lac|thousand|hundred|crore))?)"
    r"(?:\s*/?-?)?",
    re.IGNORECASE,
)

# Currency suffix (rupees, dollars, etc.)
_CURRENCY_SUFFIX_RE = re.compile(
    r"\b([\d,]+(?:\.\d{1,2})?(?:\s*(?:k|K|lakh|lac|thousand|hundred|crore))?)"
    r"\s*(?:rupees?|rs\.?|inr|dollars?|usd)\b",
    re.IGNORECASE,
)

# Per-unit cues
_PER_UNIT_SUFFIX_RE = re.compile(
    r"\b([\d,]+(?:\.\d{1,2})?(?:\s*(?:k|K|lakh|lac|thousand|hundred|crore))?)"
    r"\s*(?:each|per\s+(?:piece|unit|item|pc)|/\s*(?:unit|pc|piece)|a\s+piece|apiece)\b",
    re.IGNORECASE,
)
_PER_UNIT_PREFIX_RE = re.compile(
    r"(?:each|per\s+(?:piece|unit|item|pc)|/\s*(?:unit|pc|piece)|a\s+piece)\s*"
    r"([\d,]+(?:\.\d{1,2})?)",
    re.IGNORECASE,
)

# Total-price cues
_TOTAL_CUES_RE = re.compile(
    r"\b(?:total|in\s+all|altogether|for\s+all|for\s+the\s+(?:lot|whole|batch))\b"
    r"[^\d]*([\d,]+(?:\.\d{1,2})?(?:\s*(?:k|K|lakh|lac|thousand|hundred|crore))?)",
    re.IGNORECASE,
)
_TOTAL_PREFIX_CUES_RE = re.compile(
    r"\b([\d,]+(?:\.\d{1,2})?(?:\s*(?:k|K|lakh|lac|thousand|hundred|crore))?)"
    r"\s*(?:total|in\s+all|altogether)\b",
    re.IGNORECASE,
)

# "total X for N units"
_TOTAL_X_FOR_N_RE = re.compile(
    r"\btotal\s+([\d,]+(?:\.\d{1,2})?(?:\s*(?:k|K|lakh|lac|thousand|hundred|crore))?)"
    r"\s+for\s+(\d{1,6})\b",
    re.IGNORECASE,
)

# Bare number — last resort
_BARE_NUMBER_RE = re.compile(
    r"(?<!\d)"
    r"([\d,]+(?:\.\d{1,2})?(?:\s*(?:k|K|lakh|lac|thousand|hundred|crore))?)"
    r"(?!\d)",
    re.IGNORECASE,
)

# ─────────────────────────────────────────────────────────────────────────────
# PERCENT / DELTA PATTERNS
# ─────────────────────────────────────────────────────────────────────────────

_PERCENT_OFF_RE = re.compile(
    r"\b(\d+(?:\.\d{1,2})?)\s*%\s*(?:off|discount|less|cheaper|reduction)\b"
    r"|\bgive\s+(\d+(?:\.\d{1,2})?)\s*(?:percent|%)\s*(?:discount|off|reduction)?\b"
    r"|\b(\d+(?:\.\d{1,2})?)\s*percent\s*(?:off|discount|less|cheaper|reduction)\b",
    re.IGNORECASE,
)

_DELTA_RE = re.compile(
    r"\b(?:reduce|lower|knock\s+off|cut|drop|less|minus|subtract|shave)\b"
    r"[^\d$₹]*"
    r"(?:(?:by|of)\s+)?"
    r"(?:₹|\$|rs\.?\s*)?"
    r"([\d,]+(?:\.\d{1,2})?)",
    re.IGNORECASE,
)

# "from your price / lower than that" → delta from seller_last_offer
_FROM_SELLER_RE = re.compile(
    r"\b(?:from\s+your\s+(?:price|offer)|lower\s+than\s+that|below\s+your\s+(?:price|offer))\b",
    re.IGNORECASE,
)

# ─────────────────────────────────────────────────────────────────────────────
# ACCEPTANCE / REJECTION / QUESTION / QUANTITY-ONLY
# ─────────────────────────────────────────────────────────────────────────────

_ACCEPT_STRONG_RE = re.compile(
    r"^[\s]*(?:"
    r"ok\s*(?:deal|agreed|agree)|deal|i['']?\s*accept|agreed|let['']?s?\s*do\s*it|"
    r"i['']?ll?\s*take\s*it|we\s*have\s*a\s*deal|done\s*deal|sold|"
    r"yes\s*deal|accepted|alright\s*deal|i\s*agree|"
    r"wrap\s*it\s*up|let['']?s?\s*close|i['']?ll?\s*go\s*with\s*that|"
    r"that['']?s?\s*a\s*deal|it['']?s?\s*a\s*deal|i\s*accept\s*your\s*offer|"
    r"done|let['']?s?\s*finalize|fine,?\s*go\s*ahead|finalize"
    r")[\s.,!]*$",
    re.IGNORECASE,
)

# "ok 800 deal" — accept with inline price
_ACCEPT_PRICE_RE = re.compile(
    r"^[\s]*ok\s+"
    r"([\d,]+(?:\.\d{1,2})?(?:\s*(?:k|K|lakh|lac|thousand|hundred|crore))?)"
    r"\s*deal[\s.,!]*$",
    re.IGNORECASE,
)

_REJECT_RE = re.compile(
    r"^[\s]*(?:"
    r"(?:that['']?s?\s+)?too\s+(?:expensive|high|much)|not\s+interested|let\s+me\s+think|"
    r"no\s+deal|not\s+at\s+that\s+price|can['']?t\s+do\s+that|"
    r"no\s+way|not\s+happening|"
    r"that\s+doesn['']?t\s+work|won['']?t\s+work|pass"
    r")[\s.,!]*$",
    re.IGNORECASE,
)

_QUESTION_RE = re.compile(
    r"\?|"
    r"\b(?:is\s+it|do\s+you|can\s+you|what|when|how|where|who|which|"
    r"are\s+you|do\s+you\s+have|in\s+stock|available|delivery|quality|"
    r"warranty|spec|detail|tell\s+me|explain)\b",
    re.IGNORECASE,
)

_QTY_ONLY_RE = re.compile(
    r"^[\s]*(?:i\s+)?(?:need|want|order|take)\s+(\d{1,6})\s*"
    r"(?:units?|pcs?|pieces?|items?|nos?\.?)?[\s.,!]*$",
    re.IGNORECASE,
)

# ─────────────────────────────────────────────────────────────────────────────
# PUBLIC API
# ─────────────────────────────────────────────────────────────────────────────

def extract_offer(
    text: str,
    base_price: Optional[float] = None,
    seller_last_offer: Optional[float] = None,
) -> dict:
    """
    Extract a structured offer from free-text buyer message.

    Returns:
        unit_price: float | None
        quantity: int | None
        total_price: float | None
        price_basis: "unit" | "total" | "derived" | "unknown"
        currency: str | None
        confidence: "high" | "medium" | "low"
        alt_unit_price: float | None
        accepts: bool
        intent: "offer" | "accept" | "reject" | "question" | "quantity_only" | "other"
        flags: list[str]
    """
    if not text or not text.strip():
        return _result(intent="other")

    t = text.strip()
    flags: list[str] = []

    # ── 1. Check quantity-only intent ───────────────────────────────
    m_qonly = _QTY_ONLY_RE.match(t)
    if m_qonly:
        return _result(
            intent="quantity_only",
            quantity=int(m_qonly.group(1)),
            confidence="high",
        )

    # ── 2. Check acceptance ─────────────────────────────────────────
    if _ACCEPT_STRONG_RE.match(t):
        # "ok deal" without price → unit = seller_last_offer
        up = seller_last_offer
        return _result(
            unit_price=up,
            quantity=_extract_quantity(t),
            price_basis="unit" if up is not None else "unknown",
            currency=None,
            confidence="high" if up is not None else "low",
            accepts=True,
            intent="accept",
        )

    # "ok 800 deal"
    m_aprice = _ACCEPT_PRICE_RE.match(t)
    if m_aprice:
        up = _parse_raw_number(m_aprice.group(1))
        if up is not None:
            return _result(
                unit_price=up,
                quantity=_extract_quantity(t),
                price_basis="unit",
                currency=None,
                confidence="high",
                accepts=True,
                intent="accept",
            )

    # ── 3. Check rejection ──────────────────────────────────────────
    if _REJECT_RE.match(t):
        return _result(intent="reject", confidence="high")

    # ── 4. Extract quantity first (strip before price detection) ────
    qty = _extract_quantity(t)

    # ── 5. Check percent-off ────────────────────────────────────────
    if base_price is not None:
        pct_result = _try_percent_off(t, base_price, qty, flags)
        if pct_result is not None:
            return pct_result

    # ── 6. Check delta (reduce by X) ───────────────────────────────
    if base_price is not None:
        delta_result = _try_delta(t, base_price, seller_last_offer, qty, flags)
        if delta_result is not None:
            return delta_result

    # ── 7. "N units at X" / "N pcs @ X" → unit price ───────────────
    m_at = _QTY_AT_PRICE_RE.search(t)
    if m_at:
        q = int(m_at.group(1))
        up = _parse_raw_number(m_at.group(2))
        if up is not None and up > 0:
            return _result(
                unit_price=up,
                quantity=q,
                total_price=round(up * q, 2),
                price_basis="unit",
                currency=_detect_currency(t),
                confidence="high",
                intent="offer",
            )

    # ── 8. "N for X each" ───────────────────────────────────────────
    m_fe = _QTY_FOR_EACH_RE.search(t)
    if m_fe:
        q = int(m_fe.group(1))
        up = _parse_raw_number(m_fe.group(2))
        if up is not None and up > 0:
            return _result(
                unit_price=up,
                quantity=q,
                total_price=round(up * q, 2),
                price_basis="unit",
                currency=_detect_currency(t),
                confidence="high",
                intent="offer",
            )

    # ── 8b. "X each for N" / "45 each for 10" ───────────────────────
    m_peq = _PRICE_EACH_FOR_QTY_RE.search(t)
    if m_peq:
        up = _parse_raw_number(m_peq.group(1))
        q = int(m_peq.group(2))
        if up is not None and up > 0 and q > 0:
            return _result(
                unit_price=up,
                quantity=q,
                total_price=round(up * q, 2),
                price_basis="unit",
                currency=_detect_currency(t),
                confidence="high",
                intent="offer",
            )

    # ── 8c. "X for the lot of N" / "6500 for the lot of 10" ────────
    m_lot = _PRICE_FOR_LOT_RE.search(t)
    if m_lot:
        tp = _parse_raw_number(m_lot.group(1))
        q = int(m_lot.group(2)) if m_lot.group(2) else qty
        if tp is not None and tp > 0:
            up = round(tp / q, 2) if (q and q > 0) else None
            return _result(
                unit_price=up,
                quantity=q,
                total_price=tp,
                price_basis="total",
                currency=_detect_currency(t),
                confidence="high",
                intent="offer",
            )

    # ── 8d. "total for all 10 is 8500" ──────────────────────────────
    m_tfa = _TOTAL_FOR_ALL_QTY_IS_PRICE_RE.search(t)
    if m_tfa:
        q = int(m_tfa.group(1)) if m_tfa.group(1) else qty
        tp = _parse_raw_number(m_tfa.group(2))
        if tp is not None and tp > 0:
            up = round(tp / q, 2) if (q and q > 0) else None
            return _result(
                unit_price=up,
                quantity=q,
                total_price=tp,
                price_basis="total",
                currency=_detect_currency(t),
                confidence="high",
                intent="offer",
            )

    # ── 9. Multiplication: "800 x 12" ───────────────────────────────
    m_mult = _MULT_RE.search(t)
    if m_mult:
        a = _parse_raw_number(m_mult.group(1))
        b = int(m_mult.group(2))
        if a is not None and a > 0 and b > 0:
            # Heuristic: larger value is unit price if base_price available
            if base_price is not None:
                up = a if abs(math.log(a / base_price)) < abs(math.log(b / base_price + 1e-6)) else float(b)
            else:
                up = a  # default: first number is unit price
            q_final = b if up == a else int(a)
            return _result(
                unit_price=up,
                quantity=q_final,
                total_price=round(up * q_final, 2),
                price_basis="unit",
                currency=_detect_currency(t),
                confidence="medium",
                intent="offer",
            )

    # ── 10. "total X for N units" ───────────────────────────────────
    m_txn = _TOTAL_X_FOR_N_RE.search(t)
    if m_txn:
        tp = _parse_raw_number(m_txn.group(1))
        q = int(m_txn.group(2))
        if tp is not None and tp > 0 and q > 0:
            up = round(tp / q, 2)
            return _result(
                unit_price=up,
                quantity=q,
                total_price=tp,
                price_basis="total",
                currency=_detect_currency(t),
                confidence="high",
                intent="offer",
            )

    # ── 11. "X for N units" — ambiguous basis ───────────────────────
    m_xfn = _X_FOR_N_RE.match(t)
    if m_xfn:
        raw_val = _parse_raw_number(m_xfn.group(1))
        q = int(m_xfn.group(2))
        if raw_val is not None and raw_val > 0 and q > 0:
            return _resolve_ambiguous_for_n_units(raw_val, q, base_price, flags, t)

    # ── 12. Explicit total cues ─────────────────────────────────────
    m_tc = _TOTAL_CUES_RE.search(t) or _TOTAL_PREFIX_CUES_RE.search(t)
    if m_tc:
        tp = _parse_raw_number(m_tc.group(1))
        if tp is not None and tp > 0 and (qty is None or abs(tp - qty) > 0.01):
            q_eff = qty if qty else 1
            up = round(tp / q_eff, 2) if q_eff > 1 else None
            return _result(
                unit_price=up,
                quantity=qty,
                total_price=tp,
                price_basis="total",
                currency=_detect_currency(t),
                confidence="high",
                intent="offer",
            )

    # ── 13. Per-unit cue ────────────────────────────────────────────
    m_pu = _PER_UNIT_SUFFIX_RE.search(t) or _PER_UNIT_PREFIX_RE.search(t)
    if m_pu:
        up = _parse_raw_number(m_pu.group(1))
        if up is not None and up > 0:
            flags_local = list(flags)
            if base_price is not None and up > 3 * base_price:
                flags_local.append("possible_typo")
            elif base_price is not None and up < 0.05 * base_price:
                flags_local.append("possible_typo")
            return _result(
                unit_price=up,
                quantity=qty,
                total_price=round(up * qty, 2) if qty else None,
                price_basis="unit",
                currency=_detect_currency(t),
                confidence="high",
                intent="offer",
                flags=flags_local,
            )

    # ── 14. Currency-prefixed price ─────────────────────────────────
    m_cp = _CURRENCY_PREFIX_RE.search(t)
    if m_cp:
        up = _parse_raw_number(m_cp.group(1))
        if up is not None and up > 0:
            flags_local = list(flags)
            if base_price is not None and up > 3 * base_price:
                flags_local.append("possible_typo")
            elif base_price is not None and up < 0.05 * base_price:
                flags_local.append("possible_typo")
            currency = _detect_currency(t)
            return _result(
                unit_price=up,
                quantity=qty,
                total_price=round(up * qty, 2) if qty else None,
                price_basis="unit",
                currency=currency,
                confidence="high",
                intent="offer",
                flags=flags_local,
            )

    # ── 15. Currency-suffixed price ─────────────────────────────────
    m_cs = _CURRENCY_SUFFIX_RE.search(t)
    if m_cs:
        up = _parse_raw_number(m_cs.group(1))
        if up is not None and up > 0:
            flags_local = list(flags)
            if base_price is not None and up > 3 * base_price:
                flags_local.append("possible_typo")
            return _result(
                unit_price=up,
                quantity=qty,
                total_price=round(up * qty, 2) if qty else None,
                price_basis="unit",
                currency=_detect_currency(t),
                confidence="high",
                intent="offer",
                flags=flags_local,
            )

    # ── 16. Number words ────────────────────────────────────────────
    nw = _try_number_words(t, base_price, qty, flags, seller_last_offer)
    if nw is not None:
        return nw

    # ── 17. Bare numbers (last resort) ─────────────────────────────
    bare = _try_bare_numbers(t, base_price, qty, flags, seller_last_offer)
    if bare is not None:
        return bare

    # ── 18. Pure quantity mentioned → quantity_only ─────────────────
    if qty is not None:
        return _result(intent="quantity_only", quantity=qty, confidence="medium")

    # ── 19. Question detection ──────────────────────────────────────
    if _QUESTION_RE.search(t):
        return _result(intent="question", confidence="high")

    return _result(intent="other")


# ─────────────────────────────────────────────────────────────────────────────
# PRIVATE HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _result(
    unit_price: Optional[float] = None,
    quantity: Optional[int] = None,
    total_price: Optional[float] = None,
    price_basis: str = "unknown",
    currency: Optional[str] = None,
    confidence: str = "low",
    alt_unit_price: Optional[float] = None,
    accepts: bool = False,
    intent: str = "offer",
    flags: Optional[list] = None,
) -> dict:
    if unit_price is not None:
        unit_price = round(unit_price, 2)
    if total_price is not None:
        total_price = round(total_price, 2)
    if alt_unit_price is not None:
        alt_unit_price = round(alt_unit_price, 2)
    return {
        "unit_price": unit_price,
        "quantity": quantity,
        "total_price": total_price,
        "price_basis": price_basis,
        "currency": currency,
        "confidence": confidence,
        "alt_unit_price": alt_unit_price,
        "accepts": accepts,
        "intent": intent,
        "flags": flags or [],
    }


def _extract_quantity(text: str) -> Optional[int]:
    """Extract a quantity from text using all quantity patterns."""
    for pat in _QTY_PATTERNS:
        m = pat.search(text)
        if m:
            try:
                return int(m.group(1))
            except (ValueError, IndexError):
                pass
    return None


def _detect_currency(text: str) -> Optional[str]:
    """Detect the currency symbol/name used."""
    if re.search(r"₹|rs\.?\s*|rupees?|inr", text, re.IGNORECASE):
        return "INR"
    if re.search(r"\$|usd|dollars?", text, re.IGNORECASE):
        return "USD"
    if re.search(r"€|eur", text, re.IGNORECASE):
        return "EUR"
    if re.search(r"£|gbp", text, re.IGNORECASE):
        return "GBP"
    return None


def _try_percent_off(text: str, base_price: float, qty, flags: list) -> Optional[dict]:
    """Handle "10% off", "give 15 percent discount", etc."""
    m = _PERCENT_OFF_RE.search(text)
    if not m:
        return None
    pct_str = m.group(1) or m.group(2) or m.group(3)
    if pct_str is None:
        return None
    try:
        pct = float(pct_str)
    except ValueError:
        return None
    if pct <= 0 or pct >= 100:
        return None
    up = round(base_price * (1 - pct / 100), 2)
    local_flags = list(flags) + ["from_percent"]
    return _result(
        unit_price=up,
        quantity=qty,
        total_price=round(up * qty, 2) if qty else None,
        price_basis="derived",
        confidence="high",
        intent="offer",
        flags=local_flags,
    )


def _try_delta(
    text: str,
    base_price: float,
    seller_last_offer: Optional[float],
    qty,
    flags: list,
) -> Optional[dict]:
    """Handle "reduce by 100", "100 less", "knock off 50"."""
    m = _DELTA_RE.search(text)
    if not m:
        return None
    delta = _parse_raw_number(m.group(1))
    if delta is None or delta <= 0:
        return None

    # Determine reference price
    from_seller = bool(_FROM_SELLER_RE.search(text))
    ref = seller_last_offer if (from_seller and seller_last_offer is not None) else base_price
    up = round(ref - delta, 2)
    if up <= 0:
        return None
    local_flags = list(flags) + ["from_delta"]
    return _result(
        unit_price=up,
        quantity=qty,
        total_price=round(up * qty, 2) if qty else None,
        price_basis="derived",
        confidence="high",
        intent="offer",
        flags=local_flags,
    )


def _try_number_words(
    text: str,
    base_price: Optional[float],
    qty,
    flags: list,
    seller_last_offer: Optional[float],
) -> Optional[dict]:
    """Detect price expressed in English words: 'eight hundred', 'twelve hundred'."""
    val = _word_to_number(text)
    if val is None or val <= 0:
        return None

    local_flags = list(flags)
    if base_price is not None:
        if val > 3 * base_price:
            local_flags.append("possible_typo")
        elif val < 0.05 * base_price:
            local_flags.append("possible_typo")

    return _result(
        unit_price=val,
        quantity=qty,
        total_price=round(val * qty, 2) if qty else None,
        price_basis="unit",
        confidence="medium",
        intent="offer",
        flags=local_flags,
    )


def _try_bare_numbers(
    text: str,
    base_price: Optional[float],
    qty: Optional[int],
    flags: list,
    seller_last_offer: Optional[float],
) -> Optional[dict]:
    """
    Last-resort: find a bare number in the text that isn't a quantity.
    Filters out numbers that match extracted quantity to avoid double-counting.
    """
    candidates = []
    for m in _BARE_NUMBER_RE.finditer(text):
        raw = m.group(1)
        val = _parse_raw_number(raw)
        if val is None or val <= 0:
            continue
        # Skip if this number equals extracted quantity
        if qty is not None and abs(val - qty) < 0.01:
            continue
        # Skip small integers likely to be quantities
        if val <= 50 and (qty is None or val != qty):
            # Allow if there's a currency cue nearby
            start = max(0, m.start() - 5)
            nearby = text[start: m.end() + 5]
            has_currency = bool(re.search(r"[₹$€£]|rs|inr|usd", nearby, re.IGNORECASE))
            if not has_currency:
                continue
        candidates.append(val)

    if not candidates:
        return None

    # Pick the candidate closest to base_price on log scale
    if base_price is not None and base_price > 0:
        candidates.sort(key=lambda v: abs(math.log(v / base_price)))

    up = candidates[0]
    local_flags = list(flags)
    if base_price is not None:
        if up > 3 * base_price:
            local_flags.append("possible_typo")
        elif up < 0.05 * base_price:
            local_flags.append("possible_typo")

    confidence = "medium"
    if len(candidates) > 1:
        confidence = "low"

    return _result(
        unit_price=up,
        quantity=qty,
        total_price=round(up * qty, 2) if qty else None,
        price_basis="unit",
        confidence=confidence,
        intent="offer",
        flags=local_flags,
    )


def _log_dist(a: float, b: float) -> float:
    """Log-scale distance between two positive numbers."""
    if a <= 0 or b <= 0:
        return float("inf")
    return abs(math.log(a / b))


def _resolve_ambiguous_for_n_units(
    raw_val: float,
    qty: int,
    base_price: Optional[float],
    flags: list,
    text: str,
) -> dict:
    """
    Resolve 'X for N units': is raw_val a unit price or total price?
    Unit reading: up = raw_val, total = raw_val * qty
    Total reading: total = raw_val, up = raw_val / qty
    Pick the reading where unit price is within [0.2x, 1.5x] base_price.
    If both/neither fit, pick closer on log scale.
    Sets flag 'basis_assumed', confidence 'medium', fills alt_unit_price.
    """
    up_unit = raw_val              # treat raw as unit price
    up_total = raw_val / qty       # treat raw as total → derive unit

    local_flags = list(flags) + ["basis_assumed"]

    if base_price is not None and base_price > 0:
        fits_unit = 0.2 * base_price <= up_unit <= 1.5 * base_price
        fits_total = 0.2 * base_price <= up_total <= 1.5 * base_price

        if fits_unit and not fits_total:
            return _result(
                unit_price=up_unit,
                quantity=qty,
                total_price=round(up_unit * qty, 2),
                price_basis="unit",
                currency=_detect_currency(text),
                confidence="medium",
                alt_unit_price=round(up_total, 2),
                intent="offer",
                flags=local_flags,
            )
        if fits_total and not fits_unit:
            return _result(
                unit_price=round(up_total, 2),
                quantity=qty,
                total_price=raw_val,
                price_basis="total",
                currency=_detect_currency(text),
                confidence="medium",
                alt_unit_price=round(up_unit, 2),
                intent="offer",
                flags=local_flags,
            )
        # Both or neither — pick closer on log scale
        if _log_dist(up_unit, base_price) <= _log_dist(up_total, base_price):
            return _result(
                unit_price=up_unit,
                quantity=qty,
                total_price=round(up_unit * qty, 2),
                price_basis="unit",
                currency=_detect_currency(text),
                confidence="medium",
                alt_unit_price=round(up_total, 2),
                intent="offer",
                flags=local_flags,
            )
        else:
            return _result(
                unit_price=round(up_total, 2),
                quantity=qty,
                total_price=raw_val,
                price_basis="total",
                currency=_detect_currency(text),
                confidence="medium",
                alt_unit_price=round(up_unit, 2),
                intent="offer",
                flags=local_flags,
            )

    # No base_price — default to treating raw_val as unit price
    return _result(
        unit_price=up_unit,
        quantity=qty,
        total_price=round(up_unit * qty, 2),
        price_basis="unit",
        currency=_detect_currency(text),
        confidence="low",
        alt_unit_price=round(up_total, 2),
        intent="offer",
        flags=local_flags,
    )
