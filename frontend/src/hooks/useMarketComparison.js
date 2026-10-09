import { useState, useEffect, useCallback } from 'react';
import { getMarketComparison } from '../lib/api';

export function useMarketComparison(
  productId = 'TRADE-001',
  productName = null,
  ourPrice = null,
  currency = 'INR'
) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchData = useCallback(async (isRefresh = false) => {
    const pid = productId || 'TRADE-001';
    const cacheKey = `market_comparison_${pid}_${(productName || '').toLowerCase()}_${ourPrice || ''}`;
    
    if (!isRefresh) {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (parsed && parsed.data && parsed.data.items && parsed.data.items.length > 0) {
            // If cached data has live items and is < 15 min old, use it
            const isLive = parsed.data.items.some(i => i.is_live);
            const maxAge = isLive ? 15 * 60 * 1000 : 30 * 1000; // if sample data, re-check faster
            if (Date.now() - parsed.timestamp < maxAge) {
              setData(parsed.data);
              return;
            }
          }
        } catch {
          // ignore cache parse error
        }
      }
    }

    setLoading(true);
    setError(null);

    const controller = new AbortController();
    let attempt = 0;
    const maxRetries = 1;
    
    const tryFetch = async () => {
      try {
        const result = await getMarketComparison(
          pid,
          5,
          productName,
          ourPrice,
          currency,
          isRefresh,
          controller.signal
        );
        setData(result);
        sessionStorage.setItem(cacheKey, JSON.stringify({
          data: result,
          timestamp: Date.now()
        }));
      } catch (err) {
        if (err.name === 'AbortError') return;
        
        if (attempt < maxRetries) {
          attempt++;
          await new Promise(r => setTimeout(r, 1000));
          await tryFetch();
        } else {
          console.warn('Market comparison live scrape notice:', err);
          setError(err);
          setData(null);
        }
      }
    };
    
    tryFetch().finally(() => {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    });

    return () => controller.abort();
  }, [productId, productName, ourPrice, currency]);

  useEffect(() => {
    const cleanup = fetchData();
    return () => {
      if (cleanup && typeof cleanup.then === 'function') {
        cleanup.then(fn => fn && fn());
      }
    };
  }, [fetchData]);

  return { data, loading, error, refresh: () => fetchData(true) };
}
