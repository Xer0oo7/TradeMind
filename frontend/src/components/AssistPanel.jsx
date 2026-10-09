import { useState, useEffect, useCallback, useRef } from 'react';
import {
  TrendingUp, TrendingDown, AlertTriangle, CheckCircle,
  HelpCircle, RefreshCw, Zap, ArrowRight, CornerDownLeft,
  ChevronDown, ChevronUp, DollarSign, Send, ShieldAlert,
  SlidersHorizontal, Sparkles
} from 'lucide-react';
import NeoCard from './NeoCard';
import NeoButton from './NeoButton';
import { formatMoney } from '../lib/format';
import { getAssist } from '../lib/api';

export default function AssistPanel({
  productId,
  latestBuyerMessage,
  sellerLastOffer = null,
  buyerLastOffer = null,
  roundNumber = 1,
  availableInventory = null,
  onApplyCounter = null,
  onSendCounter = null,
}) {
  const [assistData, setAssistData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Manual What-If Simulator state
  const [overridePrice, setOverridePrice] = useState('');
  const [overrideQty, setOverrideQty] = useState('');
  const [showSimulator, setShowSimulator] = useState(false);

  const prevMessageRef = useRef(null);

  const fetchAssist = useCallback(
    async (manualOverride = null, manualQuantity = null) => {
      if (!productId) return;

      const messageToAnalyze =
        latestBuyerMessage || (manualOverride ? `I offer ${manualOverride}` : '');

      if (!messageToAnalyze && !manualOverride) {
        setAssistData(null);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const payload = {
          product_id: Number(productId),
          message: messageToAnalyze || 'Inquiry',
          quantity: manualQuantity ? Number(manualQuantity) : null,
          seller_last_offer: sellerLastOffer ? Number(sellerLastOffer) : null,
          buyer_last_offer: buyerLastOffer ? Number(buyerLastOffer) : null,
          round: Math.max(1, Number(roundNumber) || 1),
          override_unit_price: manualOverride ? Number(manualOverride) : null,
          available_inventory: availableInventory ? Number(availableInventory) : null,
        };

        const result = await getAssist(payload);
        setAssistData(result);
      } catch (err) {
        console.error('Assist analysis failed:', err);
        setError(err.message || 'Failed to analyze offer.');
      } finally {
        setLoading(false);
      }
    },
    [
      productId,
      latestBuyerMessage,
      sellerLastOffer,
      buyerLastOffer,
      roundNumber,
      availableInventory,
    ]
  );

  // Auto-analyze when latest buyer message updates
  useEffect(() => {
    if (latestBuyerMessage && latestBuyerMessage !== prevMessageRef.current) {
      prevMessageRef.current = latestBuyerMessage;
      setOverridePrice('');
      fetchAssist();
    }
  }, [latestBuyerMessage, fetchAssist]);

  const handleSimulate = (e) => {
    e?.preventDefault();
    if (!overridePrice) return;
    fetchAssist(Number(overridePrice), overrideQty ? Number(overrideQty) : null);
  };

  const handleResetSimulation = () => {
    setOverridePrice('');
    setOverrideQty('');
    fetchAssist(null, null);
  };

  const detected = assistData?.detected;
  const economics = assistData?.economics;
  const verdict = assistData?.verdict;
  const suggestion = assistData?.suggestion;
  const warnings = assistData?.warnings || [];

  const zoneColor =
    verdict?.zone === 'green'
      ? 'bg-neo-teal text-neo-cream border-neo-navy'
      : verdict?.zone === 'amber'
      ? 'bg-neo-orange text-neo-navy border-neo-navy'
      : verdict?.zone === 'red'
      ? 'bg-neo-maroon text-neo-cream border-neo-navy'
      : 'bg-neo-navy/10 text-neo-navy border-neo-navy';

  const zoneLabel =
    verdict?.zone === 'green'
      ? 'GREEN ZONE: PROFITABLE (Above Floor)'
      : verdict?.zone === 'amber'
      ? 'AMBER ZONE: THIN MARGIN (Below Floor, Above Cost)'
      : verdict?.zone === 'red'
      ? 'RED ZONE: LOSS WARNING (Below Cost)'
      : 'NEUTRAL / INQUIRY';

  return (
    <div className="flex flex-col h-full bg-neo-cream/40 border-l-[3px] border-neo-navy font-body">
      {/* ── Assist Header ────────────────────────────────────────── */}
      <div className="p-3.5 bg-neo-navy text-neo-cream border-b-[3px] border-neo-navy flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-neo-orange flex items-center justify-center border-[2px] border-neo-cream shadow-neo-sm">
            <Zap className="w-4 h-4 text-neo-navy" />
          </div>
          <div>
            <h2 className="font-heading font-bold text-sm tracking-wide uppercase text-neo-cream">
              Seller Assist
            </h2>
            <p className="text-[10px] font-mono text-neo-cream/50">
              Deterministic Profit & Pricing Guard
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => fetchAssist(overridePrice || null, overrideQty || null)}
            disabled={loading}
            title="Refresh Analysis"
            className="p-1.5 bg-neo-cream/10 hover:bg-neo-orange hover:text-neo-navy text-neo-cream border-[1.5px] border-neo-cream/20 transition-all"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setShowSimulator(!showSimulator)}
            title="Toggle What-If Simulator"
            className={`p-1.5 border-[1.5px] transition-all ${
              showSimulator
                ? 'bg-neo-orange text-neo-navy border-neo-orange'
                : 'bg-neo-cream/10 text-neo-cream border-neo-cream/20 hover:bg-neo-cream/20'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ── Main Assist Scrollable Content ──────────────────────── */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Simulator Accordion Drawer */}
        {showSimulator && (
          <form
            onSubmit={handleSimulate}
            className="p-3 bg-white border-[3px] border-neo-navy shadow-neo-sm space-y-2.5"
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-heading font-bold uppercase text-neo-navy flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-neo-orange" />
                What-If Offer Simulator
              </span>
              {overridePrice && (
                <button
                  type="button"
                  onClick={handleResetSimulation}
                  className="text-[10px] font-mono text-neo-maroon hover:underline font-bold"
                >
                  Reset
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-mono font-bold uppercase text-neo-navy/60 mb-1">
                  Custom Price (₹)
                </label>
                <input
                  type="number"
                  step="any"
                  placeholder="e.g. 820"
                  value={overridePrice}
                  onChange={(e) => setOverridePrice(e.target.value)}
                  className="w-full text-xs font-mono p-1.5 border-[2px] border-neo-navy bg-neo-cream/30 focus:bg-white outline-none"
                />
              </div>
              <div>
                <label className="block text-[10px] font-mono font-bold uppercase text-neo-navy/60 mb-1">
                  Quantity
                </label>
                <input
                  type="number"
                  placeholder="e.g. 5"
                  value={overrideQty}
                  onChange={(e) => setOverrideQty(e.target.value)}
                  className="w-full text-xs font-mono p-1.5 border-[2px] border-neo-navy bg-neo-cream/30 focus:bg-white outline-none"
                />
              </div>
            </div>

            <NeoButton
              type="submit"
              variant="orange"
              size="sm"
              disabled={!overridePrice || loading}
              className="w-full text-xs py-1.5"
            >
              Simulate Economics
            </NeoButton>
          </form>
        )}

        {/* Loading state */}
        {loading && !assistData && (
          <div className="py-12 flex flex-col items-center justify-center text-center">
            <div className="w-8 h-8 border-[3px] border-neo-navy border-t-neo-orange animate-spin mb-3" />
            <span className="font-heading font-bold text-xs uppercase text-neo-navy">
              Calculating Pricing Economics...
            </span>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="bg-neo-maroon text-neo-cream border-[3px] border-neo-navy p-3 text-xs font-bold shadow-neo-sm">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="w-4 h-4 text-neo-orange" />
              <span>Analysis Error</span>
            </div>
            <p className="font-mono text-[11px] opacity-90">{error}</p>
          </div>
        )}

        {/* Empty state when no analysis yet */}
        {!loading && !assistData && !error && (
          <div className="py-16 text-center text-neo-navy/40">
            <HelpCircle className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="font-heading font-bold text-xs uppercase">
              Awaiting Buyer Offer
            </p>
            <p className="text-[11px] max-w-xs mx-auto mt-1">
              As messages arrive in the chat, the engine will automatically parse offers,
              compute margins, and suggest optimal counters.
            </p>
          </div>
        )}

        {/* Active Analysis Results */}
        {assistData && (
          <>
            {/* 1. Zone Pill & Verdict Headline */}
            <div className={`p-3 border-[3px] shadow-neo-sm ${zoneColor}`}>
              <div className="flex items-center gap-2 mb-1.5">
                {verdict?.zone === 'green' ? (
                  <CheckCircle className="w-4 h-4" />
                ) : verdict?.zone === 'amber' ? (
                  <AlertTriangle className="w-4 h-4" />
                ) : (
                  <ShieldAlert className="w-4 h-4" />
                )}
                <span className="font-heading font-bold text-xs uppercase tracking-wider">
                  {zoneLabel}
                </span>
              </div>
              <p className="text-xs leading-relaxed font-body">
                {verdict?.headline || 'No verdict generated.'}
              </p>
            </div>

            {/* Warnings list */}
            {warnings.length > 0 && (
              <div className="space-y-1">
                {warnings.map((w, idx) => (
                  <div
                    key={idx}
                    className="p-2 bg-neo-orange/20 border-[2px] border-neo-orange text-neo-navy text-[11px] font-mono flex items-start gap-1.5"
                  >
                    <AlertTriangle className="w-3.5 h-3.5 text-neo-maroon flex-shrink-0 mt-0.5" />
                    <span>{w}</span>
                  </div>
                ))}
              </div>
            )}

            {/* 2. Detected Offer Details */}
            {detected && detected.unit_price != null && (
              <div className="bg-white border-[3px] border-neo-navy p-3 shadow-neo-sm space-y-2">
                <div className="flex items-center justify-between border-b-[2px] border-neo-navy/10 pb-2">
                  <span className="font-heading font-bold text-xs uppercase text-neo-navy">
                    Detected Offer
                  </span>
                  <span
                    className={`px-2 py-0.5 text-[10px] font-mono font-bold uppercase border-[1.5px] border-neo-navy ${
                      detected.confidence === 'high'
                        ? 'bg-neo-teal text-neo-cream'
                        : detected.confidence === 'medium'
                        ? 'bg-neo-orange text-neo-navy'
                        : 'bg-neo-maroon text-neo-cream'
                    }`}
                  >
                    {detected.confidence} confidence
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center pt-1">
                  <div className="p-2 bg-neo-cream/40 border border-neo-navy/20">
                    <p className="text-[10px] font-mono uppercase text-neo-navy/50 font-bold">
                      Unit Price
                    </p>
                    <p className="text-sm font-heading font-bold text-neo-navy">
                      {formatMoney(detected.unit_price)}
                    </p>
                  </div>
                  <div className="p-2 bg-neo-cream/40 border border-neo-navy/20">
                    <p className="text-[10px] font-mono uppercase text-neo-navy/50 font-bold">
                      Quantity
                    </p>
                    <p className="text-sm font-heading font-bold text-neo-navy">
                      {detected.quantity || 1}
                    </p>
                  </div>
                  <div className="p-2 bg-neo-cream/40 border border-neo-navy/20">
                    <p className="text-[10px] font-mono uppercase text-neo-navy/50 font-bold">
                      Total
                    </p>
                    <p className="text-sm font-heading font-bold text-neo-navy truncate">
                      {formatMoney(
                        detected.total_price ||
                          detected.unit_price * (detected.quantity || 1)
                      )}
                    </p>
                  </div>
                </div>

                {detected.flags && detected.flags.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {detected.flags.map((flag, fIdx) => (
                      <span
                        key={fIdx}
                        className="px-1.5 py-0.5 text-[9px] font-mono font-bold uppercase bg-neo-navy/5 text-neo-navy/70 border border-neo-navy/20"
                      >
                        {flag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 3. Economics Breakdown */}
            {economics && (
              <div className="bg-white border-[3px] border-neo-navy p-3 shadow-neo-sm space-y-2.5">
                <span className="font-heading font-bold text-xs uppercase text-neo-navy block border-b-[2px] border-neo-navy/10 pb-1.5">
                  Financial Impact
                </span>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="flex items-center justify-between p-2 bg-neo-cream/30 border border-neo-navy/15">
                    <span className="text-[11px] font-mono text-neo-navy/70">
                      Unit Profit:
                    </span>
                    <span
                      className={`font-mono font-bold ${
                        economics.unit_profit >= 0
                          ? 'text-neo-teal'
                          : 'text-neo-maroon'
                      }`}
                    >
                      {formatMoney(economics.unit_profit)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between p-2 bg-neo-cream/30 border border-neo-navy/15">
                    <span className="text-[11px] font-mono text-neo-navy/70">
                      Margin:
                    </span>
                    <span
                      className={`font-mono font-bold ${
                        economics.margin_pct >= 0
                          ? 'text-neo-teal'
                          : 'text-neo-maroon'
                      }`}
                    >
                      {economics.margin_pct}%
                    </span>
                  </div>

                  <div className="flex items-center justify-between p-2 bg-neo-cream/30 border border-neo-navy/15">
                    <span className="text-[11px] font-mono text-neo-navy/70">
                      Total Profit:
                    </span>
                    <span
                      className={`font-mono font-bold ${
                        economics.total_profit >= 0
                          ? 'text-neo-teal'
                          : 'text-neo-maroon'
                      }`}
                    >
                      {formatMoney(economics.total_profit)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between p-2 bg-neo-cream/30 border border-neo-navy/15">
                    <span className="text-[11px] font-mono text-neo-navy/70">
                      Gap to Floor:
                    </span>
                    <span
                      className={`font-mono font-bold ${
                        economics.gap_to_floor >= 0
                          ? 'text-neo-teal'
                          : 'text-neo-maroon'
                      }`}
                    >
                      {formatMoney(economics.gap_to_floor)}
                    </span>
                  </div>
                </div>

                <div className="pt-1 flex items-center justify-between text-[11px] font-mono px-1">
                  <span className="text-neo-navy/60">Discount vs Base Ask:</span>
                  <span className="font-bold text-neo-navy">
                    {economics.discount_vs_base_pct}%
                  </span>
                </div>
              </div>
            )}

            {/* 4. Engine Suggestion & Actions */}
            {suggestion && suggestion.counter_price != null && (
              <div className="bg-neo-navy text-neo-cream border-[3px] border-neo-navy p-3.5 shadow-neo space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-neo-orange animate-ping" />
                    <span className="font-heading font-bold text-xs uppercase text-neo-orange">
                      Recommended Counter
                    </span>
                  </div>
                  <span className="px-1.5 py-0.5 text-[9px] font-mono font-bold uppercase bg-neo-cream/20 text-neo-cream">
                    {suggestion.action || 'counter'}
                  </span>
                </div>

                <div className="p-3 bg-white/5 border border-neo-cream/20 text-center">
                  <p className="text-[10px] font-mono uppercase text-neo-cream/50">
                    Target Counter Price
                  </p>
                  <p className="text-xl sm:text-2xl font-heading font-bold text-neo-orange mt-0.5">
                    {formatMoney(suggestion.counter_price)}
                  </p>
                </div>

                {suggestion.reply_text && (
                  <div className="p-2.5 bg-black/30 border border-neo-cream/15 text-xs font-mono text-neo-cream/90 leading-relaxed italic">
                    "{suggestion.reply_text}"
                  </div>
                )}

                {/* Quick Action Buttons */}
                <div className="grid grid-cols-2 gap-2 pt-1">
                  {onApplyCounter && (
                    <button
                      type="button"
                      onClick={() =>
                        onApplyCounter(suggestion.reply_text, suggestion.counter_price)
                      }
                      className="px-3 py-2 bg-neo-cream text-neo-navy border-[2px] border-neo-navy font-heading font-bold text-[11px] uppercase shadow-neo-sm hover:translate-x-[1px] hover:translate-y-[1px] flex items-center justify-center gap-1"
                    >
                      <CornerDownLeft className="w-3.5 h-3.5" />
                      Insert In Chat
                    </button>
                  )}

                  {onSendCounter && (
                    <button
                      type="button"
                      onClick={() =>
                        onSendCounter(suggestion.reply_text, suggestion.counter_price)
                      }
                      className="px-3 py-2 bg-neo-orange text-neo-navy border-[2px] border-neo-navy font-heading font-bold text-[11px] uppercase shadow-neo-sm hover:translate-x-[1px] hover:translate-y-[1px] flex items-center justify-center gap-1"
                    >
                      <Send className="w-3.5 h-3.5" />
                      Send Now
                    </button>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Confidentiality Footer ───────────────────────────────── */}
      <div className="p-2.5 bg-neo-navy border-t-[3px] border-neo-navy text-[10px] font-mono uppercase text-neo-cream/60 text-center">
        Confidential • Calculations never transmitted to buyer or Firestore
      </div>
    </div>
  );
}
