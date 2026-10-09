import { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Code, Copy, Check, ChevronRight, ChevronDown, Zap, Shield, Brain,
  BarChart3, Target, MessageSquare, Activity, ArrowRight, Search,
  BookOpen, Terminal, Layers, TrendingUp, IndianRupee, Package,
  Users, Sparkles, ExternalLink, Play, Lock, Clock
} from 'lucide-react';
import Layout from '../components/Layout';
import NeoCard from '../components/NeoCard';
import NeoButton from '../components/NeoButton';

// ─── Code Block Component ──────────────────────────────────────
function CodeBlock({ code, language = 'json', title }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="border-[3px] border-neo-navy overflow-hidden">
      {title && (
        <div className="bg-neo-navy px-4 py-2 flex items-center justify-between">
          <span className="text-neo-cream/70 text-xs font-mono uppercase">{title}</span>
          <div className="flex items-center gap-2">
            <span className="text-neo-orange text-xs font-mono">{language}</span>
            <button
              onClick={handleCopy}
              className="text-neo-cream/50 hover:text-neo-orange transition-colors"
            >
              {copied ? <Check className="w-4 h-4 text-neo-teal" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
        </div>
      )}
      <pre className="bg-[#0a1929] p-4 overflow-x-auto text-sm leading-relaxed">
        <code className="text-neo-cream/90 font-mono whitespace-pre">{code}</code>
      </pre>
    </div>
  );
}

// ─── Method Badge ──────────────────────────────────────────────
function MethodBadge({ method }) {
  const styles = {
    GET: 'bg-neo-teal text-neo-cream',
    POST: 'bg-neo-orange text-neo-navy',
    DELETE: 'bg-neo-maroon text-neo-cream',
    PUT: 'bg-[#3b82f6] text-white',
  };
  return (
    <span className={`px-3 py-1 text-xs font-mono font-bold uppercase border-[2px] border-neo-navy ${styles[method] || 'bg-neo-cream text-neo-navy'}`}>
      {method}
    </span>
  );
}

// ─── Endpoint Card ─────────────────────────────────────────────
function EndpointCard({ method, path, title, description, requestBody, responseBody, rateLimit, children }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <NeoCard className="overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-4 sm:p-5 flex items-start sm:items-center gap-3 sm:gap-4 text-left hover:bg-neo-navy/5 transition-colors"
      >
        <MethodBadge method={method} />
        <div className="flex-1 min-w-0">
          <p className="font-mono font-bold text-neo-navy text-sm sm:text-base break-all">{path}</p>
          <p className="text-neo-navy/60 text-xs sm:text-sm mt-0.5">{title}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {rateLimit && (
            <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-mono text-neo-navy/40 border border-neo-navy/20 px-2 py-0.5">
              <Clock className="w-3 h-3" />{rateLimit}
            </span>
          )}
          {expanded ? <ChevronDown className="w-5 h-5 text-neo-navy/40" /> : <ChevronRight className="w-5 h-5 text-neo-navy/40" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t-[3px] border-neo-navy p-4 sm:p-5 space-y-4 bg-neo-cream/50">
          <p className="text-sm text-neo-navy/70 leading-relaxed">{description}</p>
          {requestBody && (
            <div>
              <p className="text-xs uppercase font-bold text-neo-navy/50 mb-2 flex items-center gap-1">
                <ArrowRight className="w-3 h-3" /> Request Body
              </p>
              <CodeBlock code={requestBody} language="json" title="Request" />
            </div>
          )}
          {responseBody && (
            <div>
              <p className="text-xs uppercase font-bold text-neo-navy/50 mb-2 flex items-center gap-1">
                <ChevronRight className="w-3 h-3" /> Response
              </p>
              <CodeBlock code={responseBody} language="json" title="Response · 200 OK" />
            </div>
          )}
          {children}
        </div>
      )}
    </NeoCard>
  );
}

// ─── Feature Card ──────────────────────────────────────────────
function FeatureCard({ icon: Icon, title, description, color = 'bg-neo-teal' }) {
  return (
    <NeoCard hover className="p-5 sm:p-6">
      <div className={`w-10 h-10 sm:w-12 sm:h-12 ${color} flex items-center justify-center mb-3 border-[2px] border-neo-navy`}>
        <Icon className="w-5 h-5 sm:w-6 sm:h-6 text-neo-cream" />
      </div>
      <h3 className="font-heading font-bold text-neo-navy text-base sm:text-lg mb-1">{title}</h3>
      <p className="text-neo-navy/60 text-sm leading-relaxed">{description}</p>
    </NeoCard>
  );
}

// =================================================================
// MAIN COMPONENT
// =================================================================
export default function ApiReference() {
  const [activeSection, setActiveSection] = useState('overview');
  const [searchQuery, setSearchQuery] = useState('');
  const sectionRefs = useRef({});

  const sections = [
    { id: 'overview', label: 'Overview', icon: BookOpen },
    { id: 'negotiation', label: 'Negotiation', icon: MessageSquare },
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
    { id: 'competitive', label: 'Competitive Intel', icon: Brain },
    { id: 'quickstart', label: 'Quick Start', icon: Zap },
  ];

  const scrollToSection = (id) => {
    setActiveSection(id);
    const el = sectionRefs.current[id];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // ─── Endpoint Data ─────────────────────────────────────────
  const negotiationEndpoints = [
    {
      method: 'POST',
      path: '/api/v1/negotiate/sessions',
      title: 'Create Negotiation Session',
      rateLimit: '20/min',
      description: 'Initialize a new AI-powered negotiation session. Define the product, cost basis, pricing strategy, and inventory constraints. The engine returns a session ID and an initial offer to present to the buyer.',
      requestBody: `{
  "product_name": "Premium Wireless Earbuds",
  "asking_price": 2999,
  "cost_basis": 1200,
  "max_discount_percent": 25,
  "strategy_mode": "max_profit",
  "inventory_count": 150,
  "urgency": "medium",
  "buyer_info": {
    "name": "Retail Buyer",
    "type": "b2b"
  }
}`,
      responseBody: `{
  "session_id": "a1b2c3d4-e5f6-...",
  "initial_offer": {
    "price": 2999,
    "message": "Welcome! Our Premium Wireless Earbuds are priced at ₹2,999...",
    "strategy": "max_profit"
  },
  "constraints": {
    "floor_price": 2249,
    "max_discount_percent": 25
  }
}`,
    },
    {
      method: 'POST',
      path: '/api/v1/negotiate/sessions/{session_id}/chat',
      title: 'Send Chat Message',
      rateLimit: '30/min',
      description: 'Send a free-text message in natural language. The AI understands greetings, questions, price offers, and discount requests. If a price is detected, it processes a negotiation turn automatically.',
      requestBody: `{
  "message": "Can you do ₹2,200 for bulk order of 50 units?",
  "role": "buyer"
}`,
      responseBody: `{
  "message": "I appreciate the bulk interest! For 50 units, I can offer ₹2,549 per unit — that's a 15% discount.",
  "offer_price": 2549,
  "decision": "counter",
  "turn_number": 2,
  "session_state": "active"
}`,
    },
    {
      method: 'POST',
      path: '/api/v1/negotiate/sessions/{session_id}/turns',
      title: 'Submit Buyer Offer',
      rateLimit: '30/min',
      description: 'Submit a structured price offer from the buyer. The engine evaluates it against profit constraints, computes the optimal counter-offer, and generates a natural language response.',
      requestBody: `{
  "offered_price": 2200,
  "quantity": 50,
  "message": "This is our final budget"
}`,
      responseBody: `{
  "decision": "counter",
  "counter_price": 2399,
  "message": "I understand your budget. My best offer is ₹2,399...",
  "profit_margin": 49.9,
  "concession_percent": 8.3,
  "turn_number": 3
}`,
    },
    {
      method: 'GET',
      path: '/api/v1/negotiate/sessions/{session_id}',
      title: 'Get Session Status',
      rateLimit: '60/min',
      description: 'Retrieve the current state of a negotiation session including pricing history, turn count, and session status.',
      responseBody: `{
  "session_id": "a1b2c3d4-e5f6-...",
  "status": "active",
  "current_price": 2399,
  "turns_completed": 3,
  "strategy_mode": "max_profit",
  "created_at": "2026-02-07T12:00:00Z"
}`,
    },
    {
      method: 'GET',
      path: '/api/v1/negotiate/sessions/{session_id}/analytics',
      title: 'Get Session Analytics',
      rateLimit: '30/min',
      description: 'Get detailed analytics for a completed or in-progress session. Includes price journey, concession analysis, efficiency metrics, and profit calculations.',
      responseBody: `{
  "price_journey": [2999, 2549, 2399],
  "total_concession_percent": 20.0,
  "profit_margin": 49.9,
  "turns_to_deal": 3,
  "efficiency_score": 85
}`,
    },
    {
      method: 'DELETE',
      path: '/api/v1/negotiate/sessions/{session_id}',
      title: 'End Session',
      rateLimit: '30/min',
      description: 'Terminate a negotiation session. Use when the buyer walks away or you want to end manually. Returns the final session summary.',
      responseBody: `{
  "session_id": "a1b2c3d4-e5f6-...",
  "status": "ended",
  "reason": "buyer_walked",
  "final_price": null,
  "total_turns": 3
}`,
    },
  ];

  const analyticsEndpoints = [
    {
      method: 'POST',
      path: '/api/v1/analytics/calculate',
      title: 'Calculate Business Analytics',
      description: 'Stateless analytics engine. Send product parameters and performance signals, receive comprehensive business metrics, pre-formatted chart data, and AI-generated insights — all in one call.',
      requestBody: `{
  "product": {
    "cost_price": 500,
    "selling_price": 999,
    "initial_stock": 500,
    "platform_fee_percent": 15,
    "shipping_cost_per_unit": 45,
    "marketing_cost": 5000
  },
  "performance": {
    "chats": 200,
    "orders": 150,
    "units_sold": 320,
    "returns": 12
  }
}`,
      responseBody: `{
  "summary_metrics": {
    "gross_revenue": 319680,
    "net_revenue": 307692,
    "profit_or_loss": 119392,
    "profit_margin_percent": 38.8,
    "conversion_rate": 75.0,
    "sell_through_rate": 61.6,
    "return_rate": 3.75,
    "roi": 2287.8,
    "profit_per_unit": 387.6
  },
  "charts": {
    "revenue_breakdown": { "...": "Bar chart data" },
    "sales_funnel": { "...": "Funnel stages" },
    "inventory_status": { "...": "Stock segments" },
    "cost_breakdown": [ "..." ]
  },
  "insights": [
    {
      "message": "Strong profitability at 38.8% margin",
      "severity": "positive",
      "category": "profit"
    }
  ],
  "meta": {
    "is_profitable": true,
    "has_marketing_data": true,
    "warnings": []
  }
}`,
    },
    {
      method: 'POST',
      path: '/api/v1/analytics/simulate',
      title: 'Simulate What-If Scenario',
      description: 'Identical to /calculate but semantically marked as a hypothetical scenario. Test different pricing strategies, discount levels, or inventory assumptions before committing.',
      requestBody: `// Same schema as /calculate
{
  "product": { "selling_price": 899, "..." },
  "performance": { "..." }
}`,
      responseBody: `// Same response schema
// Compare results against your baseline`,
    },
    {
      method: 'GET',
      path: '/api/v1/analytics/health',
      title: 'Analytics Health Check',
      description: 'Verify the analytics service is operational.',
      responseBody: `{
  "status": "healthy",
  "service": "analytics-engine"
}`,
    },
    {
      method: 'GET',
      path: '/api/v1/analytics/schema',
      title: 'Get Input Schema',
      description: 'Returns the full JSON Schema of the analytics request model. Useful for building dynamic forms or validating payloads client-side.',
      responseBody: `{
  "title": "AnalyticsRequest",
  "type": "object",
  "properties": { "..." },
  "required": ["product", "performance"]
}`,
    },
  ];

  const competitiveEndpoints = [
    {
      method: 'POST',
      path: '/api/v1/analytics/competitive-analysis',
      title: 'Run Competitive Analysis',
      description: 'Scrapes live competitor listings from Amazon & Flipkart, normalizes pricing data, computes your market position, generates rule-based insights, and performs deep AI analysis using Google Gemini — all in one call.',
      requestBody: `{
  "product_name": "Boat Airdopes 141 Wireless Earbuds",
  "product_description": "Bluetooth 5.0, 42H playtime, IPX4",
  "category": "Electronics",
  "my_price": 1299
}`,
      responseBody: `{
  "market_summary": {
    "avg_market_price": 1456.50,
    "min_price": 399,
    "max_price": 3999,
    "median_price": 1199,
    "competitor_count": 12
  },
  "my_position": {
    "position": "below_average",
    "price_vs_market_avg_percent": -10.8,
    "rank_estimate": 5
  },
  "competitor_sample": [
    {
      "name": "boAt Airdopes 131",
      "price": 999,
      "rating": 4.1,
      "source": "amazon"
    }
  ],
  "insights": [
    {
      "message": "Your price is 10.8% below market average",
      "severity": "info"
    }
  ],
  "llm_analysis": {
    "summary": "Strong competitive position...",
    "swot": { "strengths": ["..."], "..." },
    "recommended_price": 1399,
    "action_items": ["..."]
  },
  "meta": {
    "competitor_count": 12,
    "sources_used": ["amazon", "flipkart"],
    "llm_analysis_available": true
  }
}`,
    },
    {
      method: 'GET',
      path: '/api/v1/analytics/competitive-analysis/health',
      title: 'Competitive Intel Health Check',
      description: 'Verify the competitive intelligence module is operational.',
      responseBody: `{
  "status": "healthy",
  "module": "competitive_intelligence",
  "version": "1.0.0"
}`,
    },
  ];

  // Filter endpoints by search
  const filterEndpoints = (endpoints) => {
    if (!searchQuery) return endpoints;
    const q = searchQuery.toLowerCase();
    return endpoints.filter(e =>
      e.path.toLowerCase().includes(q) ||
      e.title.toLowerCase().includes(q) ||
      e.description.toLowerCase().includes(q)
    );
  };

  return (
    <Layout>
      {/* ─── HERO ─────────────────────────────────────────────── */}
      <section className="bg-neo-navy py-12 sm:py-20 border-b-[4px] border-neo-navy relative overflow-hidden">
        {/* Background decoration */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-10 left-10 w-40 h-40 border-[4px] border-neo-teal rotate-12" />
          <div className="absolute bottom-10 right-20 w-32 h-32 border-[4px] border-neo-orange -rotate-6" />
          <div className="absolute top-1/2 left-1/3 w-20 h-20 bg-neo-teal rotate-45" />
        </div>

        <div className="container mx-auto px-4 relative z-10">
          <div className="max-w-4xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-neo-teal/20 border-[2px] border-neo-teal text-neo-teal font-bold text-xs uppercase mb-6">
              <Code className="w-4 h-4" />
              Developer Documentation
            </div>

            <h1 className="text-4xl sm:text-5xl md:text-7xl font-heading font-bold text-neo-cream mb-4 leading-tight">
              TRADE<span className="text-neo-orange">MIND</span> API
            </h1>

            <p className="text-lg sm:text-xl text-neo-cream/70 max-w-2xl mx-auto mb-8 leading-relaxed">
              Build profit-aware negotiation experiences into any application.
              Three powerful engines — one unified API.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-10">
              <div className="flex items-center gap-2 px-4 py-2 bg-neo-navy border-[2px] border-neo-cream/20 font-mono text-neo-cream/80 text-sm">
                <Terminal className="w-4 h-4 text-neo-orange" />
                Base URL: <span className="text-neo-orange">http://localhost:8000</span>
              </div>
              <div className="flex items-center gap-2 px-3 py-2 bg-neo-teal/20 border-[2px] border-neo-teal/40 text-neo-teal text-xs font-bold uppercase">
                <Shield className="w-4 h-4" />
                Rate Limited
              </div>
            </div>

            {/* Search */}
            <div className="max-w-lg mx-auto relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-neo-navy/40" />
              <input
                type="text"
                placeholder="Search endpoints... e.g. /sessions, /calculate, /competitive"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-12 pr-4 py-3 bg-neo-cream border-[3px] border-neo-navy text-neo-navy font-mono text-sm placeholder:text-neo-navy/30 focus:outline-none focus:border-neo-orange transition-colors"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ─── FEATURE HIGHLIGHTS ───────────────────────────────── */}
      <section className="bg-neo-cream border-b-[4px] border-neo-navy py-10 sm:py-14">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 max-w-6xl mx-auto">
            <FeatureCard
              icon={Brain}
              title="AI Negotiation"
              description="Multi-agent architecture with context analysis, deterministic pricing, and natural language responses."
              color="bg-neo-teal"
            />
            <FeatureCard
              icon={BarChart3}
              title="Business Analytics"
              description="Stateless calculation engine with revenue metrics, interactive charts, and rule-based insights."
              color="bg-neo-orange"
            />
            <FeatureCard
              icon={Target}
              title="Competitive Intel"
              description="Live market scraping from Amazon & Flipkart with Google Gemini-powered deep analysis."
              color="bg-neo-maroon"
            />
            <FeatureCard
              icon={Shield}
              title="Enterprise Ready"
              description="Rate limiting, CORS, structured error handling, and Pydantic-validated schemas throughout."
              color="bg-neo-navy"
            />
          </div>
        </div>
      </section>

      {/* ─── MAIN CONTENT ─────────────────────────────────────── */}
      <section className="bg-neo-cream py-8 sm:py-12">
        <div className="container mx-auto px-4">
          <div className="max-w-6xl mx-auto flex flex-col lg:flex-row gap-6 lg:gap-8">

            {/* Sidebar Navigation */}
            <aside className="lg:w-56 flex-shrink-0">
              <div className="lg:sticky lg:top-4 flex lg:flex-col gap-2 overflow-x-auto lg:overflow-x-visible pb-2 lg:pb-0">
                {sections.map((s) => {
                  const Icon = s.icon;
                  return (
                    <button
                      key={s.id}
                      onClick={() => scrollToSection(s.id)}
                      className={`flex items-center gap-2 px-4 py-2.5 text-sm font-bold uppercase tracking-wide border-[2px] border-neo-navy transition-all whitespace-nowrap ${
                        activeSection === s.id
                          ? 'bg-neo-navy text-neo-cream'
                          : 'bg-neo-cream text-neo-navy hover:bg-neo-orange hover:translate-x-[1px] hover:translate-y-[1px]'
                      }`}
                    >
                      <Icon className="w-4 h-4 flex-shrink-0" />
                      {s.label}
                    </button>
                  );
                })}
              </div>
            </aside>

            {/* Content */}
            <main className="flex-1 min-w-0 space-y-12">

              {/* ─── OVERVIEW ────────────────────────────────── */}
              <div ref={el => sectionRefs.current['overview'] = el}>
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 bg-neo-navy flex items-center justify-center">
                    <BookOpen className="w-5 h-5 text-neo-cream" />
                  </div>
                  <div>
                    <h2 className="text-2xl sm:text-3xl font-heading font-bold text-neo-navy">Overview</h2>
                    <p className="text-neo-navy/50 text-sm">Architecture & authentication</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <NeoCard className="p-5 sm:p-6">
                    <h3 className="font-heading font-bold text-lg text-neo-navy mb-3 flex items-center gap-2">
                      <Layers className="w-5 h-5 text-neo-teal" />
                      Multi-Agent Architecture
                    </h3>
                    <p className="text-neo-navy/70 text-sm leading-relaxed mb-4">
                      Peitho uses a three-agent pipeline for every negotiation turn. No single LLM call makes pricing decisions — 
                      the pricing agent is fully deterministic and auditable.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {[
                        { num: '01', name: 'Context Agent', desc: 'Analyzes buyer intent, urgency signals, and market context', color: 'border-neo-teal' },
                        { num: '02', name: 'Pricing Agent', desc: 'Rule-based, deterministic — computes optimal price with zero LLM dependency', color: 'border-neo-orange' },
                        { num: '03', name: 'Conversation Agent', desc: 'Generates natural, persuasive responses using the pricing decision', color: 'border-neo-maroon' },
                      ].map((agent) => (
                        <div key={agent.num} className={`p-4 border-[3px] ${agent.color} border-neo-navy bg-neo-cream`}>
                          <span className="text-3xl font-heading font-bold text-neo-navy/10">{agent.num}</span>
                          <p className="font-bold text-neo-navy text-sm mt-1">{agent.name}</p>
                          <p className="text-neo-navy/50 text-xs mt-1 leading-relaxed">{agent.desc}</p>
                        </div>
                      ))}
                    </div>
                  </NeoCard>

                  <NeoCard className="p-5 sm:p-6">
                    <h3 className="font-heading font-bold text-lg text-neo-navy mb-3 flex items-center gap-2">
                      <Shield className="w-5 h-5 text-neo-teal" />
                      Authentication & Rate Limiting
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="p-4 bg-neo-navy/5 border-[2px] border-neo-navy/20">
                        <p className="text-xs uppercase font-bold text-neo-navy/50 mb-1">Headers</p>
                        <code className="text-sm font-mono text-neo-navy">Content-Type: application/json</code>
                      </div>
                      <div className="p-4 bg-neo-navy/5 border-[2px] border-neo-navy/20">
                        <p className="text-xs uppercase font-bold text-neo-navy/50 mb-1">Rate Limits</p>
                        <p className="text-sm text-neo-navy">20–120 req/min per endpoint</p>
                      </div>
                    </div>
                    <div className="mt-4">
                      <p className="text-xs uppercase font-bold text-neo-navy/50 mb-2">Error Response Format</p>
                      <CodeBlock
                        title="Error · 422 Validation Error"
                        language="json"
                        code={`{
  "detail": [
    {
      "loc": ["body", "product", "cost_price"],
      "msg": "Input should be greater than 0",
      "type": "greater_than"
    }
  ]
}`}
                      />
                    </div>
                  </NeoCard>

                  {/* Strategy Modes */}
                  <NeoCard className="p-5 sm:p-6">
                    <h3 className="font-heading font-bold text-lg text-neo-navy mb-3 flex items-center gap-2">
                      <Target className="w-5 h-5 text-neo-orange" />
                      Strategy Modes
                    </h3>
                    <p className="text-neo-navy/70 text-sm mb-4">
                      Two built-in strategies govern how the engine prices and concedes during negotiation.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="p-4 bg-neo-teal/10 border-[3px] border-neo-teal">
                        <p className="font-heading font-bold text-neo-teal uppercase text-sm">MAX_PROFIT</p>
                        <p className="text-neo-navy/60 text-xs mt-2 leading-relaxed">
                          Conservative concessions. Maximizes seller profit with small, strategic price reductions only when buyer pressure justifies it.
                        </p>
                      </div>
                      <div className="p-4 bg-neo-orange/10 border-[3px] border-neo-orange">
                        <p className="font-heading font-bold text-neo-orange uppercase text-sm">MIN_LOSS</p>
                        <p className="text-neo-navy/60 text-xs mt-2 leading-relaxed">
                          When profit isn't achievable, minimizes losses by finding the least harmful deal rather than walking away empty-handed.
                        </p>
                      </div>
                    </div>
                  </NeoCard>
                </div>
              </div>

              {/* ─── NEGOTIATION API ─────────────────────────── */}
              <div ref={el => sectionRefs.current['negotiation'] = el}>
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 bg-neo-teal flex items-center justify-center">
                    <MessageSquare className="w-5 h-5 text-neo-cream" />
                  </div>
                  <div>
                    <h2 className="text-2xl sm:text-3xl font-heading font-bold text-neo-navy">Negotiation Engine</h2>
                    <p className="text-neo-navy/50 text-sm">Session-based AI-powered price negotiations</p>
                  </div>
                </div>

                <div className="space-y-3">
                  {filterEndpoints(negotiationEndpoints).map((ep, i) => (
                    <EndpointCard key={i} {...ep} />
                  ))}
                  {filterEndpoints(negotiationEndpoints).length === 0 && (
                    <p className="text-neo-navy/40 text-sm py-4 text-center">No matching endpoints</p>
                  )}
                </div>
              </div>

              {/* ─── ANALYTICS API ───────────────────────────── */}
              <div ref={el => sectionRefs.current['analytics'] = el}>
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 bg-neo-orange flex items-center justify-center">
                    <BarChart3 className="w-5 h-5 text-neo-navy" />
                  </div>
                  <div>
                    <h2 className="text-2xl sm:text-3xl font-heading font-bold text-neo-navy">Business Analytics</h2>
                    <p className="text-neo-navy/50 text-sm">Stateless metrics, charts & insights engine</p>
                  </div>
                </div>

                <div className="space-y-3">
                  {filterEndpoints(analyticsEndpoints).map((ep, i) => (
                    <EndpointCard key={i} {...ep} />
                  ))}
                  {filterEndpoints(analyticsEndpoints).length === 0 && (
                    <p className="text-neo-navy/40 text-sm py-4 text-center">No matching endpoints</p>
                  )}
                </div>
              </div>

              {/* ─── COMPETITIVE INTEL API ────────────────────── */}
              <div ref={el => sectionRefs.current['competitive'] = el}>
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 bg-neo-maroon flex items-center justify-center">
                    <Brain className="w-5 h-5 text-neo-cream" />
                  </div>
                  <div>
                    <h2 className="text-2xl sm:text-3xl font-heading font-bold text-neo-navy">Competitive Intelligence</h2>
                    <p className="text-neo-navy/50 text-sm">Live market scraping + Gemini AI analysis</p>
                  </div>
                </div>

                <NeoCard className="p-4 mb-4 bg-neo-teal/5 border-neo-teal">
                  <div className="flex items-start gap-3">
                    <Sparkles className="w-5 h-5 text-neo-teal flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold text-neo-navy text-sm">Powered by Google Gemini</p>
                      <p className="text-neo-navy/60 text-xs mt-1 leading-relaxed">
                        The competitive analysis pipeline scrapes live product listings, then passes normalized data to Google Gemini 2.0 Flash
                        for SWOT analysis, pricing strategy recommendations, and actionable insights. If the LLM is unavailable, rule-based insights are returned as fallback.
                      </p>
                    </div>
                  </div>
                </NeoCard>

                <div className="space-y-3">
                  {filterEndpoints(competitiveEndpoints).map((ep, i) => (
                    <EndpointCard key={i} {...ep} />
                  ))}
                  {filterEndpoints(competitiveEndpoints).length === 0 && (
                    <p className="text-neo-navy/40 text-sm py-4 text-center">No matching endpoints</p>
                  )}
                </div>
              </div>

              {/* ─── QUICK START ──────────────────────────────── */}
              <div ref={el => sectionRefs.current['quickstart'] = el}>
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 bg-neo-orange flex items-center justify-center">
                    <Zap className="w-5 h-5 text-neo-navy" />
                  </div>
                  <div>
                    <h2 className="text-2xl sm:text-3xl font-heading font-bold text-neo-navy">Quick Start</h2>
                    <p className="text-neo-navy/50 text-sm">Get up and running in under 2 minutes</p>
                  </div>
                </div>

                <div className="space-y-4">
                  {/* Step 1 */}
                  <NeoCard className="p-5 sm:p-6">
                    <div className="flex items-center gap-3 mb-3">
                      <span className="w-8 h-8 bg-neo-teal flex items-center justify-center text-neo-cream font-bold text-sm border-[2px] border-neo-navy">1</span>
                      <h3 className="font-heading font-bold text-neo-navy">Start a Negotiation</h3>
                    </div>
                    <p className="text-neo-navy/60 text-sm mb-3">
                      Create a session with your product details and strategy. The AI generates an opening offer automatically.
                    </p>
                    <CodeBlock
                      title="cURL"
                      language="bash"
                      code={`curl -X POST http://localhost:8000/api/v1/negotiate/sessions \\
  -H "Content-Type: application/json" \\
  -d '{
    "product_name": "Wireless Earbuds Pro",
    "asking_price": 2999,
    "cost_basis": 1200,
    "max_discount_percent": 20,
    "strategy_mode": "max_profit"
  }'`}
                    />
                  </NeoCard>

                  {/* Step 2 */}
                  <NeoCard className="p-5 sm:p-6">
                    <div className="flex items-center gap-3 mb-3">
                      <span className="w-8 h-8 bg-neo-orange flex items-center justify-center text-neo-navy font-bold text-sm border-[2px] border-neo-navy">2</span>
                      <h3 className="font-heading font-bold text-neo-navy">Chat with the AI</h3>
                    </div>
                    <p className="text-neo-navy/60 text-sm mb-3">
                      Send buyer messages in natural language. The AI handles intent detection, price extraction, and strategic responses.
                    </p>
                    <CodeBlock
                      title="cURL"
                      language="bash"
                      code={`curl -X POST http://localhost:8000/api/v1/negotiate/sessions/{SESSION_ID}/chat \\
  -H "Content-Type: application/json" \\
  -d '{ "message": "Can you do 2200?", "role": "buyer" }'`}
                    />
                  </NeoCard>

                  {/* Step 3 */}
                  <NeoCard className="p-5 sm:p-6">
                    <div className="flex items-center gap-3 mb-3">
                      <span className="w-8 h-8 bg-neo-maroon flex items-center justify-center text-neo-cream font-bold text-sm border-[2px] border-neo-navy">3</span>
                      <h3 className="font-heading font-bold text-neo-navy">Analyze Your Business</h3>
                    </div>
                    <p className="text-neo-navy/60 text-sm mb-3">
                      Feed in your sales data and get instant analytics with charts, insights, and competitive intelligence.
                    </p>
                    <CodeBlock
                      title="cURL"
                      language="bash"
                      code={`curl -X POST http://localhost:8000/api/v1/analytics/calculate \\
  -H "Content-Type: application/json" \\
  -d '{
    "product": {
      "cost_price": 500, "selling_price": 999,
      "initial_stock": 500, "platform_fee_percent": 15,
      "shipping_cost_per_unit": 45, "marketing_cost": 5000
    },
    "performance": {
      "chats": 200, "orders": 150,
      "units_sold": 320, "returns": 12
    }
  }'`}
                    />
                  </NeoCard>
                </div>
              </div>

              {/* ─── CTA ─────────────────────────────────────── */}
              <NeoCard variant="navy" className="p-6 sm:p-10 text-center">
                <h2 className="text-2xl sm:text-3xl font-heading font-bold text-neo-cream mb-3">
                  Ready to Build?
                </h2>
                <p className="text-neo-cream/60 text-sm sm:text-base mb-6 max-w-md mx-auto">
                  Start integrating Peitho's negotiation AI and analytics engine into your product today.
                </p>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                  <Link to="/authority">
                    <NeoButton variant="orange" size="lg">
                      <BarChart3 className="w-5 h-5 mr-2" />
                      Try Analytics
                      <ArrowRight className="w-5 h-5 ml-2" />
                    </NeoButton>
                  </Link>
                  <Link to="/reporter">
                    <NeoButton variant="teal" size="lg">
                      <MessageSquare className="w-5 h-5 mr-2" />
                      Try Negotiation
                    </NeoButton>
                  </Link>
                </div>
              </NeoCard>

            </main>
          </div>
        </div>
      </section>
    </Layout>
  );
}
