import re
from decimal import Decimal, ROUND_HALF_UP
from typing import List, Tuple
from rapidfuzz import fuzz
from .models import RawListing, MarketListingItem

import sys, os
_app_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', '..'))
if _app_root not in sys.path:
    sys.path.insert(0, _app_root)
from app.core.config import get_settings

STOPWORDS = {
    "the", "a", "an", "for", "with", "and", "or", "in", "on", "at", "to", "of", "by", 
    "is", "it", "new", "best", "top", "premium", "buy", "online", "price", "sale", 
    "deal", "discount", "offer", "free", "shipping", "delivery"
}

def normalize_title(title: str) -> set[str]:
    t = title.lower()
    t = t.replace('"', "in").replace("inch", "in")
    words = re.findall(r'\b\w+\b', t)
    tokens = {w for w in words if w not in STOPWORDS}
    return tokens

def compute_similarity(title_a: str, title_b: str) -> float:
    tokens_a = normalize_title(title_a)
    tokens_b = normalize_title(title_b)
    if not tokens_a or not tokens_b:
        return 0.0
        
    intersection = tokens_a.intersection(tokens_b)
    union = tokens_a.union(tokens_b)
    jaccard = len(intersection) / len(union) if union else 0.0
    coverage = len(intersection) / len(tokens_a) if tokens_a else 0.0
    
    fuzz_ratio = max(
        fuzz.ratio(title_a.lower(), title_b.lower()),
        fuzz.partial_ratio(title_a.lower(), title_b.lower())
    ) / 100.0
    
    score = 0.3 * jaccard + 0.4 * coverage + 0.3 * fuzz_ratio
    return round(score, 3)

async def llm_judge(candidates: List[RawListing], product_name: str) -> List[bool]:
    """Optional LLM judge on top candidates. Temperature 0, never modifies prices."""
    settings = get_settings()
    if not getattr(settings, "openrouter_api_key", None):
        return [True] * len(candidates)
        
    try:
        import httpx
        items_text = "\n".join([f"{i+1}. {c.title}" for i, c in enumerate(candidates[:8])])
        prompt = (
            f"You are a strict product comparison judge. For target product: '{product_name}', "
            f"determine if each candidate is genuinely the SAME product or directly comparable version. "
            f"Reject accessories, cases, covers, cables, bundles, and different models.\n"
            f"Candidates:\n{items_text}\n\n"
            f"Return ONLY a JSON list of booleans with length equal to candidates, e.g. [true, false, true]."
        )
        async with httpx.AsyncClient(timeout=4.0) as client:
            resp = await client.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.openrouter_api_key}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": getattr(settings, "openrouter_model", "google/gemini-2.5-flash"),
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.0
                }
            )
            if resp.status_code == 200:
                import json
                content = resp.json()["choices"][0]["message"]["content"]
                # Extract json list
                match = re.search(r'\[.*?\]', content, re.DOTALL)
                if match:
                    results = json.loads(match.group(0))
                    if isinstance(results, list) and len(results) == len(candidates[:8]):
                        return [bool(x) for x in results] + [True] * max(0, len(candidates) - len(results))
    except Exception:
        pass
        
    return [True] * len(candidates)

def plausibility_filter(listing: RawListing, our_price: float, our_currency: str) -> bool:
    if listing.currency.upper() != our_currency.upper():
        return False
    
    our_price_d = Decimal(str(our_price))
    comp_price_d = Decimal(str(listing.price))
    
    # Drop obvious accessories/bundles if outside 0.5x - 3.0x
    if comp_price_d < our_price_d * Decimal('0.5') or comp_price_d > our_price_d * Decimal('3.0'):
        return False
        
    return True

def cheaper_filter(listing: RawListing, our_price: float) -> bool:
    settings = get_settings()
    if getattr(settings, "comparison_mode", "we_are_cheaper") != "we_are_cheaper":
        return True
        
    our_price_d = Decimal(str(our_price))
    comp_price_d = Decimal(str(listing.price))
    
    # Keep ONLY competitor_price >= our_price * 1.02
    return comp_price_d >= our_price_d * Decimal('1.02')

async def process_matches(listings: List[RawListing], product_name: str, our_price: float, our_currency: str, limit: int = 5) -> List[MarketListingItem]:
    valid_listings = []
    
    for lst in listings:
        if not plausibility_filter(lst, our_price, our_currency):
            continue
        if not cheaper_filter(lst, our_price):
            continue
            
        sim = compute_similarity(product_name, lst.title)
        
        # Match threshold (>= 0.50)
        if sim < 0.50:
            continue
            
        valid_listings.append((lst, sim))
        
    # Optional LLM judging on top candidates
    if valid_listings:
        valid_listings.sort(key=lambda x: x[1], reverse=True)
        top_candidates = [v[0] for v in valid_listings[:8]]
        
        judgments = await llm_judge(top_candidates, product_name)
        
        filtered = []
        for (lst, sim), is_comparable in zip(valid_listings[:8], judgments):
            if is_comparable:
                filtered.append((lst, sim))
        # Keep remaining if any
        if len(valid_listings) > 8:
            filtered.extend(valid_listings[8:])
    else:
        filtered = []
        
    # Dedupe by source and URL
    seen = set()
    deduped = []
    for lst, sim in filtered:
        key = (lst.source.lower(), lst.url.lower())
        if key not in seen:
            seen.add(key)
            deduped.append((lst, sim))
            
    # Calculate savings & Rank (0.6 * similarity + 0.4 * normalized savings)
    ranked = []
    our_price_d = Decimal(str(our_price))
    for lst, sim in deduped:
        comp_price_d = Decimal(str(lst.price))
        savings_abs = comp_price_d - our_price_d
        savings_pct = (savings_abs / comp_price_d) * Decimal('100')
        savings_pct = savings_pct.quantize(Decimal('0.1'), rounding=ROUND_HALF_UP)
        
        # Normalized savings (relative to competitor price, bounded [0, 1])
        norm_savings = min(1.0, float(savings_pct) / 100.0)
        score = 0.6 * sim + 0.4 * norm_savings
        
        item = MarketListingItem(
            title=lst.title,
            source=lst.source,
            url=lst.url,
            image_url=lst.image_url,
            price=float(comp_price_d),
            currency=lst.currency,
            similarity=sim,
            savings_abs=float(savings_abs),
            savings_pct=float(savings_pct),
            fetched_at=lst.fetched_at,
            is_live=lst.is_live,
            listing_kind=lst.listing_kind
        )
        ranked.append((item, score))
        
    ranked.sort(key=lambda x: x[1], reverse=True)
    return [r[0] for r in ranked[:limit]]
