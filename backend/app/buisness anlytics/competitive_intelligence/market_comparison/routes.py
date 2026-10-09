import sys, os
import asyncio
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import structlog
from decimal import Decimal
import aiomysql
import json
from rapidfuzz import fuzz

_app_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', '..'))
if _app_root not in sys.path:
    sys.path.insert(0, _app_root)

from app.infrastructure.database.session import get_conn
from app.api.v1.auth_routes import get_current_user
from app.api.middleware.rate_limiter import limiter

from .models import MarketComparisonResponse
from .sources import fetch_market_listings
from .matcher import process_matches
from .cache import market_cache

logger = structlog.get_logger(__name__)

market_comparison_router = APIRouter(prefix="/api/v1/products", tags=["Market Comparison"])

security_optional = HTTPBearer(auto_error=False)

async def get_optional_user(credentials: Optional[HTTPAuthorizationCredentials] = Depends(security_optional)) -> Optional[dict]:
    if not credentials:
        return None
    try:
        return await get_current_user(credentials)
    except Exception:
        return None

async def generate_comparison(product_id: str, product_name: str, our_price: float, our_currency: str, limit: int) -> MarketComparisonResponse:
    listings = await fetch_market_listings(product_name, our_currency)
    
    items = await process_matches(
        listings=listings,
        product_name=product_name,
        our_price=our_price,
        our_currency=our_currency,
        limit=limit
    )
    
    return MarketComparisonResponse(
        product_id=str(product_id),
        our_price=our_price,
        currency=our_currency,
        generated_at=datetime.now(timezone.utc),
        items=items
    )

@market_comparison_router.get("/{product_id}/market-comparison", response_model=MarketComparisonResponse)
@limiter.limit("30/minute")
async def get_market_comparison(
    request: Request,
    product_id: str,
    limit: int = Query(5, ge=1, le=10),
    product_name: Optional[str] = Query(None),
    our_price: Optional[float] = Query(None),
    currency: Optional[str] = Query(None),
    force_refresh: bool = Query(False),
    current_user: Optional[dict] = Depends(get_optional_user),
):
    product = None
    pid_str = str(product_id).strip()
    our_currency = (currency or "INR").upper()

    # 1. Server resolves our price from the DB by product_id whenever possible
    if pid_str.isdigit():
        async with get_conn() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                if current_user:
                    await cur.execute(
                        "SELECT id, name, base_price FROM products WHERE id = %s AND user_id = %s",
                        (int(pid_str), current_user['id'])
                    )
                    product = await cur.fetchone()
                if not product:
                    # Allow cross-tenant read for shared/demo catalog products
                    await cur.execute(
                        "SELECT id, name, base_price FROM products WHERE id = %s",
                        (int(pid_str),)
                    )
                    product = await cur.fetchone()

    if product:
        p_name = (product_name.strip() if product_name and product_name.strip() else product["name"])
        effective_price = float(our_price) if our_price is not None and our_price > 0 else float(product["base_price"])
    else:
        # Fallback for demo IDs (e.g. 'TRADE-001'), unseeded IDs, or manual chat modes
        query_name = (product_name.strip() if product_name and product_name.strip() else (pid_str if not pid_str.isdigit() and pid_str != 'TRADE-001' else 'Wireless Earbuds'))
        p_name = query_name
        effective_price = float(our_price) if our_price is not None and our_price > 0 else 2499.0

        if not our_price or our_price <= 0:
            seed_path = os.path.join(os.path.dirname(__file__), "market_seed.json")
            try:
                with open(seed_path, "r", encoding="utf-8") as f:
                    seed_data = json.load(f).get("products", {})
                    best_match = None
                    best_score = 0
                    for seed_p in seed_data.keys():
                        sc = fuzz.ratio(query_name.lower(), seed_p.lower())
                        if sc > best_score:
                            best_score = sc
                            best_match = seed_p
                    if best_match and best_score >= 35:
                        p_name = best_match
                        prices = [item["price"] for item in seed_data[best_match] if item.get("price")]
                        if prices:
                            effective_price = round(min(prices) / 1.20, 2)
                            our_currency = seed_data[best_match][0].get("currency", our_currency)
            except Exception as e:
                logger.warning(f"Failed to match seed for demo fallback: {e}")

    # 2. Check cache (keyed by product_id + product_name + effective_price)
    cache_key = f"{pid_str}:{p_name.lower()}:{effective_price}"
    lock = market_cache._get_lock(cache_key)

    if not force_refresh:
        cached_response = await market_cache.get(cache_key)
        if cached_response and not market_cache.is_stale(cache_key):
            if len(cached_response.items) > limit:
                response_copy = cached_response.model_copy()
                response_copy.items = cached_response.items[:limit]
                return response_copy
            return cached_response

        if lock.locked():
            if cached_response:
                return cached_response
            else:
                await lock.acquire()
                try:
                    cached_response = await market_cache.get(cache_key)
                    if cached_response:
                        return cached_response
                finally:
                    lock.release()

    # 3. Compute and cache
    async with lock:
        if not force_refresh:
            cached_response = await market_cache.get(cache_key)
            if cached_response and not market_cache.is_stale(cache_key):
                if len(cached_response.items) > limit:
                    response_copy = cached_response.model_copy()
                    response_copy.items = cached_response.items[:limit]
                    return response_copy
                return cached_response

        response = await generate_comparison(
            product_id=pid_str,
            product_name=p_name,
            our_price=effective_price,
            our_currency=our_currency,
            limit=10
        )

        await market_cache.set(cache_key, response)

    if len(response.items) > limit:
        response_copy = response.model_copy()
        response_copy.items = response.items[:limit]
        return response_copy
        
    return response
