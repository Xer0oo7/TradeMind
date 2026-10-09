import { useState, useEffect, useRef, useId } from 'react';
import { TrendingDown, X, ArrowUpRight, RotateCw } from 'lucide-react';
import { useI18n } from '../../context/I18nContext';
import { useMarketComparison } from '../../hooks/useMarketComparison';
import { resolveListingUrl, formatMoney, getMonogramColor } from '../../lib/formatters';

export default function MarketDock({
  productId = 'TRADE-001',
  productName = null,
  currency = 'INR',
  ourPrice = null,
  autoExpandSignal = null,
  className = '',
}) {
  const { t } = useI18n();
  const { data, loading, error, refresh } = useMarketComparison(productId, productName, ourPrice, currency);
  const [expanded, setExpanded] = useState(false);
  const [pulse, setPulse] = useState(false);
  const [highlightFirst, setHighlightFirst] = useState(false);
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth < 640 : false
  );
  const [diffMins, setDiffMins] = useState(0);

  const popoverId = useId();
  const pillRef = useRef(null);
  const popoverRef = useRef(null);
  const lastSignalRef = useRef(null);

  useEffect(() => {
    const fetchedAt = data?.items?.[0]?.fetched_at;
    if (fetchedAt) {
      const mins = Math.max(0, Math.floor((Date.now() - new Date(fetchedAt).getTime()) / 60000));
      setDiffMins(isNaN(mins) ? 0 : mins);
    }
  }, [data]);

  // Resize listener
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Contextual Trigger: pulse twice + auto-expand once
  useEffect(() => {
    if (autoExpandSignal && autoExpandSignal !== lastSignalRef.current && data?.items?.length) {
      lastSignalRef.current = autoExpandSignal;
      setPulse(true);
      setHighlightFirst(true);
      const timer = setTimeout(() => {
        setExpanded(true);
      }, 100);
      const pulseTimer = setTimeout(() => {
        setPulse(false);
      }, 1600);
      return () => {
        clearTimeout(timer);
        clearTimeout(pulseTimer);
      };
    }
  }, [autoExpandSignal, data]);

  // Outside click & Escape listener
  useEffect(() => {
    if (!expanded) return;

    const handleClickOutside = (e) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target) &&
        pillRef.current &&
        !pillRef.current.contains(e.target)
      ) {
        setExpanded(false);
        pillRef.current?.focus();
      }
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setExpanded(false);
        pillRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [expanded]);

  // If loading failure, error, or no items: render nothing, log to console.debug only
  if (error) {
    console.debug('MarketDock error:', error);
    return null;
  }

  // Loading on first fetch: slim skeleton pill, no layout shift
  if (loading && !data) {
    return (
      <div
        className={`absolute bottom-full end-0 mb-4 h-10 w-44 rounded-none border-2 border-neo-navy shadow-[4px_4px_0_#15616D] animate-shimmer pointer-events-none ${className}`}
        aria-hidden="true"
      />
    );
  }

  const items = data?.items || [];
  if (!items || items.length === 0) {
    return null;
  }

  const effectiveOurPrice = ourPrice ?? data.our_price ?? 0;
  const effectiveCurrency = currency || data.currency || 'INR';

  // Only consider items with matching currency and price > ourPrice
  const comparableItems = items.filter(
    (item) => (item.currency || 'INR').toUpperCase() === effectiveCurrency.toUpperCase() && item.price > effectiveOurPrice
  );

  if (comparableItems.length === 0) {
    return null;
  }

  const count = comparableItems.length;
  const maxSavingsPct = Math.round(
    Math.max(...comparableItems.map((i) => i.savings_pct ?? ((i.price - effectiveOurPrice) / i.price) * 100))
  );

  const isAllLive = comparableItems.every((i) => i.is_live);

  return (
    <div className={`absolute bottom-full end-0 mb-4 z-30 select-none ${className}`}>
      {/* ── Collapsed Pill ── */}
      <button
        ref={pillRef}
        type="button"
        aria-expanded={expanded}
        aria-controls={popoverId}
        aria-label={`${t('market.market') || 'MARKET'}: ${count} ${t('market.cheaperThanMarket', { count })}, ${t('market.upToLower', { percent: maxSavingsPct })}`}
        onClick={() => setExpanded((prev) => !prev)}
        className={`
          h-10 px-3.5 bg-neo-navy text-neo-cream border-2 border-neo-navy
          shadow-[4px_4px_0_#15616D] hover:shadow-[6px_6px_0_#15616D]
          hover:translate-x-[-2px] hover:translate-y-[-2px]
          active:translate-x-0 active:translate-y-0
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neo-orange focus-visible:ring-offset-2
          transition-all flex items-center gap-2 whitespace-nowrap cursor-pointer
          ${pulse ? 'animate-dock-pulse-twice' : ''}
        `}
      >
        <TrendingDown className="w-4 h-4 text-neo-orange flex-shrink-0" />
        <span className="font-heading font-bold text-xs uppercase tracking-wider">
          {t('market.market') || 'MARKET'}
        </span>
        <span className="bg-neo-orange text-neo-navy text-[11px] font-black px-1.5 py-0.2 border border-neo-navy rounded-full leading-tight">
          {count}
        </span>
        <span className="text-neo-cream/70 text-[11px] font-normal normal-case tracking-normal">
          {t('market.upToLower', { percent: maxSavingsPct })}
        </span>
      </button>

      {/* ── Expanded Popover / Bottom Sheet ── */}
      {expanded && (
        <div
          ref={popoverRef}
          id={popoverId}
          role="dialog"
          aria-label={t('market.marketCheck') || 'Market check'}
          className={`
            ${
              isMobile
                ? 'fixed inset-x-0 bottom-0 max-h-[70vh] w-full border-t-4 border-neo-navy shadow-2xl z-50'
                : 'absolute bottom-full end-0 mb-2 w-[360px] max-w-[calc(100vw-32px)] max-h-[min(60vh,440px)] border-2 border-neo-navy shadow-[6px_6px_0_#001524]'
            }
            bg-neo-cream text-neo-navy p-4 flex flex-col gap-3 overflow-y-auto animate-dock-popover
          `}
        >
          {/* Header Row */}
          <div className="flex items-center justify-between pb-2 border-b-2 border-neo-navy/15 flex-shrink-0">
            <span className="font-heading font-bold text-sm uppercase tracking-wider text-neo-navy">
              {t('market.marketCheck') || 'Market check'}
            </span>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {isAllLive ? (
                <span className="text-[10px] font-black uppercase text-neo-cream bg-neo-teal px-2 py-0.5 border border-neo-navy rounded-sm whitespace-nowrap">
                  {diffMins === 0 ? 'LIVE · just now' : t('market.liveCheckedAgo', { time: `${diffMins} min` })}
                </span>
              ) : (
                <span className="text-[10px] font-black uppercase text-neo-orange border border-neo-orange bg-neo-orange/10 px-2 py-0.5 rounded-sm whitespace-nowrap">
                  {t('market.sampleData') || 'SAMPLE DATA'}
                </span>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  refresh();
                }}
                disabled={loading}
                className="p-1 hover:bg-neo-navy/10 rounded transition-colors text-neo-navy cursor-pointer disabled:opacity-50"
                title="Scan live market now"
                aria-label="Scan live market"
              >
                <RotateCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-neo-orange' : ''}`} />
              </button>
              <button
                type="button"
                onClick={() => {
                  setExpanded(false);
                  pillRef.current?.focus();
                }}
                className="p-1 hover:bg-neo-navy/10 rounded transition-colors text-neo-navy cursor-pointer"
                aria-label={t('market.close') || 'Close'}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* List of up to 5 rows */}
          <div className="flex flex-col gap-2 overflow-y-auto pr-0.5">
            {comparableItems.slice(0, 5).map((item, index) => {
              const url = resolveListingUrl(item);
              const savings = Math.max(0, item.savings_abs ?? item.price - effectiveOurPrice);
              const savingsPct = Math.round(
                item.savings_pct ?? ((item.price - effectiveOurPrice) / item.price) * 100
              );
              const barWidth = Math.min(
                100,
                Math.max(10, Math.round((effectiveOurPrice / item.price) * 100))
              );
              const isHighlighted = highlightFirst && index === 0;
              const isSearchKind = item.listing_kind === 'search' || !item.is_live;
              const hoverTitle = isSearchKind
                ? t('market.searchOn', { retailer: item.source }) || `Search on ${item.source}`
                : t('market.viewListing') || 'View listing';

              return (
                <a
                  key={item.id || index}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`${hoverTitle} (${formatMoney(savings, effectiveCurrency)} below ${item.source})`}
                  aria-label={`${item.source}, ${formatMoney(item.price, effectiveCurrency)}, ${savingsPct}% lower than this seller, ${formatMoney(savings, effectiveCurrency)} below ${item.source}, opens in a new tab`}
                  style={{ animationDelay: `${index * 40}ms` }}
                  className={`
                    group min-h-[64px] bg-white/60 border-2 border-neo-navy p-2 px-3
                    grid grid-cols-[36px_1fr_auto] gap-2.5 items-center
                    shadow-[3px_3px_0_#001524] hover:shadow-[5px_5px_0_#001524]
                    hover:translate-x-[-2px] hover:translate-y-[-2px]
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neo-orange
                    transition-all animate-dock-row
                    ${isHighlighted ? 'border-l-4 border-l-neo-orange bg-neo-orange/10' : ''}
                  `}
                >
                  {/* Monogram Avatar */}
                  <div
                    className={`w-9 h-9 rounded-full border-2 border-neo-navy flex items-center justify-center font-bold font-heading text-sm text-neo-cream flex-shrink-0 ${getMonogramColor(
                      item.source
                    )}`}
                    aria-hidden="true"
                  >
                    {item.source ? item.source.charAt(0).toUpperCase() : 'M'}
                  </div>

                  {/* Middle Column */}
                  <div className="min-w-0 flex flex-col justify-center">
                    <span className="text-[11px] font-black uppercase tracking-wider text-neo-teal truncate">
                      {item.source}
                    </span>
                    <span
                      className="text-[13px] font-semibold text-neo-navy truncate block leading-tight"
                      title={item.title}
                    >
                      {item.title}
                    </span>
                    {/* Mini comparison bar */}
                    <div
                      className="h-1 bg-neo-navy/20 rounded-full overflow-hidden mt-1.5"
                      aria-hidden="true"
                    >
                      <div
                        className="h-full bg-neo-teal transition-all duration-500 ease-out"
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                  </div>

                  {/* Right Column */}
                  <div className="flex flex-col items-end justify-center flex-shrink-0 pl-1">
                    <span className="text-[13px] font-bold tabular-nums text-neo-maroon line-through block text-right leading-none">
                      {formatMoney(item.price, effectiveCurrency)}
                    </span>
                    <div className="flex items-center gap-1 mt-1">
                      <span className="text-[11px] font-black bg-neo-orange text-neo-navy px-1.5 py-0.5 border-2 border-neo-navy rounded-full whitespace-nowrap leading-tight">
                        -{savingsPct}%
                      </span>
                      <ArrowUpRight className="w-3.5 h-3.5 text-neo-navy opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                    </div>
                  </div>
                </a>
              );
            })}
          </div>

          {/* Footer Row */}
          <div className="flex items-center justify-between pt-2 border-t border-neo-navy/15 text-[10px] text-neo-navy/60 font-body flex-shrink-0">
            <span>
              {isAllLive
                ? t('market.liveNote') || 'Prices from public listings'
                : t('market.demoNote') || 'Demo estimates. Tap a row to search the retailer.'}
            </span>
            <button
              type="button"
              onClick={() => refresh()}
              disabled={loading}
              className="p-1 hover:bg-neo-navy/10 rounded transition-colors text-neo-navy cursor-pointer"
              title={t('market.refresh') || 'Refresh'}
              aria-label={t('market.refresh') || 'Refresh'}
            >
              <RotateCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
