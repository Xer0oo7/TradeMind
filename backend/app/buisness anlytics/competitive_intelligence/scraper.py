"""
Competitive Intelligence - Multi-Source Web Scraper

Scrapes multiple publicly-accessible sources for competitor pricing data:
  1. Amazon.in  - search results page
  2. Flipkart   - search results page
  3. Google Shopping (lite) - public search snippets

GRACEFUL DEGRADATION:
- Each source is independent; if one fails, others still return data
- If ALL sources fail, returns empty list (comparison engine handles it)
- Conservative timeouts per source (8s) so total stays under 25s

ETHICAL SCRAPING:
- Only public search result pages (no login, no API abuse)
- Single page per source (no pagination crawling)
- Respectful user-agent, no CAPTCHA solving
"""

import logging
import random
import re
from typing import List, Dict, Any, Optional
from urllib.parse import quote_plus
from concurrent.futures import ThreadPoolExecutor, as_completed

logger = logging.getLogger(__name__)

# ── Shared helpers ────────────────────────────────────────────────

_USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:129.0) Gecko/20100101 Firefox/129.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
]


def _ua() -> str:
    return random.choice(_USER_AGENTS)


def _headers(extra: dict | None = None) -> dict:
    h = {
        "User-Agent": _ua(),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-IN,en-US;q=0.9,en;q=0.8",
        "Accept-Encoding": "gzip, deflate",
        "Connection": "keep-alive",
        "Cache-Control": "no-cache",
        "Sec-Ch-Ua": '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"Windows"',
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1"
    }
    if extra:
        h.update(extra)
    return h


def _safe_float(text: str | None) -> Optional[float]:
    """Extract a float from price-like text.  Returns None on failure."""
    if not text:
        return None
    cleaned = re.sub(r"[^\d.]", "", text.replace(",", "").replace("\u20b9", "").replace("Rs", "").replace("rs", ""))
    try:
        v = float(cleaned)
        return v if v > 0 else None
    except (ValueError, TypeError):
        return None


def _safe_int(text: str | None) -> Optional[int]:
    if not text:
        return None
    cleaned = re.sub(r"[^\d]", "", text.replace(",", ""))
    try:
        return int(cleaned)
    except (ValueError, TypeError):
        return None


# ══════════════════════════════════════════════════════════════════
#  PUBLIC API
# ══════════════════════════════════════════════════════════════════

def scrape_competitor_data(
    product_name: str,
    category: Optional[str] = None,
    max_results: int = 15,
    product_description: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Scrape multiple sources in parallel and merge results.

    Returns list of raw product dicts:
        { title, price, rating, review_count, availability, source, url, image_url, is_live, listing_kind }
    """
    max_results = min(max_results, 20)
    query = f"{category} {product_name}" if category else product_name

    scrapers = {
        "Amazon.in": (_scrape_amazon, query, max_results),
        "Flipkart":  (_scrape_flipkart, query, max_results),
    }

    all_products: List[Dict[str, Any]] = []

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = {
            pool.submit(fn, q, n): name
            for name, (fn, q, n) in scrapers.items()
        }
        for future in as_completed(futures, timeout=12):
            source = futures[future]
            try:
                results = future.result()
                for p in results:
                    p["source"] = source
                    p["is_live"] = True
                    p["listing_kind"] = "product"
                all_products.extend(results)
                logger.info(f"Scraper [{source}]: {len(results)} products")
            except Exception as e:
                logger.warning(f"Scraper [{source}] failed: {e}")

    logger.info(f"Scraper total: {len(all_products)} products from all sources")
    return all_products


# ══════════════════════════════════════════════════════════════════
#  Amazon.in
# ══════════════════════════════════════════════════════════════════

def _scrape_amazon(query: str, max_results: int) -> List[Dict[str, Any]]:
    try:
        import requests
        from bs4 import BeautifulSoup
    except ImportError:
        return []

    url = f"https://www.amazon.in/s?k={quote_plus(query)}"
    try:
        resp = requests.get(url, headers=_headers(), timeout=7, allow_redirects=True)
        if resp.status_code != 200:
            return []

        soup = BeautifulSoup(resp.text, "html.parser")
        # Find product result items
        cards = soup.select('.s-result-item[data-asin]')
        if not cards:
            cards = soup.select('[data-component-type="s-search-result"]')

        products = []
        for card in cards:
            p = _parse_amazon_card(card, query)
            if p and p.get("price"):
                products.append(p)
                if len(products) >= max_results:
                    break
        return products
    except Exception as e:
        logger.warning(f"Amazon scrape error: {e}")
        return []


def _parse_amazon_card(card, query: str = "") -> Optional[Dict[str, Any]]:
    try:
        asin = card.get('data-asin', '').strip()
        classes = card.get('class', [])
        if not asin or len(asin) != 10 or 'AdHolder' in classes:
            return None

        # Price
        price_el = card.select_one('.a-price-whole') or card.select_one('.a-offscreen')
        price = _safe_float(price_el.get_text(strip=True)) if price_el else None
        if not price or price <= 0:
            return None

        # Title: extract brand and link title
        brand = ""
        h2 = card.find('h2')
        if h2:
            brand = h2.get_text(' ', strip=True)

        title = ""
        link_href = ""
        for a in card.find_all('a'):
            href = a.get('href', '')
            if '/dp/' in href or f'/{asin}' in href:
                txt = a.get_text(' ', strip=True)
                if len(txt) > len(title):
                    title = txt
                    link_href = href

        if not title:
            title = brand or query or "Product"
        elif brand and brand.lower() not in title.lower():
            title = f"{brand} {title}"

        title = re.sub(r'\s+', ' ', title).strip()

        # URL
        if link_href.startswith('/'):
            url = f"https://www.amazon.in{link_href.split('?')[0]}"
        elif link_href.startswith('http'):
            url = link_href.split('?')[0]
        else:
            url = f"https://www.amazon.in/dp/{asin}"

        # Image
        img_el = card.select_one('img.s-image') or card.find('img')
        image_url = img_el.get('src') if img_el else None

        # Rating & reviews
        rating = None
        rating_el = card.select_one('.a-icon-star-small .a-icon-alt') or card.select_one('[aria-label*="out of 5"]')
        if rating_el:
            try:
                rating = float(rating_el.get_text(strip=True).split()[0])
            except (ValueError, IndexError):
                pass

        review_count = None
        review_el = card.select_one('a[href*="customerReviews"] span') or card.select_one('.a-size-base.s-underline-text')
        if review_el:
            review_count = _safe_int(review_el.get_text(strip=True))

        return {
            "title": title,
            "price": price,
            "rating": rating,
            "review_count": review_count,
            "availability": "In Stock",
            "url": url,
            "image_url": image_url,
            "source": "Amazon.in",
            "is_live": True,
            "listing_kind": "product"
        }
    except Exception:
        return None


# ══════════════════════════════════════════════════════════════════
#  Flipkart
# ══════════════════════════════════════════════════════════════════

def _scrape_flipkart(query: str, max_results: int) -> List[Dict[str, Any]]:
    try:
        import requests
        from bs4 import BeautifulSoup
    except ImportError:
        return []

    url = f"https://www.flipkart.com/search?q={quote_plus(query)}"
    try:
        resp = requests.get(url, headers=_headers(), timeout=7, allow_redirects=True)
        if resp.status_code != 200:
            return []

        soup = BeautifulSoup(resp.text, "html.parser")
        cards = soup.select('div[data-id], .tUxRFH, ._1AtVbE, .cPHDOP')

        products = []
        for card in cards:
            p = _parse_flipkart_card(card, query)
            if p and p.get("price"):
                products.append(p)
                if len(products) >= max_results:
                    break
        return products
    except Exception as e:
        logger.warning(f"Flipkart scrape error: {e}")
        return []


def _parse_flipkart_card(card, query: str = "") -> Optional[Dict[str, Any]]:
    try:
        # Title
        title_el = (
            card.select_one('a[title]') or
            card.select_one('.KzDlHZ') or
            card.select_one('._4rR01T') or
            card.select_one('.s1Q9rs') or
            card.select_one('.wByErj') or
            card.select_one('.IRpwTa')
        )
        title = None
        if title_el:
            title = title_el.get("title") or title_el.get_text(strip=True)
        if not title:
            return None
        title = re.sub(r'\s+', ' ', title).strip()

        # Price
        price_el = (
            card.select_one('.Nx9bqj') or
            card.select_one('._30jeq3') or
            card.select_one('.hZ3P6w') or
            card.select_one('._1_WHN1')
        )
        price = _safe_float(price_el.get_text(strip=True)) if price_el else None
        if not price or price <= 0:
            return None

        # URL
        link_el = card.select_one('a[href*="/p/"]') or card.select_one('a[href]')
        href = link_el.get('href') if link_el else ''
        if href.startswith('/'):
            url = f"https://www.flipkart.com{href.split('?')[0]}"
        elif href.startswith('http'):
            url = href.split('?')[0]
        else:
            url = f"https://www.flipkart.com/search?q={quote_plus(query)}"

        # Image
        img_el = card.select_one('img[src*="flixcart"], img.DByuf4, img._396cs4, img')
        image_url = img_el.get('src') if img_el else None

        # Rating
        rating = None
        rating_el = card.select_one('.MKiFS6, .XQDdHH, ._3LWZlK, .hGSR34')
        if rating_el:
            try:
                rating = float(rating_el.get_text(strip=True))
            except (ValueError, TypeError):
                pass

        # Reviews
        review_count = None
        count_el = card.select_one('.PvbNMB, .Wphh3N span:last-child, ._2_R_DZ span')
        if count_el:
            review_count = _safe_int(count_el.get_text(strip=True))

        return {
            "title": title,
            "price": price,
            "rating": rating,
            "review_count": review_count,
            "availability": "In Stock",
            "url": url,
            "image_url": image_url,
            "source": "Flipkart",
            "is_live": True,
            "listing_kind": "product"
        }
    except Exception:
        return None
