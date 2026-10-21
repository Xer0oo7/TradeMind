import { useState, useEffect, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart3, RefreshCw, CheckCircle, XCircle,
  AlertTriangle, FileText,
  Brain, IndianRupee, TrendingUp, TrendingDown, ShoppingCart, Package,
  Percent, Activity, Zap, Info, Calculator,
  Sparkles, Target, Shield, Search, Lightbulb, PlusCircle, Tag, Settings
} from 'lucide-react';
import Layout from '../components/Layout';
import NeoCard from '../components/NeoCard';
import NeoButton from '../components/NeoButton';
import { calculateAnalytics, getCompetitiveAnalysis, getAnalyticsHealth, getAuthToken } from '../lib/api';
import { createProduct } from '../lib/productStore';
import { useI18n } from '../context/I18nContext';

// ─── Default form values ─────────────────────────────────────────
const DEFAULT_PRODUCT = {
  product_name: '',
  product_description: '',
  cost_price: '',
  selling_price: '',
  initial_stock: '',
  platform_fee_percent: '0',
  shipping_cost: '0',
  marketing_cost: '0',
  category: 'General',
  mode: 'MAX_PROFIT',
  max_rounds: '10',
  min_acceptable_price: '',
  max_loss_percent: '0',
};

// ─── Severity colors ────────────────────────────────────────────
const severityStyles = {
  info:     { bg: 'bg-neo-navy/10',     border: 'border-neo-navy',   text: 'text-neo-navy',   icon: Info },
  warning:  { bg: 'bg-neo-orange/10',   border: 'border-neo-orange', text: 'text-neo-orange', icon: AlertTriangle },
  critical: { bg: 'bg-neo-maroon/10',   border: 'border-neo-maroon', text: 'text-neo-maroon', icon: XCircle },
  success:  { bg: 'bg-neo-teal/10',     border: 'border-neo-teal',   text: 'text-neo-teal',   icon: CheckCircle },
};

// ─── Extracted outside to prevent re-mount on every keystroke ──
const InputField = ({ label, value, onChange, icon: Icon, placeholder, type = 'number' }) => (
  <div className="space-y-1">
    <label className="text-[10px] sm:text-xs font-bold text-neo-navy/60 uppercase flex items-center gap-1">
      {Icon && <Icon className="w-3 h-3" />}
      {label}
    </label>
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm bg-neo-cream border-[2px] border-neo-navy font-mono text-neo-navy focus:outline-none focus:border-neo-orange transition-colors"
    />
  </div>
);

export default function BusinessAnalytics() {
  const { t } = useI18n();

  // ─── State ───────────────────────────────────────────────────
  const [product, setProduct] = useState(DEFAULT_PRODUCT);
  const [analyticsData, setAnalyticsData] = useState(null);
  const [competitiveData, setCompetitiveData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [compLoading, setCompLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('metrics');
  const [filter, setFilter] = useState('all');
  const [backendHealthy, setBackendHealthy] = useState(null);
  const [addingProduct, setAddingProduct] = useState(false);
  const [addProductMsg, setAddProductMsg] = useState(null);
  const resultsRef = useRef(null);

  // ─── Stats derived from analytics response ───────────────────
  const stats = analyticsData
    ? {
        revenue:    `₹${Number(analyticsData.summary_metrics.gross_revenue).toLocaleString()}`,
        profit:     `₹${Number(analyticsData.summary_metrics.profit_or_loss).toLocaleString()}`,
        margin:     `${Number(analyticsData.summary_metrics.profit_margin_percent).toFixed(1)}%`,
        conversion: `${Number(analyticsData.summary_metrics.conversion_rate).toFixed(1)}%`,
      }
    : { revenue: '₹0', profit: '₹0', margin: '0%', conversion: '0%' };

  // ─── Health check on mount ───────────────────────────────────
  useEffect(() => {
    getAnalyticsHealth()
      .then(() => setBackendHealthy(true))
      .catch(() => setBackendHealthy(false));
  }, []);

  // ─── Opportunity Score (Meta Ads style — updates on every keystroke) ──
  const opportunityScore = useMemo(() => {
    const cost = parseFloat(product.cost_price) || 0;
    const selling = parseFloat(product.selling_price) || 0;
    const stock = parseFloat(product.initial_stock) || 1;
    const platformFee = parseFloat(product.platform_fee_percent) || 0;
    const shipping = parseFloat(product.shipping_cost) || 0;
    const marketing = parseFloat(product.marketing_cost) || 0;
    const minPrice = parseFloat(product.min_acceptable_price) || cost;
    const maxLoss = parseFloat(product.max_loss_percent) || 0;

    if (cost <= 0 || selling <= 0) {
      return { total: 0, breakdown: {}, ready: false, margin: '0', roi: '0' };
    }

    // 1. Profit Margin Score (0-25)
    const margin = ((selling - cost) / selling) * 100;
    const marginScore = margin >= 50 ? 25 : margin >= 30 ? 20 : margin >= 15 ? 15 : margin >= 5 ? 10 : margin > 0 ? 5 : 0;

    // 2. ROI Score (0-25)
    const platformFeeTotal = selling * stock * (platformFee / 100);
    const totalInvestment = (cost * stock) + (shipping * stock) + marketing + platformFeeTotal;
    const revenue = selling * stock;
    const netProfit = revenue - totalInvestment;
    const roi = totalInvestment > 0 ? (netProfit / totalInvestment) * 100 : 0;
    const roiScore = roi >= 100 ? 25 : roi >= 50 ? 20 : roi >= 25 ? 15 : roi >= 10 ? 10 : roi > 0 ? 5 : 0;

    // 3. Cost Efficiency (0-20)
    const overheadPerUnit = (platformFeeTotal / stock) + shipping + (marketing / stock);
    const overheadRatio = selling > 0 ? (overheadPerUnit / selling) * 100 : 100;
    const efficiencyScore = overheadRatio <= 10 ? 20 : overheadRatio <= 20 ? 16 : overheadRatio <= 35 ? 12 : overheadRatio <= 50 ? 8 : 4;

    // 4. Price Flexibility (0-15)
    const flexRange = selling - minPrice;
    const flexPercent = selling > 0 ? (flexRange / selling) * 100 : 0;
    const flexScore = flexPercent >= 30 ? 15 : flexPercent >= 20 ? 12 : flexPercent >= 10 ? 9 : flexPercent > 0 ? 5 : 2;

    // 5. Risk Assessment (0-15)
    const riskScore = maxLoss <= 0 ? 15 : maxLoss <= 5 ? 12 : maxLoss <= 10 ? 9 : maxLoss <= 20 ? 6 : 3;

    // Competitive market bonus (0-5) — only when AI analysis is available
    let compBonus = 0;
    if (competitiveData?.my_position) {
      const pva = competitiveData.my_position.price_vs_market_avg_percent;
      compBonus = pva <= -10 ? 5 : pva <= 0 ? 3 : pva <= 10 ? 1 : 0;
    }

    const total = Math.min(marginScore + roiScore + efficiencyScore + flexScore + riskScore + compBonus, 100);

    return {
      total,
      ready: true,
      margin: margin.toFixed(1),
      roi: roi.toFixed(1),
      breakdown: {
        margin:     { score: marginScore,     max: 25, label: 'Profit Margin' },
        roi:        { score: roiScore,        max: 25, label: 'Return on Investment' },
        efficiency: { score: efficiencyScore, max: 20, label: 'Cost Efficiency' },
        flexibility:{ score: flexScore,       max: 15, label: 'Price Flexibility' },
        risk:       { score: riskScore,       max: 15, label: 'Risk Control' },
        ...(competitiveData?.my_position
          ? { market: { score: compBonus, max: 5, label: 'Market Position' } }
          : {}),
      },
    };
  }, [product, competitiveData]);

  // ─── Handlers ─────────────────────────────────────────────────
  const handleProductChange = (field, value) => {
    setProduct(prev => ({ ...prev, [field]: value }));
  };

  const handleCalculate = async () => {
    const costPrice = parseFloat(product.cost_price);
    const sellingPrice = parseFloat(product.selling_price);
    const initialStock = parseInt(product.initial_stock);

    if (!costPrice || costPrice <= 0) {
      setError('Cost price must be greater than 0');
      return;
    }
    if (!sellingPrice || sellingPrice <= 0) {
      setError('Selling price must be greater than 0');
      return;
    }
    if (isNaN(initialStock) || initialStock < 0) {
      setError('Initial stock must be 0 or greater');
      return;
    }

    setLoading(true);
    setError(null);
    setAnalyticsData(null);
    setCompetitiveData(null);

    try {
      const payload = {
        product: {
          cost_price: costPrice,
          selling_price: sellingPrice,
          initial_stock: initialStock,
          platform_fee_percent: parseFloat(product.platform_fee_percent) || 0,
          shipping_cost: parseFloat(product.shipping_cost) || 0,
          marketing_cost: parseFloat(product.marketing_cost) || 0,
        },
        performance: {
          chats: 0,
          orders: 0,
          units_sold: 0,
          returns: 0,
        },
      };

      const result = await calculateAnalytics(payload);
      setAnalyticsData(result);
      setActiveTab('metrics');
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    } catch (err) {
      console.error('Analytics failed:', err);
      setError(err.message || 'Failed to calculate analytics');
    }
    setLoading(false);
  };

  const handleCompetitiveAnalysis = async () => {
    if (!product.selling_price || !product.product_name) {
      setError('Product name and selling price are required for competitive analysis');
      return;
    }
    setCompLoading(true);
    setError(null);
    try {
      const result = await getCompetitiveAnalysis({
        product_name: product.product_name.trim(),
        product_description: product.product_description.trim() || null,
        category: product.category || 'General',
        my_price: parseFloat(product.selling_price) || 0,
      });
      setCompetitiveData(result);
      setActiveTab('charts');
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    } catch (err) {
      console.error('Competitive analysis failed:', err);
      setError(err.message || 'Competitive analysis failed');
    }
    setCompLoading(false);
  };

  const handleReset = () => {
    setProduct(DEFAULT_PRODUCT);
    setAnalyticsData(null);
    setCompetitiveData(null);
    setError(null);
    setActiveTab('metrics');
    setFilter('all');
    setAddProductMsg(null);
  };

  // ─── Add to Products ──────────────────────────────────────────
  const handleAddToProducts = async () => {
    if (!getAuthToken()) {
      setError('Please log in first to add products');
      return;
    }
    const name = product.product_name?.trim();
    const basePrice = parseFloat(product.selling_price);
    const costPrice = parseFloat(product.cost_price);
    if (!name) { setError('Product name is required'); return; }
    if (!basePrice || basePrice <= 0) { setError('Selling price is required'); return; }
    if (!costPrice || costPrice <= 0) { setError('Cost price is required'); return; }
    if (costPrice >= basePrice) { setError('Cost price must be less than selling price'); return; }

    setAddingProduct(true);
    setError(null);
    setAddProductMsg(null);
    try {
      await createProduct({
        name,
        basePrice,
        costPrice,
        minAcceptablePrice: parseFloat(product.min_acceptable_price) || costPrice,
        maxLossPercent: parseFloat(product.max_loss_percent) || 0,
        mode: product.mode || 'MAX_PROFIT',
        maxRounds: parseInt(product.max_rounds) || 10,
        category: product.category || 'General',
      });
      setAddProductMsg({ type: 'success', text: `"${name}" added to your products!` });
      setTimeout(() => setAddProductMsg(null), 5000);
    } catch (err) {
      setError(err.message || 'Failed to add product');
    }
    setAddingProduct(false);
  };

  // ─── Filter insights ─────────────────────────────────────────
  const filteredInsights = analyticsData?.insights?.filter(i =>
    filter === 'all' ? true : i.severity === filter
  ) || [];

  // ─── Severity badge helper ────────────────────────────────────
  const getSeverityBadge = (severity) => {
    const style = severityStyles[severity] || severityStyles.info;
    const Icon = style.icon;
    return (
      <span className={`inline-flex items-center gap-1 px-1.5 sm:px-2 py-0.5 text-[10px] sm:text-xs font-bold border-[2px] ${style.bg} ${style.border} ${style.text}`}>
        <Icon className="w-3 h-3" />
        {severity.toUpperCase()}
      </span>
    );
  };

  // ─── Input field helper (defined outside component) ────────

  return (
    <Layout>
      <section className="min-h-screen bg-neo-cream py-3 sm:py-6 px-2 sm:px-6">
        <div className="max-w-7xl mx-auto">

          {/* ───── Header ────────────────────────────────────────── */}
          <div className="mb-4 sm:mb-8">
            <div className="bg-neo-navy p-3 sm:p-6 border-[3px] sm:border-[4px] border-neo-navy shadow-[4px_4px_0px_0px] sm:shadow-[8px_8px_0px_0px] shadow-neo-navy/30">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4">
                <div>
                  <span className="text-neo-orange font-bold text-[10px] sm:text-sm uppercase tracking-wide">
                    Product Analyzer
                  </span>
                  <h1 className="text-xl sm:text-3xl font-black text-neo-cream mt-0.5 sm:mt-1">
                    Analyze Product
                  </h1>
                  <p className="text-neo-cream/60 text-[10px] sm:text-sm mt-0.5 sm:mt-1">
                    Calculate metrics, run competitive analysis, and add products to your catalog
                  </p>
                </div>
                <div className="flex gap-1.5 sm:gap-3">
                  {backendHealthy !== null && (
                    <span className={`flex items-center gap-1 px-2 py-1 text-[10px] sm:text-xs font-bold border-[2px] ${
                      backendHealthy
                        ? 'bg-neo-teal/20 border-neo-teal text-neo-teal'
                        : 'bg-neo-maroon/20 border-neo-maroon text-neo-maroon'
                    }`}>
                      <span className={`w-2 h-2 rounded-full ${backendHealthy ? 'bg-neo-teal' : 'bg-neo-maroon'}`} />
                      {backendHealthy ? 'API Online' : 'API Offline'}
                    </span>
                  )}
                  <NeoButton
                    onClick={handleReset}
                    variant="orange"
                    className="!py-1 sm:!py-2 !px-2 sm:!px-4 !text-[10px] sm:!text-sm"
                  >
                    <RefreshCw className="w-3 h-3 sm:w-4 sm:h-4 mr-1" />
                    Reset
                  </NeoButton>
                </div>
              </div>
            </div>
          </div>

          {/* ───── Stats Bar ─────────────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4 mb-4 sm:mb-8">
            <NeoCard className="p-2 sm:p-4 text-center">
              <p className="text-[10px] sm:text-xs uppercase font-bold text-neo-navy/60">
                Gross Revenue
              </p>
              <p className="text-lg sm:text-2xl font-black text-neo-navy">{stats.revenue}</p>
            </NeoCard>
            <NeoCard className="p-2 sm:p-4 text-center">
              <p className="text-[10px] sm:text-xs uppercase font-bold text-neo-navy/60">
                Net Profit
              </p>
              <p className={`text-lg sm:text-2xl font-black ${
                analyticsData?.meta?.is_profitable ? 'text-neo-teal' : analyticsData ? 'text-neo-maroon' : 'text-neo-navy'
              }`}>
                {stats.profit}
              </p>
            </NeoCard>
            <NeoCard className="p-2 sm:p-4 text-center">
              <p className="text-[10px] sm:text-xs uppercase font-bold text-neo-navy/60">
                Profit Margin
              </p>
              <p className="text-lg sm:text-2xl font-black text-neo-orange">{stats.margin}</p>
            </NeoCard>
            <NeoCard className="p-2 sm:p-4 text-center">
              <p className="text-[10px] sm:text-xs uppercase font-bold text-neo-navy/60">
                Conversion Rate
              </p>
              <p className="text-lg sm:text-2xl font-black text-neo-teal">{stats.conversion}</p>
            </NeoCard>
          </div>

          {/* ───── Input Cards — 3 across ────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4 mb-4 sm:mb-6">

            {/* Product Info */}
            <NeoCard className="p-2 sm:p-4">
              <h3 className="font-bold text-neo-navy text-xs sm:text-sm uppercase mb-2 sm:mb-3 flex items-center gap-1.5">
                <Search className="w-4 h-4 text-neo-orange" />
                Product & Strategy
              </h3>
              <div className="space-y-2 sm:space-y-3">
                <InputField
                  label="Product Name"
                  value={product.product_name}
                  onChange={v => handleProductChange('product_name', v)}
                  icon={Package}
                  placeholder="e.g. Boat Airdopes 141"
                  type="text"
                />
                <div className="space-y-1">
                  <label className="text-[10px] sm:text-xs font-bold text-neo-navy/60 uppercase flex items-center gap-1">
                    <FileText className="w-3 h-3" />
                    Product Description
                  </label>
                  <textarea
                    value={product.product_description}
                    onChange={e => handleProductChange('product_description', e.target.value)}
                    placeholder="Describe key features, specs, USPs..."
                    rows={2}
                    className="w-full px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm bg-neo-cream border-[2px] border-neo-navy font-mono text-neo-navy focus:outline-none focus:border-neo-orange transition-colors resize-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] sm:text-xs font-bold text-neo-navy/60 uppercase flex items-center gap-1">
                    <Tag className="w-3 h-3" />
                    Category
                  </label>
                  <select
                    value={product.category}
                    onChange={e => handleProductChange('category', e.target.value)}
                    className="w-full px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm bg-neo-cream border-[2px] border-neo-navy font-mono text-neo-navy focus:outline-none focus:border-neo-orange transition-colors"
                  >
                    <option value="General">General</option>
                    <option value="Electronics">Electronics</option>
                    <option value="Fashion">Fashion</option>
                    <option value="Consumables">Consumables</option>
                    <option value="Services">Services</option>
                    <option value="Furniture">Furniture</option>
                    <option value="Software">Software</option>
                    <option value="Health">Health</option>
                  </select>
                </div>

                {/* Strategy Settings (merged from Negotiation Settings) */}
                <div className="pt-2 mt-2 border-t-[2px] border-neo-navy/10">
                  <p className="text-[10px] font-bold text-neo-navy/40 uppercase mb-2 flex items-center gap-1">
                    <Settings className="w-3 h-3" />
                    Strategy
                  </p>
                  <div className="space-y-2">
                    <div className="space-y-1">
                      <label className="text-[10px] sm:text-xs font-bold text-neo-navy/60 uppercase flex items-center gap-1">
                        <Zap className="w-3 h-3" />
                        Strategy Mode
                      </label>
                      <select
                        value={product.mode}
                        onChange={e => handleProductChange('mode', e.target.value)}
                        className="w-full px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm bg-neo-cream border-[2px] border-neo-navy font-mono text-neo-navy focus:outline-none focus:border-neo-orange transition-colors"
                      >
                        <option value="MAX_PROFIT">MAX PROFIT</option>
                        <option value="MIN_LOSS">MIN LOSS</option>
                      </select>
                    </div>
                    <InputField
                      label="Max Rounds"
                      value={product.max_rounds}
                      onChange={v => handleProductChange('max_rounds', v)}
                      icon={Activity}
                      placeholder="10"
                    />
                    <InputField
                      label="Max Loss %"
                      value={product.max_loss_percent}
                      onChange={v => handleProductChange('max_loss_percent', v)}
                      icon={Percent}
                      placeholder="0"
                    />
                  </div>
                </div>
              </div>
            </NeoCard>

            {/* Product Parameters */}
            <NeoCard className="p-2 sm:p-4">
              <h3 className="font-bold text-neo-navy text-xs sm:text-sm uppercase mb-2 sm:mb-3 flex items-center gap-1.5">
                <Package className="w-4 h-4 text-neo-orange" />
                Product Parameters
              </h3>
              <div className="space-y-2 sm:space-y-3">
                <InputField
                  label="Cost Price"
                  value={product.cost_price}
                  onChange={v => handleProductChange('cost_price', v)}
                  icon={IndianRupee}
                  placeholder="500"
                />
                <InputField
                  label="Selling Price (Base Price)"
                  value={product.selling_price}
                  onChange={v => handleProductChange('selling_price', v)}
                  icon={IndianRupee}
                  placeholder="999"
                />
                <InputField
                  label="Min Acceptable Price"
                  value={product.min_acceptable_price}
                  onChange={v => handleProductChange('min_acceptable_price', v)}
                  icon={IndianRupee}
                  placeholder="Defaults to cost price"
                />
                <InputField
                  label="Initial Stock"
                  value={product.initial_stock}
                  onChange={v => handleProductChange('initial_stock', v)}
                  icon={Package}
                  placeholder="100"
                />
                <InputField
                  label="Platform Fee %"
                  value={product.platform_fee_percent}
                  onChange={v => handleProductChange('platform_fee_percent', v)}
                  icon={Percent}
                  placeholder="10"
                />
                <InputField
                  label="Shipping / Unit"
                  value={product.shipping_cost}
                  onChange={v => handleProductChange('shipping_cost', v)}
                  icon={ShoppingCart}
                  placeholder="50"
                />
                <InputField
                  label="Marketing Spend"
                  value={product.marketing_cost}
                  onChange={v => handleProductChange('marketing_cost', v)}
                  icon={TrendingUp}
                  placeholder="5000"
                />
              </div>
            </NeoCard>

            {/* ─── Opportunity Score ──────────────────────────────── */}
            <NeoCard className="p-2 sm:p-4">
              <h3 className="font-bold text-neo-navy text-xs sm:text-sm uppercase mb-2 sm:mb-3 flex items-center gap-1.5">
                <Target className="w-4 h-4 text-neo-orange" />
                Opportunity Score
              </h3>

              {!opportunityScore.ready ? (
                <div className="flex items-center justify-center py-8 sm:py-12 text-neo-navy/30">
                  <div className="text-center">
                    <Target className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <p className="text-[10px] sm:text-xs">Enter cost & selling price</p>
                    <p className="text-[9px] text-neo-navy/20 mt-0.5">Score updates in real-time</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* SVG Semi-Circle Gauge */}
                  <div className="flex justify-center">
                    <div className="relative">
                      <svg viewBox="0 0 200 115" className="w-[160px] sm:w-[180px]">
                        {/* Background arc */}
                        <path
                          d="M 20 100 A 80 80 0 0 1 180 100"
                          fill="none"
                          stroke="#1a1a2e15"
                          strokeWidth="14"
                          strokeLinecap="round"
                        />
                        {/* Colored score arc */}
                        <path
                          d="M 20 100 A 80 80 0 0 1 180 100"
                          fill="none"
                          stroke={
                            opportunityScore.total > 75 ? '#2dd4a8'
                            : opportunityScore.total > 50 ? '#84cc16'
                            : opportunityScore.total > 25 ? '#f5a623'
                            : '#e74c5e'
                          }
                          strokeWidth="14"
                          strokeLinecap="round"
                          strokeDasharray={`${(opportunityScore.total / 100) * 251.3} 251.3`}
                          style={{ transition: 'stroke-dasharray 0.6s ease, stroke 0.4s ease' }}
                        />
                        {/* Score number */}
                        <text
                          x="100" y="78"
                          textAnchor="middle"
                          fill={
                            opportunityScore.total > 75 ? '#2dd4a8'
                            : opportunityScore.total > 50 ? '#84cc16'
                            : opportunityScore.total > 25 ? '#f5a623'
                            : '#e74c5e'
                          }
                          style={{ fontSize: '38px', fontWeight: 900, fontFamily: 'Space Grotesk, sans-serif' }}
                        >
                          {opportunityScore.total}
                        </text>
                        <text
                          x="100" y="97"
                          textAnchor="middle"
                          fill="#1a1a2e60"
                          style={{ fontSize: '11px', fontWeight: 700 }}
                        >
                          / 100
                        </text>
                      </svg>
                    </div>
                  </div>

                  {/* Score Label Badge */}
                  <div className="text-center">
                    <span className={`inline-block text-[10px] sm:text-xs font-black uppercase px-3 py-1 border-[2px] ${
                      opportunityScore.total > 75
                        ? 'bg-neo-teal/10 border-neo-teal text-neo-teal'
                        : opportunityScore.total > 50
                        ? 'bg-lime-100 border-lime-600 text-lime-700'
                        : opportunityScore.total > 25
                        ? 'bg-neo-orange/10 border-neo-orange text-neo-orange'
                        : 'bg-neo-maroon/10 border-neo-maroon text-neo-maroon'
                    }`}>
                      {opportunityScore.total > 80 ? 'Excellent'
                        : opportunityScore.total > 60 ? 'Good'
                        : opportunityScore.total > 40 ? 'Average'
                        : opportunityScore.total > 20 ? 'Below Avg'
                        : 'Poor'}
                    </span>
                  </div>

                  {/* Breakdown Bars */}
                  <div className="space-y-1.5 pt-1">
                    {Object.entries(opportunityScore.breakdown).map(([key, item]) => {
                      const pct = item.max > 0 ? (item.score / item.max) * 100 : 0;
                      return (
                        <div key={key}>
                          <div className="flex items-center justify-between text-[9px] sm:text-[10px] mb-0.5">
                            <span className="font-bold text-neo-navy/60 truncate">{item.label}</span>
                            <span className="font-mono text-neo-navy/40 ml-1 flex-shrink-0">
                              {item.score}/{item.max}
                            </span>
                          </div>
                          <div className="w-full h-1.5 bg-neo-navy/5 border border-neo-navy/10">
                            <div
                              className="h-full"
                              style={{
                                width: `${pct}%`,
                                backgroundColor: pct >= 70 ? '#2dd4a8' : pct >= 40 ? '#f5a623' : '#e74c5e',
                                transition: 'width 0.5s ease, background-color 0.4s ease',
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Key Metrics Inline */}
                  <div className="grid grid-cols-2 gap-1.5 pt-1">
                    <div className="p-1.5 bg-neo-navy text-center">
                      <p className="text-[8px] text-neo-cream/50 uppercase">Margin</p>
                      <p className="text-xs font-bold text-neo-cream">{opportunityScore.margin}%</p>
                    </div>
                    <div className="p-1.5 bg-neo-navy text-center">
                      <p className="text-[8px] text-neo-cream/50 uppercase">ROI</p>
                      <p className="text-xs font-bold text-neo-cream">{opportunityScore.roi}%</p>
                    </div>
                  </div>

                  {competitiveData && (
                    <div className="text-[9px] text-neo-navy/40 text-center flex items-center justify-center gap-1 pt-0.5">
                      <Sparkles className="w-3 h-3" />
                      Market intelligence factored in
                    </div>
                  )}
                </div>
              )}

              {/* ─── Add to Products Button (inside score card) ──── */}
              <div className="mt-3 pt-3 border-t-[2px] border-neo-navy/10">
                <button
                  onClick={handleAddToProducts}
                  disabled={addingProduct || !product.product_name || !product.selling_price || !product.cost_price}
                  className={`
                    w-full flex items-center justify-center gap-2 px-3 py-2.5 font-heading font-bold text-xs uppercase tracking-wide
                    border-[3px] border-neo-navy transition-all duration-150
                    ${addingProduct || !product.product_name || !product.selling_price || !product.cost_price
                      ? 'bg-neo-navy/10 text-neo-navy/30 cursor-not-allowed border-neo-navy/20'
                      : 'bg-neo-teal text-neo-navy shadow-neo hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none'
                    }
                  `}
                >
                  {addingProduct ? (
                    <>
                      <div className="w-4 h-4 border-2 border-neo-navy border-t-transparent rounded-full animate-spin" />
                      Adding...
                    </>
                  ) : (
                    <>
                      <PlusCircle className="w-4 h-4" />
                      Add to Products
                    </>
                  )}
                </button>
                {addProductMsg && (
                  <div className={`mt-2 p-2 text-[10px] font-bold flex items-center gap-1 border-[2px] ${
                    addProductMsg.type === 'success'
                      ? 'bg-neo-teal/10 border-neo-teal text-neo-teal'
                      : 'bg-neo-maroon/10 border-neo-maroon text-neo-maroon'
                  }`}>
                    {addProductMsg.type === 'success' ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                    <span className="flex-1">{addProductMsg.text}</span>
                    {addProductMsg.type === 'success' && (
                      <Link to="/products" className="underline hover:text-neo-navy ml-1">View →</Link>
                    )}
                  </div>
                )}
              </div>
            </NeoCard>
          </div>

          {/* ───── Action Buttons + Error ─────────────────────────── */}
          <div className="flex flex-col sm:flex-row gap-2 sm:gap-4 mb-4 sm:mb-6">
            <NeoButton
              onClick={handleCalculate}
              variant="teal"
              className="flex-1 !py-2.5 sm:!py-3 !text-xs sm:!text-sm"
              disabled={loading || !product.cost_price || !product.selling_price || !product.initial_stock || parseFloat(product.cost_price) <= 0 || parseFloat(product.selling_price) <= 0}
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-neo-cream border-t-transparent rounded-full animate-spin mr-2" />
                  Calculating...
                </>
              ) : (
                <>
                  <Calculator className="w-4 h-4 mr-2" />
                  Calculate Analytics
                </>
              )}
            </NeoButton>

            <NeoButton
              onClick={handleCompetitiveAnalysis}
              variant="orange"
              className="flex-1 !py-2.5 sm:!py-3 !text-xs sm:!text-sm"
              disabled={compLoading || !product.product_name || !product.selling_price}
            >
              {compLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-neo-navy border-t-transparent rounded-full animate-spin mr-2" />
                  Scraping & AI Analysis...
                </>
              ) : (
                <>
                  <Brain className="w-4 h-4 mr-2" />
                  Run AI Competitive Analysis
                </>
              )}
            </NeoButton>

          </div>

          {/* Error Display */}
          {error && (
            <div className="mb-4 sm:mb-6">
              <NeoCard variant="maroon" className="p-2 sm:p-3">
                <p className="text-neo-cream font-bold text-[10px] sm:text-xs flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  {error}
                </p>
              </NeoCard>
            </div>
          )}

          {/* ───── Results Panel (full width below) ──────────────── */}
          <div ref={resultsRef}>
            <NeoCard className="overflow-hidden">
              {/* Tab Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between bg-neo-navy/5 p-2 sm:p-4 border-b-[2px] sm:border-b-[3px] border-neo-navy">
                <div className="flex gap-1 mb-2 sm:mb-0">
                  {['metrics', 'charts', 'insights'].map(tab => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`px-2 sm:px-4 py-1 sm:py-2 text-[10px] sm:text-xs font-bold uppercase border-[2px] transition-all ${
                        activeTab === tab
                          ? 'bg-neo-navy text-neo-cream border-neo-navy'
                          : 'bg-neo-cream text-neo-navy border-neo-navy/30 hover:border-neo-navy'
                      }`}
                    >
                      {tab === 'metrics' && <BarChart3 className="w-3 h-3 sm:w-4 sm:h-4 inline mr-1" />}
                      {tab === 'charts' && <TrendingUp className="w-3 h-3 sm:w-4 sm:h-4 inline mr-1" />}
                      {tab === 'insights' && <Zap className="w-3 h-3 sm:w-4 sm:h-4 inline mr-1" />}
                      {tab.charAt(0).toUpperCase() + tab.slice(1)}
                    </button>
                  ))}
                </div>

                {/* Insight severity filter pills (only on insights tab) */}
                {activeTab === 'insights' && analyticsData && (
                  <div className="flex gap-1">
                    {['all', 'success', 'warning', 'critical'].map(f => (
                      <button
                        key={f}
                        onClick={() => setFilter(f)}
                        className={`px-2 py-0.5 sm:py-1 text-[10px] sm:text-xs font-bold border-[2px] transition-all ${
                          filter === f
                            ? 'bg-neo-orange text-neo-navy border-neo-orange'
                            : 'bg-neo-cream text-neo-navy/60 border-neo-navy/20 hover:border-neo-navy/40'
                        }`}
                      >
                        {f.charAt(0).toUpperCase() + f.slice(1)}
                      </button>
                    ))}
                  </div>
                )}
              </div>

                {/* Tab Content */}
                <div className="p-2 sm:p-4">
                  {!analyticsData ? (
                    <div className="h-40 sm:h-64 flex items-center justify-center text-neo-navy/40 border-[2px] sm:border-[3px] border-dashed border-neo-navy/30">
                      <div className="text-center">
                        <BarChart3 className="w-8 h-8 sm:w-10 sm:h-10 mx-auto mb-2 opacity-50" />
                        <p className="text-xs sm:text-sm">Enter your product data and hit Calculate</p>
                        <p className="text-[10px] sm:text-xs text-neo-navy/30 mt-1">Fill in the form above to get started</p>
                      </div>
                    </div>
                  ) : loading ? (
                    <div className="h-40 sm:h-64 flex items-center justify-center">
                      <div className="text-center">
                        <div className="w-10 h-10 sm:w-12 sm:h-12 border-3 sm:border-4 border-neo-teal border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                        <p className="text-neo-navy/60 text-xs sm:text-sm">Crunching numbers...</p>
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* ─── METRICS TAB ────────────────────────────── */}
                      {activeTab === 'metrics' && (
                        <div className="space-y-3 sm:space-y-4">

                          {/* Profit Status Banner */}
                          {analyticsData.meta.is_profitable && (
                            <div className="flex items-center gap-2 sm:gap-3 p-2 sm:p-3 bg-neo-teal/10 border-l-4 border-neo-teal">
                              <CheckCircle className="w-4 h-4 sm:w-5 sm:h-5 text-neo-teal flex-shrink-0" />
                              <p className="font-bold text-neo-teal text-xs sm:text-sm">
                                Your product is PROFITABLE — {analyticsData.summary_metrics.profit_status}
                              </p>
                            </div>
                          )}
                          {!analyticsData.meta.is_profitable && !analyticsData.meta.is_break_even && (
                            <div className="flex items-center gap-2 sm:gap-3 p-2 sm:p-3 bg-neo-maroon/10 border-l-4 border-neo-maroon">
                              <XCircle className="w-4 h-4 sm:w-5 sm:h-5 text-neo-maroon flex-shrink-0" />
                              <p className="font-bold text-neo-maroon text-xs sm:text-sm">
                                Your product is at a LOSS — review your pricing strategy
                              </p>
                            </div>
                          )}
                          {analyticsData.meta.is_break_even && (
                            <div className="flex items-center gap-2 sm:gap-3 p-2 sm:p-3 bg-neo-orange/10 border-l-4 border-neo-orange">
                              <AlertTriangle className="w-4 h-4 sm:w-5 sm:h-5 text-neo-orange flex-shrink-0" />
                              <p className="font-bold text-neo-orange text-xs sm:text-sm">
                                BREAK EVEN — no profit, no loss
                              </p>
                            </div>
                          )}

                          {/* Revenue & Cost Cards */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                            {/* Revenue Card */}
                            <NeoCard className="p-2 sm:p-4">
                              <p className="text-[10px] sm:text-xs uppercase font-bold text-neo-navy/60 mb-1 sm:mb-2 flex items-center gap-1 sm:gap-2">
                                <IndianRupee className="w-3 h-3 sm:w-4 sm:h-4" />
                                Revenue
                              </p>
                              <div className="space-y-1 sm:space-y-2">
                                <div className="flex items-center justify-between text-xs sm:text-sm">
                                  <span className="text-neo-navy/70">Gross Revenue</span>
                                  <span className="font-bold text-neo-navy">
                                    ₹{Number(analyticsData.summary_metrics.gross_revenue).toLocaleString()}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between text-xs sm:text-sm">
                                  <span className="text-neo-navy/70">Net Revenue</span>
                                  <span className="font-bold text-neo-teal">
                                    ₹{Number(analyticsData.summary_metrics.net_revenue).toLocaleString()}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between text-xs sm:text-sm">
                                  <span className="text-neo-navy/70">Effective Price</span>
                                  <span className="font-bold text-neo-navy">
                                    ₹{Number(analyticsData.summary_metrics.effective_selling_price).toLocaleString()}
                                  </span>
                                </div>
                              </div>
                            </NeoCard>

                            {/* Costs Card */}
                            <NeoCard className="p-2 sm:p-4">
                              <p className="text-[10px] sm:text-xs uppercase font-bold text-neo-navy/60 mb-1 sm:mb-2 flex items-center gap-1 sm:gap-2">
                                <TrendingDown className="w-3 h-3 sm:w-4 sm:h-4" />
                                Costs
                              </p>
                              <div className="space-y-1 sm:space-y-2">
                                <div className="flex items-center justify-between text-xs sm:text-sm">
                                  <span className="text-neo-navy/70">Product Cost</span>
                                  <span className="font-bold text-neo-maroon">
                                    ₹{Number(analyticsData.summary_metrics.product_cost).toLocaleString()}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between text-xs sm:text-sm">
                                  <span className="text-neo-navy/70">Platform Fee</span>
                                  <span className="font-bold text-neo-maroon">
                                    ₹{Number(analyticsData.summary_metrics.platform_fee).toLocaleString()}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between text-xs sm:text-sm">
                                  <span className="text-neo-navy/70">Shipping</span>
                                  <span className="font-bold text-neo-maroon">
                                    ₹{Number(analyticsData.summary_metrics.shipping_total).toLocaleString()}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between text-xs sm:text-sm">
                                  <span className="text-neo-navy/70">Marketing</span>
                                  <span className="font-bold text-neo-maroon">
                                    ₹{Number(analyticsData.summary_metrics.marketing_cost).toLocaleString()}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between text-xs sm:text-sm border-t border-neo-navy/10 pt-1">
                                  <span className="text-neo-navy font-bold">Total Cost</span>
                                  <span className="font-black text-neo-maroon">
                                    ₹{Number(analyticsData.summary_metrics.total_cost).toLocaleString()}
                                  </span>
                                </div>
                              </div>
                            </NeoCard>
                          </div>

                          {/* Quick Metrics — 4 metric cards */}
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
                            <div className="p-2 sm:p-3 bg-neo-navy text-center">
                              <p className="text-neo-cream/60 text-[8px] sm:text-[10px] uppercase">Profit / Unit</p>
                              <p className={`text-lg sm:text-2xl font-bold ${
                                Number(analyticsData.summary_metrics.profit_per_unit) >= 0 ? 'text-neo-teal' : 'text-neo-maroon'
                              }`}>
                                ₹{Number(analyticsData.summary_metrics.profit_per_unit).toFixed(0)}
                              </p>
                            </div>
                            <div className="p-2 sm:p-3 bg-neo-navy text-center">
                              <p className="text-neo-cream/60 text-[8px] sm:text-[10px] uppercase">Sell-Through</p>
                              <p className="text-neo-cream font-bold text-base sm:text-xl">
                                {Number(analyticsData.summary_metrics.sell_through_rate).toFixed(1)}%
                              </p>
                            </div>
                            <div className="p-2 sm:p-3 bg-neo-navy text-center">
                              <p className="text-neo-cream/60 text-[8px] sm:text-[10px] uppercase">Return Rate</p>
                              <p className="text-neo-orange font-bold text-base sm:text-xl">
                                {Number(analyticsData.summary_metrics.return_rate).toFixed(1)}%
                              </p>
                            </div>
                            <div className="p-2 sm:p-3 bg-neo-navy text-center">
                              <p className="text-neo-cream/60 text-[8px] sm:text-[10px] uppercase">ROI</p>
                              <p className="text-neo-teal font-bold text-base sm:text-xl">
                                {analyticsData.summary_metrics.roi != null
                                  ? `${Number(analyticsData.summary_metrics.roi).toFixed(1)}%`
                                  : 'N/A'}
                              </p>
                            </div>
                          </div>

                          {/* Inventory Status */}
                          <div className="p-3 sm:p-4 bg-neo-orange/10 border-[2px] border-neo-orange">
                            <p className="text-neo-navy/60 text-xs">Inventory</p>
                            <div className="flex items-center justify-between mt-1">
                              <span className="font-bold text-neo-navy text-lg sm:text-2xl">
                                {analyticsData.summary_metrics.remaining_stock} units remaining
                              </span>
                              <span className="text-neo-navy/60 text-xs sm:text-sm">
                                {analyticsData.summary_metrics.net_units_sold} sold (net)
                              </span>
                            </div>
                          </div>

                          {/* Warnings */}
                          {analyticsData.meta.warnings?.length > 0 && (
                            <div className="space-y-1">
                              {analyticsData.meta.warnings.map((w, i) => (
                                <div key={i} className="flex items-center gap-2 p-2 bg-neo-orange/10 border-l-4 border-neo-orange text-xs text-neo-navy/70">
                                  <AlertTriangle className="w-3 h-3 text-neo-orange flex-shrink-0" />
                                  {w}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* ─── CHARTS TAB ─────────────────────────────── */}
                      {activeTab === 'charts' && (
                        <div className="space-y-4">
                          <div className="flex items-center gap-2 mb-4">
                            <div className="w-8 h-8 bg-neo-orange flex items-center justify-center">
                              <BarChart3 className="w-5 h-5 text-neo-navy" />
                            </div>
                            <p className="font-bold text-neo-navy">Charts & Visualizations</p>
                          </div>

                          {/* Revenue Breakdown Bar Chart */}
                          <div>
                            <p className="text-[10px] sm:text-xs uppercase font-bold text-neo-navy/60 mb-2">
                              {analyticsData.charts.revenue_breakdown.title}
                            </p>
                            <NeoCard className="p-3 sm:p-4">
                              <div className="space-y-2">
                                {analyticsData.charts.revenue_breakdown.labels.map((label, i) => {
                                  const dataset = analyticsData.charts.revenue_breakdown.datasets[0];
                                  const value = dataset?.data?.[i] ?? 0;
                                  const absValues = (dataset?.data || [1]).map(v => Math.abs(Number(v)));
                                  const maxVal = Math.max(...absValues);
                                  const pct = maxVal > 0 ? (Math.abs(Number(value)) / maxVal) * 100 : 0;
                                  const color = dataset?.backgroundColor?.[i] || '#1a1a2e';
                                  return (
                                    <div key={label}>
                                      <div className="flex justify-between text-xs text-neo-navy/60 mb-1">
                                        <span className="font-bold">{label}</span>
                                        <span className="font-mono">₹{Number(value).toLocaleString()}</span>
                                      </div>
                                      <div className="w-full h-4 bg-neo-navy/10 border border-neo-navy/20">
                                        <div
                                          className="h-full transition-all"
                                          style={{ width: `${Math.max(pct, 2)}%`, backgroundColor: color }}
                                        />
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </NeoCard>
                          </div>

                          {/* Sales Funnel */}
                          <div>
                            <p className="text-[10px] sm:text-xs uppercase font-bold text-neo-navy/60 mb-2">
                              {analyticsData.charts.sales_funnel.title}
                            </p>
                            <NeoCard className="p-3 sm:p-4">
                              <div className="space-y-2">
                                {analyticsData.charts.sales_funnel.stages.map((stage, i) => (
                                  <div key={stage.stage} className="flex items-center gap-3">
                                    <div className="w-24 sm:w-32 text-xs font-bold text-neo-navy truncate">{stage.stage}</div>
                                    <div className="flex-1 h-6 bg-neo-navy/10 border border-neo-navy/20 relative overflow-hidden">
                                      <div
                                        className="h-full transition-all flex items-center justify-end pr-2"
                                        style={{
                                          width: `${Math.min(Math.max(Number(stage.percentage), 5), 100)}%`,
                                          backgroundColor: stage.color,
                                        }}
                                      >
                                        <span className="text-[10px] font-bold text-white drop-shadow">
                                          {stage.value}
                                        </span>
                                      </div>
                                    </div>
                                    <div className="w-12 text-right text-xs font-bold text-neo-navy/60">
                                      {Number(stage.percentage).toFixed(0)}%
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </NeoCard>
                          </div>

                          {/* Inventory Status Chart */}
                          <div>
                            <p className="text-[10px] sm:text-xs uppercase font-bold text-neo-navy/60 mb-2">
                              {analyticsData.charts.inventory_status.title}
                            </p>
                            <NeoCard className="p-3 sm:p-4">
                              <div className="grid grid-cols-3 gap-3">
                                {analyticsData.charts.inventory_status.segments.map(seg => (
                                  <div key={seg.label} className="text-center p-3 border-[2px] border-neo-navy">
                                    <p className="text-[10px] sm:text-xs text-neo-navy/60 uppercase font-bold">{seg.label}</p>
                                    <p className="text-xl sm:text-2xl font-black" style={{ color: seg.color || '#1a1a2e' }}>
                                      {Number(seg.value)}
                                    </p>
                                    <p className="text-[10px] text-neo-navy/40">
                                      {analyticsData.charts.inventory_status.total > 0
                                        ? `${((Number(seg.value) / analyticsData.charts.inventory_status.total) * 100).toFixed(1)}%`
                                        : '0%'}
                                    </p>
                                  </div>
                                ))}
                              </div>
                              <div className="mt-3 text-center text-xs text-neo-navy/50">
                                Total Stock: {analyticsData.charts.inventory_status.total}
                              </div>
                            </NeoCard>
                          </div>

                          {/* Cost Breakdown */}
                          <div>
                            <p className="text-[10px] sm:text-xs uppercase font-bold text-neo-navy/60 mb-2">Cost Breakdown</p>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                              {analyticsData.charts.cost_breakdown.map(cost => (
                                <div
                                  key={cost.label}
                                  className="p-3 bg-neo-navy text-center"
                                >
                                  <p className="text-neo-cream/60 text-[8px] sm:text-[10px] uppercase">{cost.label}</p>
                                  <p className="text-neo-cream font-bold text-sm sm:text-lg">
                                    ₹{Number(cost.value).toLocaleString()}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Competitive Analysis Results */}
                          {competitiveData && (
                            <div className="mt-4">
                              <p className="text-[10px] sm:text-xs uppercase font-bold text-neo-navy/60 mb-2 flex items-center gap-1">
                                <Brain className="w-3 h-3" />
                                Competitive Intelligence
                              </p>

                              {/* Market Position */}
                              <NeoCard className="p-3 sm:p-4 mb-3">
                                <p className="text-sm sm:text-base font-bold text-neo-navy/60 uppercase mb-2">Your Market Position</p>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                  <div className="p-2 bg-neo-navy text-center">
                                    <p className="text-neo-cream/60 text-[8px] uppercase">Position</p>
                                    <p className="text-neo-orange font-bold text-xs capitalize">
                                      {competitiveData.my_position.position.replace('_', ' ')}
                                    </p>
                                  </div>
                                  <div className="p-2 bg-neo-navy text-center">
                                    <p className="text-neo-cream/60 text-[8px] uppercase">vs Market Avg</p>
                                    <p className={`font-bold text-xs ${
                                      competitiveData.my_position.price_vs_market_avg_percent <= 0 ? 'text-neo-teal' : 'text-neo-maroon'
                                    }`}>
                                      {competitiveData.my_position.price_vs_market_avg_percent > 0 ? '+' : ''}
                                      {competitiveData.my_position.price_vs_market_avg_percent.toFixed(1)}%
                                    </p>
                                  </div>
                                  <div className="p-2 bg-neo-navy text-center">
                                    <p className="text-neo-cream/60 text-[8px] uppercase">Rank</p>
                                    <p className="text-neo-cream font-bold text-xs">
                                      {competitiveData.my_position.rank_estimate}
                                    </p>
                                  </div>
                                  <div className="p-2 bg-neo-navy text-center">
                                    <p className="text-neo-cream/60 text-[8px] uppercase">Competitors</p>
                                    <p className="text-neo-cream font-bold text-xs">
                                      {competitiveData.meta.competitor_count}
                                    </p>
                                  </div>
                                </div>
                              </NeoCard>

                              {/* Market Summary */}
                              <NeoCard className="p-3 sm:p-4 mb-3">
                                <p className="text-sm sm:text-base font-bold text-neo-navy/60 uppercase mb-2">Market Prices</p>
                                <div className="grid grid-cols-4 gap-2">
                                  <div className="text-center">
                                    <p className="text-[8px] text-neo-navy/50 uppercase">Min</p>
                                    <p className="font-bold text-neo-teal text-sm">₹{competitiveData.market_summary.min_price}</p>
                                  </div>
                                  <div className="text-center">
                                    <p className="text-[8px] text-neo-navy/50 uppercase">Avg</p>
                                    <p className="font-bold text-neo-navy text-sm">₹{competitiveData.market_summary.avg_market_price.toFixed(0)}</p>
                                  </div>
                                  <div className="text-center">
                                    <p className="text-[8px] text-neo-navy/50 uppercase">Median</p>
                                    <p className="font-bold text-neo-navy text-sm">₹{competitiveData.market_summary.median_price}</p>
                                  </div>
                                  <div className="text-center">
                                    <p className="text-[8px] text-neo-navy/50 uppercase">Max</p>
                                    <p className="font-bold text-neo-maroon text-sm">₹{competitiveData.market_summary.max_price}</p>
                                  </div>
                                </div>
                              </NeoCard>

                              {/* Competitor Samples */}
                              {competitiveData.competitor_sample?.length > 0 && (
                                <NeoCard className="p-3 sm:p-4">
                                  <p className="text-sm sm:text-base font-bold text-neo-navy/60 uppercase mb-2">Top Competitors</p>
                                  <div className="space-y-2">
                                    {competitiveData.competitor_sample.map((comp, i) => (
                                      <div key={i} className="flex items-center justify-between p-2 border-[2px] border-neo-navy/10 hover:border-neo-navy/30 transition-all">
                                        <div className="flex-1 min-w-0">
                                          <p className="text-xs font-bold text-neo-navy truncate">{comp.title}</p>
                                          <p className="text-[10px] text-neo-navy/50">
                                            {comp.rating && `★ ${comp.rating}`}
                                            {comp.review_count && ` (${comp.review_count} reviews)`}
                                          </p>
                                        </div>
                                        <div className="text-right ml-2">
                                          <p className="font-bold text-sm text-neo-navy">₹{comp.price}</p>
                                          <p className={`text-[10px] font-bold ${
                                            comp.price_vs_mine < 0 ? 'text-neo-teal' : comp.price_vs_mine > 0 ? 'text-neo-maroon' : 'text-neo-navy/50'
                                          }`}>
                                            {comp.price_vs_mine > 0 ? '+' : ''}{comp.price_vs_mine.toFixed(1)}%
                                          </p>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </NeoCard>
                              )}

                              {/* ─── AI-Powered Deep Analysis ─────────────── */}
                              {competitiveData.llm_analysis && (
                                <div className="mt-4 space-y-3">
                                  <div className="flex items-center gap-2">
                                    <div className="w-8 h-8 bg-neo-orange flex items-center justify-center">
                                      <Sparkles className="w-5 h-5 text-neo-navy" />
                                    </div>
                                    <div>
                                      <p className="text-base sm:text-lg font-bold text-neo-navy">AI Deep Analysis</p>
                                      <p className="text-[10px] text-neo-navy/50">Powered by Gemini</p>
                                    </div>
                                  </div>

                                  {/* Executive Summary */}
                                  {competitiveData.llm_analysis.executive_summary && (
                                    <NeoCard className="p-3 sm:p-4 border-l-4 border-neo-orange">
                                      <p className="text-[10px] sm:text-xs uppercase font-bold text-neo-navy/60 mb-1 flex items-center gap-1">
                                        <FileText className="w-3 h-3" />
                                        Executive Summary
                                      </p>
                                      <p className="text-xs sm:text-sm text-neo-navy leading-relaxed">
                                        {competitiveData.llm_analysis.executive_summary}
                                      </p>
                                    </NeoCard>
                                  )}

                                  {/* Pricing Strategy + Recommended Price */}
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    {competitiveData.llm_analysis.pricing_strategy && (
                                      <NeoCard className="p-3 sm:p-4">
                                        <p className="text-[10px] sm:text-xs uppercase font-bold text-neo-navy/60 mb-1 flex items-center gap-1">
                                          <Target className="w-3 h-3" />
                                          Pricing Strategy
                                        </p>
                                        <p className="text-xs sm:text-sm text-neo-navy">
                                          {competitiveData.llm_analysis.pricing_strategy}
                                        </p>
                                      </NeoCard>
                                    )}
                                    {competitiveData.llm_analysis.recommended_price != null && (
                                      <NeoCard className="p-3 sm:p-4 bg-neo-teal/10 border-[2px] border-neo-teal">
                                        <p className="text-[10px] sm:text-xs uppercase font-bold text-neo-teal mb-1 flex items-center gap-1">
                                          <IndianRupee className="w-3 h-3" />
                                          AI Recommended Price
                                        </p>
                                        <p className="text-2xl sm:text-3xl font-black text-neo-teal">
                                          ₹{Number(competitiveData.llm_analysis.recommended_price).toLocaleString()}
                                        </p>
                                        <p className="text-[10px] text-neo-navy/50 mt-1">
                                          {(() => {
                                            const diff = ((competitiveData.llm_analysis.recommended_price - competitiveData.my_position.price_difference - competitiveData.market_summary.avg_market_price) / (competitiveData.my_position.price_difference + competitiveData.market_summary.avg_market_price) * 100);
                                            return !isNaN(diff) ? `Based on market data & AI analysis` : '';
                                          })()}
                                        </p>
                                      </NeoCard>
                                    )}
                                  </div>

                                  {/* SWOT Grid */}
                                  {(competitiveData.llm_analysis.strengths?.length > 0 || competitiveData.llm_analysis.weaknesses?.length > 0 || competitiveData.llm_analysis.opportunities?.length > 0 || competitiveData.llm_analysis.threats?.length > 0) && (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                      {/* Strengths */}
                                      {competitiveData.llm_analysis.strengths?.length > 0 && (
                                        <NeoCard className="p-3 border-l-4 border-neo-teal">
                                          <p className="text-[10px] uppercase font-bold text-neo-teal mb-2 flex items-center gap-1">
                                            <CheckCircle className="w-3 h-3" /> Strengths
                                          </p>
                                          <ul className="space-y-1">
                                            {competitiveData.llm_analysis.strengths.map((s, i) => (
                                              <li key={i} className="text-[11px] sm:text-xs text-neo-navy flex items-start gap-1.5">
                                                <span className="text-neo-teal mt-0.5">▸</span> {s}
                                              </li>
                                            ))}
                                          </ul>
                                        </NeoCard>
                                      )}
                                      {/* Weaknesses */}
                                      {competitiveData.llm_analysis.weaknesses?.length > 0 && (
                                        <NeoCard className="p-3 border-l-4 border-neo-maroon">
                                          <p className="text-[10px] uppercase font-bold text-neo-maroon mb-2 flex items-center gap-1">
                                            <XCircle className="w-3 h-3" /> Weaknesses
                                          </p>
                                          <ul className="space-y-1">
                                            {competitiveData.llm_analysis.weaknesses.map((w, i) => (
                                              <li key={i} className="text-[11px] sm:text-xs text-neo-navy flex items-start gap-1.5">
                                                <span className="text-neo-maroon mt-0.5">▸</span> {w}
                                              </li>
                                            ))}
                                          </ul>
                                        </NeoCard>
                                      )}
                                      {/* Opportunities */}
                                      {competitiveData.llm_analysis.opportunities?.length > 0 && (
                                        <NeoCard className="p-3 border-l-4 border-neo-orange">
                                          <p className="text-[10px] uppercase font-bold text-neo-orange mb-2 flex items-center gap-1">
                                            <Lightbulb className="w-3 h-3" /> Opportunities
                                          </p>
                                          <ul className="space-y-1">
                                            {competitiveData.llm_analysis.opportunities.map((o, i) => (
                                              <li key={i} className="text-[11px] sm:text-xs text-neo-navy flex items-start gap-1.5">
                                                <span className="text-neo-orange mt-0.5">▸</span> {o}
                                              </li>
                                            ))}
                                          </ul>
                                        </NeoCard>
                                      )}
                                      {/* Threats */}
                                      {competitiveData.llm_analysis.threats?.length > 0 && (
                                        <NeoCard className="p-3 border-l-4 border-neo-navy">
                                          <p className="text-[10px] uppercase font-bold text-neo-navy mb-2 flex items-center gap-1">
                                            <Shield className="w-3 h-3" /> Threats
                                          </p>
                                          <ul className="space-y-1">
                                            {competitiveData.llm_analysis.threats.map((th, i) => (
                                              <li key={i} className="text-[11px] sm:text-xs text-neo-navy flex items-start gap-1.5">
                                                <span className="text-neo-navy mt-0.5">▸</span> {th}
                                              </li>
                                            ))}
                                          </ul>
                                        </NeoCard>
                                      )}
                                    </div>
                                  )}

                                  {/* Action Items */}
                                  {competitiveData.llm_analysis.action_items?.length > 0 && (
                                    <NeoCard className="p-3 sm:p-4 bg-neo-navy">
                                      <p className="text-[10px] sm:text-xs uppercase font-bold text-neo-orange mb-2 flex items-center gap-1">
                                        <Zap className="w-3 h-3" /> Action Items
                                      </p>
                                      <ol className="space-y-1.5">
                                        {competitiveData.llm_analysis.action_items.map((a, i) => (
                                          <li key={i} className="text-[11px] sm:text-xs text-neo-cream flex items-start gap-2">
                                            <span className="bg-neo-orange text-neo-navy font-black text-[10px] w-5 h-5 flex items-center justify-center flex-shrink-0">
                                              {i + 1}
                                            </span>
                                            {a}
                                          </li>
                                        ))}
                                      </ol>
                                    </NeoCard>
                                  )}

                                  {/* Market Analysis Paragraph */}
                                  {competitiveData.llm_analysis.market_analysis && (
                                    <NeoCard className="p-3 sm:p-4">
                                      <p className="text-[10px] sm:text-xs uppercase font-bold text-neo-navy/60 mb-1 flex items-center gap-1">
                                        <Brain className="w-3 h-3" />
                                        Detailed Market Analysis
                                      </p>
                                      <p className="text-xs sm:text-sm text-neo-navy/80 leading-relaxed whitespace-pre-line">
                                        {competitiveData.llm_analysis.market_analysis}
                                      </p>
                                    </NeoCard>
                                  )}

                                  {/* Data Sources Footer */}
                                  <div className="flex items-center gap-2 text-[10px] text-neo-navy/40">
                                    <Info className="w-3 h-3" />
                                    <span>
                                      Sources: {competitiveData.meta?.sources_used?.join(', ') || 'N/A'}
                                      {' · '}
                                      {competitiveData.meta?.competitor_count || 0} competitors analyzed
                                      {competitiveData.meta?.llm_analysis_available && ' · AI analysis included'}
                                    </span>
                                  </div>
                                </div>
                              )}

                              {/* Fallback if no LLM analysis */}
                              {!competitiveData.llm_analysis && competitiveData.meta && (
                                <div className="mt-3 p-3 bg-neo-navy/5 border-[2px] border-dashed border-neo-navy/20">
                                  <p className="text-[10px] sm:text-xs text-neo-navy/50 flex items-center gap-1">
                                    <Info className="w-3 h-3" />
                                    AI deep analysis was not available for this query. Rule-based insights are shown in the Insights tab.
                                  </p>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {/* ─── INSIGHTS TAB ───────────────────────────── */}
                      {activeTab === 'insights' && (
                        <div className="space-y-4">
                          <div className="flex items-center gap-2 mb-4">
                            <div className="w-8 h-8 bg-neo-orange flex items-center justify-center">
                              <Zap className="w-5 h-5 text-neo-navy" />
                            </div>
                            <p className="font-bold text-neo-navy">Business Insights</p>
                            <span className="ml-auto text-[10px] sm:text-xs text-neo-navy/50">
                              {filteredInsights.length} insight{filteredInsights.length !== 1 ? 's' : ''}
                            </span>
                          </div>

                          {filteredInsights.length === 0 ? (
                            <div className="h-32 flex items-center justify-center text-neo-navy/40 border-[2px] border-dashed border-neo-navy/30">
                              <p className="text-xs sm:text-sm">No insights match this filter</p>
                            </div>
                          ) : (
                            <div className="space-y-2">
                              {filteredInsights.map((insight, i) => {
                                const style = severityStyles[insight.severity] || severityStyles.info;
                                const Icon = style.icon;
                                return (
                                  <div
                                    key={i}
                                    className={`p-3 sm:p-4 border-l-4 ${style.bg} ${style.border}`}
                                  >
                                    <div className="flex items-start gap-2">
                                      <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${style.text}`} />
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                          {getSeverityBadge(insight.severity)}
                                          <span className="text-[10px] sm:text-xs text-neo-navy/40 uppercase font-bold">
                                            {insight.category}
                                          </span>
                                        </div>
                                        <p className="text-xs sm:text-sm text-neo-navy">{insight.message}</p>
                                        {(insight.metric_value != null || insight.threshold != null) && (
                                          <div className="flex gap-3 mt-1.5 text-[10px] text-neo-navy/50">
                                            {insight.metric_value != null && (
                                              <span>Value: <strong>{Number(insight.metric_value).toFixed(1)}</strong></span>
                                            )}
                                            {insight.threshold != null && (
                                              <span>Threshold: <strong>{Number(insight.threshold).toFixed(1)}</strong></span>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {/* Competitive Insights */}
                          {competitiveData?.insights?.length > 0 && (
                            <div className="mt-6">
                              <p className="text-[10px] sm:text-xs uppercase font-bold text-neo-navy/60 mb-2 flex items-center gap-1">
                                <Brain className="w-3 h-3" />
                                Competitive Insights
                              </p>
                              <div className="space-y-2">
                                {competitiveData.insights.map((insight, i) => {
                                  const sev = insight.severity === 'opportunity' ? 'success' : insight.severity;
                                  const style = severityStyles[sev] || severityStyles.info;
                                  const Icon = style.icon;
                                  return (
                                    <div key={i} className={`p-3 border-l-4 ${style.bg} ${style.border}`}>
                                      <div className="flex items-start gap-2">
                                        <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${style.text}`} />
                                        <div>
                                          <span className="text-[10px] text-neo-navy/40 uppercase font-bold">{insight.category}</span>
                                          <p className="text-xs sm:text-sm text-neo-navy">{insight.message}</p>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </NeoCard>
            </div>
        </div>
      </section>
    </Layout>
  );
}
