"""
Unit tests for Peitho Speech Normalizer (backend/app/peitho/normalizer.py).

Tests 20+ distinct phrase variants across English, Hindi, Hinglish, fractions, multipliers,
currencies, and fuzzy product matching.
"""
import pytest
from app.peitho.normalizer import normalize_transcript, fuzzy_match_product


@pytest.mark.parametrize(
    "phrase,expected_substr",
    [
        # English colloquial hundreds
        ("I can offer four fifty for this", "450"),
        ("Let's do seven twenty apiece", "720"),
        ("What about three twenty dollars?", "320"),
        # English spelled-out numbers
        ("four hundred fifty", "450"),
        ("four hundred and fifty", "450"),
        ("one thousand two hundred", "1200"),
        ("twenty five units", "25 units"),
        # Multipliers
        ("I will pay 4.5k", "4500"),
        ("We can offer 10k for all", "10000"),
        ("two lakh rupees", "200000"),
        ("five million budget", "5000000"),
        ("half a million dollars", "500000"),
        ("quarter million", "250000"),
        # Hindi fractions (Devanagari)
        ("डेढ़ सौ", "150"),
        ("ढाई सौ", "250"),
        ("ढाई हज़ार", "2500"),
        ("सवा सौ", "125"),
        ("पौने दो सौ", "175"),
        ("साढ़े चार सौ", "450"),
        ("साढ़े तीन सौ", "350"),
        ("चार सौ पचास", "450"),
        # Hinglish fractions & numbers
        ("dedh sau rupaye", "150"),
        ("dhai hazar", "2500"),
        ("sadhe char sau", "450"),
        ("sawa sau", "125"),
        ("paune do sau", "175"),
        ("do lakh", "200000"),
        # Devanagari digits
        ("कीमत ४५० रुपये है", "450"),
        ("ऑफ़र १२५०", "1250"),
        # Complex conversational sentences
        ("Can you do four fifty per piece?", "450"),
        ("हम साढ़े चार सौ में ले सकते हैं", "450"),
    ],
)
def test_normalize_phrases(phrase: str, expected_substr: str):
    result = normalize_transcript(phrase)
    assert expected_substr in result, f"Failed for '{phrase}': got '{result}'"


def test_normalize_empty_and_no_numbers():
    assert normalize_transcript("") == ""
    assert normalize_transcript(None) == ""
    assert normalize_transcript("Hello, how are you?") == "Hello, how are you?"


def test_fuzzy_match_product():
    # Positive matches
    assert fuzzy_match_product(
        "Is this the Ergonomic Office Chair?",
        "Ergonomic Office Chair",
    )
    assert fuzzy_match_product(
        "I want a discount on the chair",
        "Executive Leather Chair",
        threshold=0.3,
    )
    assert fuzzy_match_product(
        "For 10 units of the industrial drill",
        "Industrial Cordless Drill",
    )

    # Negative matches
    assert not fuzzy_match_product(
        "I want to buy some apples",
        "Industrial Cordless Drill",
    )
    assert not fuzzy_match_product("", "Industrial Drill")
    assert not fuzzy_match_product("Hello", "")
