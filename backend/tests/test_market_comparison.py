import pytest
import asyncio
from datetime import datetime, timezone
import json
import sys
import os

_app_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if _app_root not in sys.path:
    sys.path.insert(0, _app_root)
    
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'app', 'buisness anlytics')))

from competitive_intelligence.market_comparison.matcher import (
    compute_similarity,
    plausibility_filter,
    cheaper_filter,
    process_matches
)
from competitive_intelligence.market_comparison.models import RawListing
from competitive_intelligence.market_comparison.sources import fetch_market_listings, PriceSource

@pytest.fixture
def mock_listings():
    return [
        RawListing(
            title="Sony WH-1000XM5",
            source="TestSource",
            url="https://test.com/1",
            price=35000.0,
            currency="INR",
            fetched_at=datetime.now(timezone.utc),
            is_live=True
        ),
        RawListing(
            title="Sony WH-1000XM5 Case",
            source="TestSource",
            url="https://test.com/2",
            price=1500.0,
            currency="INR",
            fetched_at=datetime.now(timezone.utc),
            is_live=True
        ),
        RawListing(
            title="Sony WH-1000XM5 Deal",
            source="TestSource",
            url="https://test.com/3",
            price=28000.0,
            currency="INR",
            fetched_at=datetime.now(timezone.utc),
            is_live=True
        )
    ]

def test_never_returns_cheaper_items(mock_listings):
    our_price = 29990.0
    items = asyncio.run(process_matches(mock_listings, "Sony WH-1000XM5", our_price, "INR", limit=5))
    
    assert len(items) > 0
    for item in items:
        assert item.price >= our_price * 1.02

def test_never_leaks_cost_fields():
    # The models explicitly do not have cost_price, min_acceptable_price, margin, floor keys
    from competitive_intelligence.market_comparison.models import MarketListingItem
    item = MarketListingItem(
        title="Test",
        source="Test",
        url="https://test.com",
        price=100.0,
        currency="USD",
        similarity=0.9,
        savings_abs=10.0,
        savings_pct=10.0,
        fetched_at=datetime.now(timezone.utc),
        is_live=True
    )
    data = item.model_dump()
    assert "cost_price" not in data
    assert "min_acceptable_price" not in data
    assert "margin" not in data
    assert "margins" not in data
    assert "floor" not in data

def test_seed_fallback_with_no_api_keys(monkeypatch):
    from app.core.config import get_settings
    settings = get_settings()
    monkeypatch.setattr(settings, "serp_api_key", "")
    monkeypatch.setattr(settings, "market_sources", "seeded")
    
    listings = asyncio.run(fetch_market_listings("Sony WH-1000XM5", "INR"))
    assert len(listings) > 0
    for lst in listings:
        assert lst.is_live is False

def test_survives_all_sources_timeout(monkeypatch):
    class TimeoutSource(PriceSource):
        async def _do_search(self, query: str, currency: str):
            await asyncio.sleep(7.0)  # > 6.0 timeout
            return []
            
    monkeypatch.setattr("competitive_intelligence.market_comparison.sources.SerpShoppingSource", TimeoutSource)
    monkeypatch.setattr("competitive_intelligence.market_comparison.sources.HtmlSource", TimeoutSource)
    monkeypatch.setattr("competitive_intelligence.market_comparison.sources.SeededSource", TimeoutSource)
    
    from app.core.config import get_settings
    monkeypatch.setattr(get_settings(), "market_sources", "serp,html,seeded")
    
    listings = asyncio.run(fetch_market_listings("Test", "USD"))
    assert listings == []  # Empty list, no error

def test_matcher_rejects_accessory(mock_listings):
    accessory = mock_listings[1]  # Case, price 1500
    our_price = 29990.0
    
    assert not plausibility_filter(accessory, our_price, "INR")

def test_similarity_computation():
    sim = compute_similarity("Sony WH-1000XM5", "Sony WH-1000XM5 Wireless Headphones")
    assert sim > 0.5
    
    sim_bad = compute_similarity("Sony WH-1000XM5", "Apple MacBook Air M3")
    assert sim_bad < 0.2

def test_savings_calculation():
    listings = [
        RawListing(
            title="Sony WH-1000XM5",
            source="Test",
            url="https://test.com/1",
            price=34990.0,
            currency="INR",
            fetched_at=datetime.now(timezone.utc),
            is_live=True
        )
    ]
    our_price = 29990.0
    
    items = asyncio.run(process_matches(listings, "Sony WH-1000XM5", our_price, "INR"))
    
    assert len(items) == 1
    assert items[0].savings_abs == 5000.0
    # 5000 / 34990 * 100 = 14.289... -> 14.3
    assert items[0].savings_pct == 14.3

def test_plausibility_filter():
    our_price = 100.0
    
    good = RawListing(title="Test", source="t", url="https://u", price=150.0, currency="USD", fetched_at=datetime.now(timezone.utc), is_live=True)
    assert plausibility_filter(good, our_price, "USD")
    
    too_low = RawListing(title="Test", source="t", url="https://u", price=40.0, currency="USD", fetched_at=datetime.now(timezone.utc), is_live=True)
    assert not plausibility_filter(too_low, our_price, "USD")
    
    too_high = RawListing(title="Test", source="t", url="https://u", price=350.0, currency="USD", fetched_at=datetime.now(timezone.utc), is_live=True)
    assert not plausibility_filter(too_high, our_price, "USD")

def test_live_html_scraping_new_product(monkeypatch):
    """Verify live web scraper produces is_live=True and listing_kind='product'."""
    from competitive_intelligence.market_comparison.sources import HtmlSource
    
    # Mock scrape_competitor_data to return a newly added product
    def mock_scrape(product_name, category=None, max_results=15, product_description=None):
        return [{
            "title": "Logitech MX Master 3S Wireless Mouse",
            "price": 8995.0,
            "rating": 4.7,
            "review_count": 120,
            "availability": "In Stock",
            "source": "Flipkart",
            "url": "https://www.flipkart.com/logitech-mx-master-3s/p/itm123",
            "image_url": "https://images.flipkart.com/img.jpg",
            "is_live": True,
            "listing_kind": "product"
        }]
        
    monkeypatch.setattr("competitive_intelligence.scraper.scrape_competitor_data", mock_scrape)
    source = HtmlSource()
    listings = asyncio.run(source.search("Logitech MX Master 3S", "INR"))
    
    assert len(listings) == 1
    assert listings[0].is_live is True
    assert listings[0].listing_kind == "product"
    assert listings[0].price == 8995.0
    assert listings[0].source == "Flipkart"
    assert "https://www.flipkart.com" in listings[0].url
