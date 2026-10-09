import abc
import json
import os
import asyncio
from typing import List, Optional
from datetime import datetime, timezone
import structlog
import httpx
from bs4 import BeautifulSoup
from rapidfuzz import fuzz

from .models import RawListing
from .security import is_ssrf_safe, validate_image_url, sanitize_string
import sys

_app_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', '..'))
if _app_root not in sys.path:
    sys.path.insert(0, _app_root)
from app.core.config import get_settings

logger = structlog.get_logger(__name__)

class PriceSource(abc.ABC):
    def __init__(self):
        self.consecutive_failures = 0
        self.circuit_open_until = 0.0

    async def search(self, query: str, currency: str) -> List[RawListing]:
        loop = asyncio.get_running_loop()
        now = loop.time()
        if self.circuit_open_until > now:
            logger.warning(f"Circuit broken for {self.__class__.__name__}, skipping.")
            return []

        timeout_val = getattr(self, "timeout_seconds", 6.0)
        try:
            async with asyncio.timeout(timeout_val):
                results = await self._do_search(query, currency)
                self.consecutive_failures = 0
                return results
        except asyncio.TimeoutError:
            logger.warning(f"{self.__class__.__name__} timed out")
            self._record_failure()
            return []
        except Exception as e:
            logger.warning(f"{self.__class__.__name__} failed: {str(e)}")
            self._record_failure()
            return []

    def _record_failure(self):
        self.consecutive_failures += 1
        if self.consecutive_failures >= 3:
            loop = asyncio.get_running_loop()
            self.circuit_open_until = loop.time() + 60.0
            logger.error(f"Circuit breaker opened for {self.__class__.__name__} for 60s")

    @abc.abstractmethod
    async def _do_search(self, query: str, currency: str) -> List[RawListing]:
        pass

class SerpShoppingSource(PriceSource):
    async def _do_search(self, query: str, currency: str) -> List[RawListing]:
        settings = get_settings()
        if not getattr(settings, "serp_api_key", None):
            return []
            
        async with httpx.AsyncClient(timeout=5.5) as client:
            params = {
                "engine": "google_shopping",
                "q": query,
                "api_key": settings.serp_api_key,
                "gl": "in" if currency.upper() == "INR" else "us",
                "hl": "en"
            }
            resp = await client.get("https://serpapi.com/search.json", params=params)
            resp.raise_for_status()
            data = resp.json()
            
            results = []
            for item in data.get("shopping_results", [])[:10]:
                try:
                    price = float(item.get("extracted_price", item.get("price", 0)))
                    if price <= 0:
                        continue
                    link = item.get("link", "")
                    if not link or not link.startswith("https://"):
                        continue
                    thumb = validate_image_url(item.get("thumbnail"))
                    results.append(RawListing(
                        title=sanitize_string(item.get("title", "")),
                        source=sanitize_string(item.get("source", "Google Shopping")),
                        url=link,
                        image_url=thumb,
                        price=price,
                        currency=currency,
                        fetched_at=datetime.now(timezone.utc),
                        is_live=True,
                        listing_kind="product"
                    ))
                except (ValueError, TypeError):
                    continue
            return results

class HtmlSource(PriceSource):
    """HTML scraper reusing the existing competitive intelligence scraper."""
    def __init__(self):
        super().__init__()
        self.timeout_seconds = 8.5

    async def _do_search(self, query: str, currency: str) -> List[RawListing]:
        try:
            from ..scraper import scrape_competitor_data
        except ImportError:
            return []

        try:
            # Run in thread pool to prevent blocking asyncio loop
            raw_products = await asyncio.to_thread(
                scrape_competitor_data,
                product_name=query,
                category=None,
                max_results=15,
                product_description=None
            )
            
            results = []
            for p in raw_products:
                price = p.get("price")
                title = p.get("title")
                if not price or not title:
                    continue
                try:
                    price_val = float(price)
                    if price_val <= 0:
                        continue
                    source_name = p.get("source", "Web")
                    if source_name == "amazon_in" or source_name.lower() == "amazon.in":
                        source_display = "Amazon.in"
                    elif source_name == "flipkart" or source_name.lower() == "flipkart":
                        source_display = "Flipkart"
                    else:
                        source_display = source_name.title()

                    url = p.get("url") or f"https://www.google.com/search?q={query}"
                    if not is_ssrf_safe(url):
                        continue
                        
                    results.append(RawListing(
                        title=sanitize_string(title),
                        source=source_display,
                        url=url,
                        image_url=validate_image_url(p.get("image_url")),
                        price=price_val,
                        currency=currency,
                        fetched_at=datetime.now(timezone.utc),
                        is_live=True,
                        listing_kind=p.get("listing_kind", "product")
                    ))
                except (ValueError, TypeError):
                    continue
            return results
        except Exception as e:
            logger.warning(f"HtmlSource scraping failed: {e}")
            return []

class SeededSource(PriceSource):
    async def _do_search(self, query: str, currency: str) -> List[RawListing]:
        seed_file = os.path.join(os.path.dirname(__file__), "market_seed.json")
        try:
            with open(seed_file, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception as e:
            logger.error(f"Failed to load seed file: {e}")
            return []
            
        products = data.get("products", {})
        
        # Fuzzy match query to available products
        best_match = None
        best_score = 0
        q_lower = query.lower()
        for p_name in products.keys():
            score = fuzz.ratio(q_lower, p_name.lower())
            if score > best_score:
                best_score = score
                best_match = p_name
                
        if best_score < 40 or not best_match:
            # Fallback: check if any query keyword is contained in product name
            for p_name in products.keys():
                if any(w in p_name.lower() for w in q_lower.split() if len(w) > 3):
                    best_match = p_name
                    break

        if not best_match:
            return []
            
        results = []
        for item in products[best_match]:
            results.append(RawListing(
                title=item.get("title"),
                source=item.get("source"),
                url=item.get("url"),
                image_url=item.get("image_url"),
                price=float(item.get("price")),
                currency=item.get("currency", currency),
                fetched_at=datetime.now(timezone.utc),
                is_live=False,
                listing_kind=item.get("listing_kind", "search")
            ))
            
        return results

async def fetch_market_listings(query: str, currency: str) -> List[RawListing]:
    settings = get_settings()
    sources_enabled_str = getattr(settings, "market_sources", "html,seeded")
    sources_enabled = [s.strip().lower() for s in sources_enabled_str.split(",") if s.strip()]
    
    # 1. Run live sources first
    live_tasks = []
    if "serp" in sources_enabled:
        live_tasks.append(SerpShoppingSource().search(query, currency))
    if "html" in sources_enabled:
        live_tasks.append(HtmlSource().search(query, currency))
        
    live_listings = []
    if live_tasks:
        results = await asyncio.gather(*live_tasks, return_exceptions=True)
        for r in results:
            if isinstance(r, list):
                live_listings.extend(r)
            elif isinstance(r, Exception):
                logger.warning(f"Live source task failed with exception: {r}")
                
    if live_listings:
        return live_listings
        
    # 2. Fallback to seeded source if live yielded no results
    if "seeded" in sources_enabled:
        return await SeededSource().search(query, currency)
        
    return []
