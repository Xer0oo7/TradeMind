"""
Peitho Speech Normalizer — Deterministic normalizer for spoken numbers,
currencies, code-switching (English, Hindi, Hinglish), and fuzzy product matching.

Zero-dependency, fast (< 1 ms), and regex-driven to run inline during speech streaming.
"""
import re
from typing import Dict, List, Optional, Tuple, Set

# ── Devanagari digit mapping ──
DEV_DIGITS = str.maketrans("०१२३४५६७८९", "0123456789")

# ── Word to number mappings (English) ──
ONES_EN: Dict[str, int] = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4,
    "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9,
    "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14,
    "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19,
}

TENS_EN: Dict[str, int] = {
    "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50,
    "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90,
}

MULTIPLIERS_EN: Dict[str, int] = {
    "hundred": 100,
    "thousand": 1_000,
    "k": 1_000,
    "lakh": 100_000,
    "lac": 100_000,
    "lacs": 100_000,
    "million": 1_000_000,
    "crore": 10_000_000,
    "billion": 1_000_000_000,
}

# ── Word to number mappings (Devanagari & Hinglish) ──
ONES_HI: Dict[str, int] = {
    "एक": 1, "दो": 2, "तीन": 3, "चार": 4, "पांच": 5, "पाँच": 5,
    "छह": 6, "सात": 7, "आठ": 8, "नौ": 9, "दस": 10,
    "ग्यारह": 11, "बारह": 12, "तेरह": 13, "चौदह": 14, "पंद्रह": 15,
    "सोलह": 16, "सत्रह": 17, "अठारह": 18, "उन्नीस": 19,
    # Hinglish
    "ek": 1, "do": 2, "teen": 3, "char": 4, "chaar": 4, "paanch": 5, "panch": 5,
    "chhah": 6, "che": 6, "saat": 7, "aath": 8, "nau": 9, "das": 10,
    "gyarah": 11, "barah": 12, "terah": 13, "chaudah": 14, "pandrah": 15,
    "solah": 16, "satrah": 17, "atharah": 18, "unnis": 19,
}

TENS_HI: Dict[str, int] = {
    "बीस": 20, "तीस": 30, "चालीस": 40, "पचास": 50,
    "साठ": 60, "सत्तर": 70, "अस्सी": 80, "नब्बे": 90,
    # Hinglish
    "bees": 20, "tees": 30, "chalis": 40, "chaalis": 40, "pachas": 50,
    "saath": 60, "sattar": 70, "assi": 80, "nabbe": 90,
}

MULTIPLIERS_HI: Dict[str, int] = {
    "सौ": 100, "sau": 100,
    "हज़ार": 1_000, "हजार": 1_000, "hazar": 1_000, "hazaar": 1_000,
    "लाख": 100_000, "lakh": 100_000, "laakh": 100_000,
    "करोड़": 10_000_000, "करोड": 10_000_000, "crore": 10_000_000, "karor": 10_000_000,
}

# ── Spoken fraction expressions (Hindi & Hinglish) ──
# Using (?<!\S) and (?!\S) to cleanly match unicode Devanagari words alongside English
SPECIAL_FRACTION_PATTERNS = [
    # Dedh patterns (1.5x)
    (re.compile(r"(?<!\S)(?:डेढ़|dedh|deydh)\s+(?:सौ|sau)(?!\S)", re.IGNORECASE), "150"),
    (re.compile(r"(?<!\S)(?:डेढ़|dedh|deydh)\s+(?:हज़ार|हजार|hazar|hazaar)(?!\S)", re.IGNORECASE), "1500"),
    (re.compile(r"(?<!\S)(?:डेढ़|dedh|deydh)\s+(?:लाख|lakh|laakh)(?!\S)", re.IGNORECASE), "150000"),
    (re.compile(r"(?<!\S)(?:डेढ़|dedh|deydh)\s+(?:करोड़|crore|karor)(?!\S)", re.IGNORECASE), "15000000"),
    # Dhai patterns (2.5x)
    (re.compile(r"(?<!\S)(?:ढाई|dhai)\s+(?:सौ|sau)(?!\S)", re.IGNORECASE), "250"),
    (re.compile(r"(?<!\S)(?:ढाई|dhai)\s+(?:हज़ार|हजार|hazar|hazaar)(?!\S)", re.IGNORECASE), "2500"),
    (re.compile(r"(?<!\S)(?:ढाई|dhai)\s+(?:लाख|lakh|laakh)(?!\S)", re.IGNORECASE), "250000"),
    (re.compile(r"(?<!\S)(?:ढाई|dhai)\s+(?:करोड़|crore|karor)(?!\S)", re.IGNORECASE), "25000000"),
    # Sawa patterns (1.25x or +0.25)
    (re.compile(r"(?<!\S)(?:सवा|sawa|sawwa)\s+(?:सौ|sau)(?!\S)", re.IGNORECASE), "125"),
    (re.compile(r"(?<!\S)(?:सवा|sawa|sawwa)\s+(?:लाख|lakh|laakh)(?!\S)", re.IGNORECASE), "125000"),
    (re.compile(r"(?<!\S)(?:सवा|sawa|sawwa)\s+(?:हज़ार|हजार|hazar|hazaar)(?!\S)", re.IGNORECASE), "1250"),
    (re.compile(r"(?<!\S)(?:सवा|sawa|sawwa)\s+(?:दो\s+सौ|do\s+sau)(?!\S)", re.IGNORECASE), "225"),
    (re.compile(r"(?<!\S)(?:सवा|sawa|sawwa)\s+(?:तीन\s+सौ|teen\s+sau)(?!\S)", re.IGNORECASE), "325"),
    (re.compile(r"(?<!\S)(?:सवा|sawa|sawwa)\s+(?:चार\s+सौ|char\s+sau|chaar\s+sau)(?!\S)", re.IGNORECASE), "425"),
    (re.compile(r"(?<!\S)(?:सवा|sawa|sawwa)\s+(?:पांच\s+सौ|paanch\s+sau)(?!\S)", re.IGNORECASE), "525"),
    # Paune patterns (0.75x or -0.25)
    (re.compile(r"(?<!\S)(?:पौने|paune)\s+(?:सौ|sau)(?!\S)", re.IGNORECASE), "75"),
    (re.compile(r"(?<!\S)(?:पौने|paune)\s+(?:दो\s+सौ|do\s+sau)(?!\S)", re.IGNORECASE), "175"),
    (re.compile(r"(?<!\S)(?:पौने|paune)\s+(?:तीन\s+सौ|teen\s+sau)(?!\S)", re.IGNORECASE), "275"),
    (re.compile(r"(?<!\S)(?:पौने|paune)\s+(?:चार\s+सौ|char\s+sau|chaar\s+sau)(?!\S)", re.IGNORECASE), "375"),
    (re.compile(r"(?<!\S)(?:पौने|paune)\s+(?:पांच\s+सौ|paanch\s+sau)(?!\S)", re.IGNORECASE), "475"),
    (re.compile(r"(?<!\S)(?:पौने|paune)\s+(?:लाख|lakh|laakh)(?!\S)", re.IGNORECASE), "75000"),
    (re.compile(r"(?<!\S)(?:पौने|paune)\s+(?:दो\s+लाख|do\s+lakh)(?!\S)", re.IGNORECASE), "175000"),
]

# ── Sadhe patterns: "साढ़े चार सौ" -> 450, "साढ़े तीन सौ" -> 350, "साढ़े पांच हज़ार" -> 5500
SADHE_HINDI_PATTERN = re.compile(
    r"(?<!\S)(?:साढ़े|sadhe|saadhe)\s+(एक|दो|तीन|चार|पांच|पाँच|छह|सात|आठ|नौ|ek|do|teen|char|chaar|paanch|panch|chhah|che|saat|aath|nau)\s+(सौ|sau|हज़ार|हजार|hazar|hazaar|लाख|lakh|laakh)(?!\S)",
    re.IGNORECASE,
)

# ── Colloquial spoken shortcuts: "four fifty" -> 450, "seven twenty" -> 720
COLLOQUIAL_HUNDREDS = re.compile(
    r"\b(one|two|three|four|five|six|seven|eight|nine)\s+(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b",
    re.IGNORECASE,
)

# ── Half a million / quarter million ──
FRACTION_ENGLISH = [
    (re.compile(r"\bhalf\s+a\s+million\b", re.IGNORECASE), "500000"),
    (re.compile(r"\bquarter\s+(?:of\s+a\s+)?million\b", re.IGNORECASE), "250000"),
    (re.compile(r"\bhalf\s+a\s+(?:k|thousand)\b", re.IGNORECASE), "500"),
]

# ── Multiplier with decimal: "4.5k", "2.5 lakh", "1.5 million" ──
DECIMAL_MULTIPLIER_PATTERN = re.compile(
    r"(?<!\S)([0-9]+(?:\.[0-9]+)?)\s*(k|thousand|hazar|hazaar|हज़ार|हजार|lakh|laakh|lac|lacs|लाख|m|million|मिलियन|crore|करोड़|करोड|karor)(?!\S)",
    re.IGNORECASE,
)

MULTIPLIER_LOOKUP: Dict[str, float] = {
    "k": 1_000,
    "thousand": 1_000,
    "hazar": 1_000,
    "hazaar": 1_000,
    "हज़ार": 1_000,
    "हजार": 1_000,
    "lakh": 100_000,
    "laakh": 100_000,
    "lac": 100_000,
    "lacs": 100_000,
    "लाख": 100_000,
    "m": 1_000_000,
    "million": 1_000_000,
    "मिलियन": 1_000_000,
    "crore": 10_000_000,
    "करोड़": 10_000_000,
    "करोड": 10_000_000,
    "karor": 10_000_000,
}


def _sadhe_replacer(match: re.Match) -> str:
    """Calculates value for 'साढ़े चार सौ' or 'sadhe teen sau'."""
    digit_word = match.group(1).lower()
    unit_word = match.group(2).lower()

    d_val = ONES_HI.get(digit_word, ONES_EN.get(digit_word, 0))
    numeric_base = d_val + 0.5

    if unit_word in ("सौ", "sau"):
        total = numeric_base * 100
    elif unit_word in ("हज़ार", "हजार", "hazar", "hazaar"):
        total = numeric_base * 1000
    elif unit_word in ("लाख", "lakh", "laakh"):
        total = numeric_base * 100000
    else:
        total = numeric_base

    return str(int(total) if total.is_integer() else total)


def _colloquial_hundreds_replacer(match: re.Match) -> str:
    """Turns 'four fifty' -> '450', 'two twenty' -> '220'."""
    hundreds_digit = ONES_EN.get(match.group(1).lower(), 0)
    tens_digit = TENS_EN.get(match.group(2).lower(), 0)
    return str(hundreds_digit * 100 + tens_digit)


def _decimal_multiplier_replacer(match: re.Match) -> str:
    """Turns '4.5k' -> '4500', '2 lakh' -> '200000'."""
    val = float(match.group(1))
    mult_str = match.group(2).lower()
    mult = MULTIPLIER_LOOKUP.get(mult_str, 1.0)
    res = val * mult
    return str(int(res) if res.is_integer() else round(res, 2))


def _words_to_number_chain(text: str) -> str:
    """
    Evaluates sequences of spelled out numbers e.g.:
    'four hundred fifty' -> '450'
    'दो लाख' -> '200000'
    'चार सौ पचास' -> '450'
    'one thousand two hundred' -> '1200'
    """
    number_word_vocab = set(ONES_EN.keys()) | set(TENS_EN.keys()) | set(MULTIPLIERS_EN.keys()) \
        | set(ONES_HI.keys()) | set(TENS_HI.keys()) | set(MULTIPLIERS_HI.keys()) \
        | {"and", "aur", "और"}

    tokens = text.split()
    if not tokens:
        return text

    new_tokens = []
    i = 0
    n = len(tokens)

    while i < n:
        raw_word = tokens[i]
        clean_word = re.sub(r"[^\w\u0900-\u097F]", "", raw_word).lower()

        if clean_word in number_word_vocab and clean_word not in ("and", "aur", "और"):
            chain = []
            j = i
            while j < n:
                w_clean = re.sub(r"[^\w\u0900-\u097F]", "", tokens[j]).lower()
                if w_clean in number_word_vocab:
                    chain.append((w_clean, tokens[j]))
                    j += 1
                else:
                    break

            val = _parse_number_chain([c[0] for c in chain])
            if val is not None:
                first_punct = re.match(r"^[^\w\u0900-\u097F]+", tokens[i])
                last_punct = re.search(r"[^\w\u0900-\u097F]+$", tokens[j - 1])
                prefix = first_punct.group(0) if first_punct else ""
                suffix = last_punct.group(0) if last_punct else ""
                new_tokens.append(f"{prefix}{val}{suffix}")
                i = j
                continue

        new_tokens.append(raw_word)
        i += 1

    return " ".join(new_tokens)


def _parse_number_chain(words: List[str]) -> Optional[int]:
    """Helper converting list of number words into an integer."""
    if not words:
        return None

    words = [w for w in words if w not in ("and", "aur", "और")]
    if not words:
        return None

    # Disambiguation: Isolated English verb 'do' must never be parsed as number 2.
    # Compound numbers like 'do lakh', 'do hazar', or 'do sau' are preserved.
    if words == ["do"]:
        return None

    total = 0
    current = 0

    for w in words:
        if w in ONES_EN:
            current += ONES_EN[w]
        elif w in ONES_HI:
            current += ONES_HI[w]
        elif w in TENS_EN:
            current += TENS_EN[w]
        elif w in TENS_HI:
            current += TENS_HI[w]
        elif w in ("hundred", "सौ", "sau"):
            current = (current if current > 0 else 1) * 100
        elif w in ("thousand", "हज़ार", "हजार", "hazar", "hazaar", "k"):
            total += (current if current > 0 else 1) * 1000
            current = 0
        elif w in ("lakh", "laakh", "lac", "lacs", "लाख"):
            total += (current if current > 0 else 1) * 100_000
            current = 0
        elif w in ("million", "मिलियन"):
            total += (current if current > 0 else 1) * 1_000_000
            current = 0
        elif w in ("crore", "करोड़", "करोड", "karor"):
            total += (current if current > 0 else 1) * 10_000_000
            current = 0
        else:
            return None

    return total + current


def normalize_transcript(text: Optional[str]) -> str:
    """
    Full normalizer pipeline:
    1. Transliterate Devanagari numerals to standard digits (०-९ -> 0-9).
    2. Replace Hindi fraction idioms (e.g. 'डेढ़ सौ', 'ढाई लाख', 'सवा सौ', 'पौने दो सौ').
    3. Replace 'साढ़े' phrases ('साढ़े चार सौ' -> 450).
    4. Replace English fraction idioms ('half a million' -> 500000).
    5. Replace decimal multipliers ('4.5k' -> 4500, '2 lakh' -> 200000).
    6. Replace colloquial hundreds ('four fifty' -> 450).
    7. Convert remaining number word chains ('four hundred fifty' -> 450, 'चार सौ पचास' -> 450).
    8. Second pass for any newly exposed decimal multipliers.
    """
    if not text:
        return ""

    # 1. Devanagari digits
    normalized = text.translate(DEV_DIGITS)

    # 2. Hindi special fractions (run before word-to-number)
    for pat, rep in SPECIAL_FRACTION_PATTERNS:
        normalized = pat.sub(rep, normalized)

    # 3. Sadhe patterns (run before word-to-number)
    normalized = SADHE_HINDI_PATTERN.sub(_sadhe_replacer, normalized)

    # 4. English fraction idioms
    for pat, rep in FRACTION_ENGLISH:
        normalized = pat.sub(rep, normalized)

    # 5. Decimal multipliers first (e.g., "4.5k", "2 lakh")
    normalized = DECIMAL_MULTIPLIER_PATTERN.sub(_decimal_multiplier_replacer, normalized)

    # 6. Colloquial spoken shortcuts ("four fifty" -> 450)
    normalized = COLLOQUIAL_HUNDREDS.sub(_colloquial_hundreds_replacer, normalized)

    # 7. Word-to-number chains ("four hundred and fifty" -> 450, "चार सौ पचास" -> 450)
    normalized = _words_to_number_chain(normalized)

    # 8. Second pass for any newly exposed decimal multipliers
    normalized = DECIMAL_MULTIPLIER_PATTERN.sub(_decimal_multiplier_replacer, normalized)

    return normalized


def fuzzy_match_product(text: Optional[str], product_name: Optional[str], threshold: float = 0.5) -> bool:
    """
    Calculates token set overlap between utterance and product name.
    Useful for distinguishing whether a buyer is referencing the negotiated product.
    """
    if not product_name or not text:
        return False

    def clean_tokens(s: str) -> Set[str]:
        words = re.findall(r"\b[a-zA-Z0-9\u0900-\u097F]{2,}\b", s.lower())
        stopwords = {"the", "a", "an", "for", "with", "and", "or", "in", "on", "item", "product"}
        return {w for w in words if w not in stopwords}

    prod_tokens = clean_tokens(product_name)
    if not prod_tokens:
        return False

    text_tokens = clean_tokens(text)
    overlap = prod_tokens.intersection(text_tokens)

    ratio = len(overlap) / len(prod_tokens)
    return ratio >= threshold
