import asyncio
import time
from typing import Dict, Any, Optional
import structlog
from datetime import datetime

logger = structlog.get_logger(__name__)

class CacheEntry:
    def __init__(self, data: Any, ttl_seconds: int):
        self.data = data
        self.expires_at = time.time() + ttl_seconds
        self.created_at = time.time()
        
    @property
    def is_expired(self) -> bool:
        return time.time() > self.expires_at

class MarketComparisonCache:
    def __init__(self, ttl_seconds: int = 21600):
        self.ttl = ttl_seconds
        self._cache: Dict[str, CacheEntry] = {}
        self._locks: Dict[str, asyncio.Lock] = {}
        
    def _get_lock(self, key: str) -> asyncio.Lock:
        if key not in self._locks:
            self._locks[key] = asyncio.Lock()
        return self._locks[key]
        
    async def get(self, key: str) -> Optional[Any]:
        entry = self._cache.get(key)
        if entry:
            if entry.is_expired:
                # Stale-while-revalidate scenario
                logger.info(f"Cache expired for {key}, returning stale data temporarily.")
                return entry.data
            return entry.data
        return None
        
    async def set(self, key: str, data: Any) -> None:
        self._cache[key] = CacheEntry(data, self.ttl)
        
    def is_stale(self, key: str) -> bool:
        entry = self._cache.get(key)
        return entry is None or entry.is_expired

# Global cache instance
market_cache = MarketComparisonCache()
