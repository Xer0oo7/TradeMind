import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Mic,
  MicOff,
  Radio,
  PhoneOff,
  Copy,
  Check,
  TrendingUp,
  Shield,
  Volume2,
  VolumeX,
  Sparkles,
  Layers,
  ArrowLeft,
  ExternalLink,
  Info,
  HelpCircle,
  Activity,
  Send,
  Zap,
} from 'lucide-react';
import { usePeithoCall } from './usePeithoCall';

const TranscriptItem = React.memo(function TranscriptItem({ t }) {
  const isSeller = t.channel === 'SELLER';
  return (
    <div className={`flex flex-col ${isSeller ? 'items-end' : 'items-start'}`}>
      <div className="flex items-center gap-1.5 mb-1 px-1">
        <span
          className={`text-[10px] font-heading font-black px-1.5 py-0.2 rounded border border-neo-navy ${
            isSeller
              ? 'bg-neo-teal text-neo-cream'
              : 'bg-neo-orange text-neo-navy'
          }`}
        >
          {isSeller ? 'YOU (SELLER)' : 'BUYER'}
        </span>
        <span className="text-[10px] text-neo-navy/50 font-mono">
          {new Date(t.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </span>
      </div>

      <div
        className={`max-w-[85%] p-3 border-2 border-neo-navy font-medium text-sm leading-relaxed shadow-[2px_2px_0px_#001524] ${
          isSeller
            ? 'bg-neo-cream text-neo-navy rounded-tl-lg rounded-bl-lg rounded-tr-xs'
            : 'bg-white text-neo-navy rounded-tr-lg rounded-br-lg rounded-tl-xs'
        }`}
      >
        {t.text}
      </div>
    </div>
  );
});

export default function PeithoPage() {
  const navigate = useNavigate();
  const {
    status,
    sessionId,
    error,
    sttProvider,
    sellerStatus,
    sellerReason,
    buyerStatus,
    buyerReason,
    sellerEnergy,
    buyerEnergy,
    isMicMuted,
    toggleMicMute,
    transcripts,
    partialSellerText,
    partialBuyerText,
    advisory,
    currentCounter,
    currentRound,
    language,
    setLanguage,
    startCall,
    endCall,
    sendTypedLine,
  } = usePeithoCall();

  // Pre-call form parameters
  const [config, setConfig] = useState({
    product_name: 'High-Performance Cloud Compute Cluster',
    base_price: 500,
    cost_price: 250,
    min_floor: 320,
    mode: 'MAX_PROFIT',
    max_rounds: 6,
    quantity: 1,
    available_inventory: 50,
    reference_inventory: 50,
    buyer_archetype: 'UNKNOWN',
  });

  // Typed manual input state
  const [typedSpeaker, setTypedSpeaker] = useState('BUYER');
  const [typedText, setTypedText] = useState('');
  const [copiedIndex, setCopiedIndex] = useState(null);
  const [showMeetHelp, setShowMeetHelp] = useState(false);

  const transcriptEndRef = useRef(null);

  // Auto-scroll transcript feed
  useEffect(() => {
    if (transcriptEndRef.current) {
      transcriptEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [transcripts, partialSellerText, partialBuyerText]);

  const handleCopyReply = (text, index) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const handleSendManual = (e) => {
    e.preventDefault();
    if (!typedText.trim()) return;
    sendTypedLine(typedSpeaker, typedText.trim());
    setTypedText('');
  };

  const isCallActive = status === 'active';

  return (
    <div className="min-h-screen bg-neo-cream text-neo-navy flex flex-col font-body">
      {/* ── TOP HEADER ── */}
      <header className="border-b-[3px] border-neo-navy bg-neo-cream sticky top-0 z-40 px-4 sm:px-8 py-3.5 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="p-1.5 border-2 border-neo-navy hover:bg-neo-orange/20 transition-all rounded-sm flex items-center gap-1 text-xs font-bold font-heading uppercase"
            title="Return to Home"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Home</span>
          </button>

          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-neo-orange border-2 border-neo-navy animate-pulse" />
            <h1 className="text-xl sm:text-2xl font-heading font-black tracking-tight flex items-center gap-1.5">
              PEITHO <span className="text-neo-teal text-sm font-semibold tracking-normal hidden md:inline">Meet Assistant</span>
            </h1>
          </div>
        </div>

        {/* Live Status Indicators */}
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 px-3 py-1 bg-neo-cream border-2 border-neo-navy rounded text-xs font-heading font-bold shadow-[2px_2px_0px_#001524]">
            <Radio className={`w-3.5 h-3.5 ${isCallActive ? 'text-neo-orange animate-pulse' : 'text-neo-navy/40'}`} />
            <span>{isCallActive ? 'LIVE SESSION' : 'OFFLINE'}</span>
          </div>

          <button
            onClick={() => setShowMeetHelp(true)}
            className="p-1.5 border-2 border-neo-navy bg-neo-teal text-neo-cream hover:bg-neo-teal/90 transition-all rounded text-xs font-heading font-bold flex items-center gap-1 shadow-[2px_2px_0px_#001524]"
            title="Google Meet Audio Instructions"
          >
            <HelpCircle className="w-4 h-4" />
            <span className="hidden md:inline">Meet Audio Setup</span>
          </button>
        </div>
      </header>

      {/* ── GOOGLE MEET SETUP MODAL ── */}
      {showMeetHelp && (
        <div className="fixed inset-0 bg-neo-navy/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-neo-cream border-[3px] border-neo-navy max-w-lg w-full p-6 shadow-neo-lg animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b-2 border-neo-navy mb-4">
              <h2 className="text-xl font-heading font-black text-neo-navy flex items-center gap-2">
                <ExternalLink className="w-5 h-5 text-neo-orange" />
                Google Meet Setup Guide
              </h2>
              <button
                onClick={() => setShowMeetHelp(false)}
                className="w-7 h-7 border-2 border-neo-navy font-bold flex items-center justify-center hover:bg-neo-orange/20"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3.5 text-sm text-neo-navy/90 mb-6">
              <div className="flex gap-3 items-start">
                <span className="w-6 h-6 rounded-full bg-neo-orange border-2 border-neo-navy text-neo-navy font-black flex items-center justify-center text-xs shrink-0">1</span>
                <p>Open your <strong>Google Meet call</strong> in a Chrome browser tab.</p>
              </div>
              <div className="flex gap-3 items-start">
                <span className="w-6 h-6 rounded-full bg-neo-orange border-2 border-neo-navy text-neo-navy font-black flex items-center justify-center text-xs shrink-0">2</span>
                <p>Click <strong>"Start Peitho Live"</strong> below. Your browser will prompt for permissions.</p>
              </div>
              <div className="flex gap-3 items-start">
                <span className="w-6 h-6 rounded-full bg-neo-orange border-2 border-neo-navy text-neo-navy font-black flex items-center justify-center text-xs shrink-0">3</span>
                <div>
                  <p>When the screen share prompt appears:</p>
                  <ul className="list-disc pl-5 mt-1 space-y-1 font-medium text-xs bg-neo-teal/10 p-2.5 border-2 border-neo-teal/40 rounded">
                    <li>Select the <strong>"Chrome Tab"</strong> tab.</li>
                    <li>Select your <strong>Google Meet tab</strong>.</li>
                    <li><strong>Crucial:</strong> Ensure <strong>"Also share tab audio"</strong> toggle is checked at the bottom!</li>
                  </ul>
                </div>
              </div>
              <div className="flex gap-3 items-start">
                <span className="w-6 h-6 rounded-full bg-neo-orange border-2 border-neo-navy text-neo-navy font-black flex items-center justify-center text-xs shrink-0">4</span>
                <p>Peitho will automatically isolate the buyer's voice from the tab and your voice from your microphone!</p>
              </div>
            </div>

            <button
              onClick={() => setShowMeetHelp(false)}
              className="w-full neo-btn neo-btn-orange py-2.5 text-sm"
            >
              Got It, Let's Go
            </button>
          </div>
        </div>
      )}

      {/* ── ERROR BANNER ── */}
      {error && (
        <div className="bg-neo-maroon text-neo-cream px-4 py-2 text-sm font-semibold flex items-center justify-between border-b-2 border-neo-navy">
          <span>⚠️ {error}</span>
          <button onClick={() => {}} className="text-xs uppercase underline">Dismiss</button>
        </div>
      )}

      {/* ── PRE-CALL SETUP / LAUNCH SCREEN ── */}
      {!isCallActive && (
        <main className="flex-1 max-w-4xl mx-auto w-full p-4 sm:p-8 flex flex-col justify-center">
          <div className="neo-card p-6 sm:p-8 relative overflow-hidden">
            <div className="absolute top-0 right-0 bg-neo-teal text-neo-cream text-xs font-heading font-black px-4 py-1 border-b-2 border-l-2 border-neo-navy uppercase tracking-wider">
              PRANE-X Advisory Engine
            </div>

            <div className="mb-6">
              <h2 className="text-2xl sm:text-3xl font-heading font-black text-neo-navy mb-2">
                Configure Meet Assistant
              </h2>
              <p className="text-sm text-neo-navy/70">
                Set your product parameters and margin targets. Peitho runs the PRANE-X negotiation engine in advisory mode to calculate counter-offers and prompt tactical responses in real time.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
              <div>
                <label className="block text-xs font-heading font-bold uppercase mb-1">Product Name</label>
                <input
                  type="text"
                  value={config.product_name}
                  onChange={(e) => setConfig({ ...config, product_name: e.target.value })}
                  className="w-full px-3 py-2 border-2 border-neo-navy bg-white font-medium text-sm focus:outline-hidden focus:ring-2 focus:ring-neo-orange"
                />
              </div>

              <div>
                <label className="block text-xs font-heading font-bold uppercase mb-1">Negotiation Mode</label>
                <select
                  value={config.mode}
                  onChange={(e) => setConfig({ ...config, mode: e.target.value })}
                  className="w-full px-3 py-2 border-2 border-neo-navy bg-white font-medium text-sm focus:outline-hidden"
                >
                  <option value="MAX_PROFIT">MAX_PROFIT (Conservative Concessions)</option>
                  <option value="MIN_LOSS">MIN_LOSS (Volume / Inventory Liquidation)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-heading font-bold uppercase mb-1">Asking / Base Price ($)</label>
                <input
                  type="number"
                  value={config.base_price}
                  onChange={(e) => setConfig({ ...config, base_price: parseFloat(e.target.value) || 0 })}
                  className="w-full px-3 py-2 border-2 border-neo-navy bg-white font-medium text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-heading font-bold uppercase mb-1">Cost Price ($)</label>
                <input
                  type="number"
                  value={config.cost_price}
                  onChange={(e) => setConfig({ ...config, cost_price: parseFloat(e.target.value) || 0 })}
                  className="w-full px-3 py-2 border-2 border-neo-navy bg-white font-medium text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-heading font-bold uppercase mb-1">Absolute Minimum Floor ($)</label>
                <input
                  type="number"
                  value={config.min_floor}
                  onChange={(e) => setConfig({ ...config, min_floor: parseFloat(e.target.value) || 0 })}
                  className="w-full px-3 py-2 border-2 border-neo-navy bg-white font-medium text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-heading font-bold uppercase mb-1">Deal Quantity</label>
                <input
                  type="number"
                  min="1"
                  value={config.quantity}
                  onChange={(e) => setConfig({ ...config, quantity: parseInt(e.target.value, 10) || 1 })}
                  className="w-full px-3 py-2 border-2 border-neo-navy bg-white font-medium text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-heading font-bold uppercase mb-1">STT Language & Code-Switching</label>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="w-full px-3 py-2 border-2 border-neo-navy bg-white font-medium text-sm"
                >
                  <option value="en">English (Default)</option>
                  <option value="hi">Hindi (हिन्दी)</option>
                  <option value="auto">Multilingual / Auto (Code-Switching)</option>
                </select>
              </div>
            </div>

            {/* Quick Info Box */}
            <div className="bg-neo-teal/10 border-2 border-neo-teal p-3.5 mb-6 rounded text-xs flex items-center gap-2.5">
              <Info className="w-5 h-5 text-neo-teal shrink-0" />
              <span>
                <strong>Privacy Guaranteed:</strong> Neither customer audio nor customer transcripts are ever stored in external logs. Calculations run server-side and suggestions are displayed exclusively to you.
              </span>
            </div>

            {/* Launch Buttons */}
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={() => startCall(config, true)}
                disabled={status === 'starting'}
                className="flex-1 neo-btn neo-btn-orange text-base py-3.5 flex items-center justify-center gap-2"
              >
                <Zap className="w-5 h-5" />
                {status === 'starting' ? 'Connecting Audio Streams...' : 'Start Meet Assistant (With Meet Audio)'}
              </button>

              <button
                onClick={() => startCall(config, false)}
                disabled={status === 'starting'}
                className="neo-btn bg-white hover:bg-neo-cream text-neo-navy text-xs py-3 px-4 flex items-center justify-center gap-1.5"
                title="Start with mic only and type buyer utterances manually"
              >
                <Mic className="w-4 h-4" />
                Mic-Only / Manual Mode
              </button>
            </div>
          </div>
        </main>
      )}

      {/* ── ACTIVE COPILOT DASHBOARD ── */}
      {isCallActive && (
        <main className="flex-1 p-3 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-4 max-w-7xl mx-auto w-full">
          {/* ── COLUMN 1: LIVE CALL CONTROL & AUDIO TRANSCRIPT STREAM (7 Cols) ── */}
          <section className="lg:col-span-7 flex flex-col gap-4">
            {/* Call Control Strip */}
            <div className="neo-card p-3 sm:p-4 flex flex-wrap items-center justify-between gap-3 bg-white">
              <div className="flex items-center gap-4">
                <div>
                  <div className="text-[10px] font-heading font-black uppercase text-neo-navy/60">Product</div>
                  <div className="font-heading font-bold text-sm truncate max-w-[160px] sm:max-w-xs">{config.product_name}</div>
                </div>

                <div className="h-6 w-[2px] bg-neo-navy/20" />

                <div>
                  <div className="text-[10px] font-heading font-black uppercase text-neo-navy/60">Target Counter</div>
                  <div className="font-heading font-bold text-base text-neo-teal">
                    ${currentCounter ? currentCounter.toFixed(2) : config.base_price.toFixed(2)}
                  </div>
                </div>
              </div>

              {/* Live VU Energy Meters */}
              <div className="flex items-center gap-3">
                {/* Seller Mic VU */}
                <div className="flex items-center gap-1.5 bg-neo-cream px-2 py-1 border-2 border-neo-navy rounded">
                  <button
                    onClick={toggleMicMute}
                    className="p-1 hover:bg-neo-orange/20 rounded"
                    title={isMicMuted ? 'Unmute Mic' : 'Mute Mic'}
                  >
                    {isMicMuted ? <MicOff className="w-3.5 h-3.5 text-neo-maroon" /> : <Mic className="w-3.5 h-3.5 text-neo-navy" />}
                  </button>
                  <div className="w-12 h-2.5 bg-white border border-neo-navy rounded-xs overflow-hidden">
                    <div
                      className="h-full bg-neo-teal transition-all duration-75"
                      style={{ width: `${Math.round(sellerEnergy * 100)}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-heading font-black">MIC</span>
                </div>

                {/* Buyer Tab Audio VU */}
                <div className="flex items-center gap-1.5 bg-neo-cream px-2 py-1 border-2 border-neo-navy rounded">
                  <Volume2 className="w-3.5 h-3.5 text-neo-navy" />
                  <div className="w-12 h-2.5 bg-white border border-neo-navy rounded-xs overflow-hidden">
                    <div
                      className="h-full bg-neo-orange transition-all duration-75"
                      style={{ width: `${Math.round(buyerEnergy * 100)}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-heading font-black">TAB</span>
                </div>

              {/* End Call */}
              <button
                onClick={endCall}
                className="px-3 py-1 bg-neo-maroon text-neo-cream border-2 border-neo-navy font-heading font-bold text-xs uppercase shadow-[2px_2px_0px_#001524] hover:translate-x-[1px] hover:translate-y-[1px] flex items-center gap-1"
              >
                <PhoneOff className="w-3 h-3" />
                End
              </button>
            </div>
          </div>

          {/* ── AUDIO CHANNELS & PROVIDER HEALTH STRIP ── */}
          <div className="bg-neo-cream border-2 border-neo-navy p-2.5 rounded flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              {/* SELLER Status */}
              <div
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded border-2 border-neo-navy font-bold text-[11px] ${
                  sellerStatus === 'live'
                    ? 'bg-emerald-100 text-emerald-900 border-emerald-800'
                    : sellerStatus === 'error'
                    ? 'bg-rose-100 text-rose-900 border-rose-800'
                    : 'bg-amber-100 text-amber-900 border-amber-800'
                }`}
                title={sellerReason}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    sellerStatus === 'live'
                      ? 'bg-emerald-600 animate-pulse'
                      : sellerStatus === 'error'
                      ? 'bg-rose-600'
                      : 'bg-amber-500 animate-ping'
                  }`}
                />
                <span>SELLER audio: {sellerStatus}</span>
                {sellerStatus !== 'live' && (
                  <span className="text-[10px] font-normal opacity-90 hidden sm:inline">({sellerReason})</span>
                )}
              </div>

              {/* BUYER Status */}
              <div
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded border-2 border-neo-navy font-bold text-[11px] ${
                  buyerStatus === 'live'
                    ? 'bg-emerald-100 text-emerald-900 border-emerald-800'
                    : buyerStatus === 'error'
                    ? 'bg-rose-100 text-rose-900 border-rose-800'
                    : buyerStatus === 'inactive'
                    ? 'bg-gray-100 text-gray-700 border-gray-600'
                    : 'bg-amber-100 text-amber-900 border-amber-800'
                }`}
                title={buyerReason}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    buyerStatus === 'live'
                      ? 'bg-emerald-600 animate-pulse'
                      : buyerStatus === 'error'
                      ? 'bg-rose-600'
                      : buyerStatus === 'inactive'
                      ? 'bg-gray-400'
                      : 'bg-amber-500 animate-ping'
                  }`}
                />
                <span>BUYER audio: {buyerStatus}</span>
                {buyerStatus !== 'live' && (
                  <span className="text-[10px] font-normal opacity-90 hidden sm:inline">({buyerReason})</span>
                )}
              </div>
            </div>

            {/* STT Provider Badge */}
            <div className="flex items-center gap-1.5 text-[11px] font-heading font-black text-neo-navy/80 bg-white px-2.5 py-1 border border-neo-navy rounded">
              <Zap className="w-3 h-3 text-neo-orange" />
              <span>STT: {sttProvider}</span>
            </div>
          </div>

          {/* ── HEADPHONES ECHO NOTICE ── */}
          <div className="bg-amber-50 border-2 border-amber-400/80 p-2 rounded text-xs flex items-center gap-2 text-amber-900 font-medium">
            <span className="text-sm">🎧</span>
            <span>
              <strong>Echo Prevention Tip:</strong> Wear headphones during your Google Meet call so your microphone does not pick up the buyer's voice from your speakers.
            </span>
          </div>

          {/* Transcript Stream Feed */}
          <div className="neo-card p-4 flex-1 flex flex-col h-[500px] sm:h-[560px] bg-white">
            <div className="flex items-center justify-between pb-2 border-b-2 border-neo-navy mb-3">
              <span className="font-heading font-black text-xs uppercase tracking-wider flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5 text-neo-orange animate-pulse" />
                Dual-Channel Live Conversation Feed
              </span>
              <span className="text-[10px] font-bold text-neo-navy/60 font-mono">
                {transcripts.length} utterances
              </span>
            </div>

            {/* Scrollable Transcript List */}
            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {transcripts.length === 0 && !partialSellerText && !partialBuyerText && (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 text-neo-navy/50">
                  <Activity className="w-8 h-8 mb-2 animate-bounce opacity-40" />
                  <p className="font-heading font-bold text-sm">Listening for conversation...</p>
                  <p className="text-xs max-w-xs mt-1">
                    Speak into your microphone or let the buyer speak in Google Meet. Speech appears here automatically.
                  </p>
                </div>
              )}

              {transcripts.map((t) => {
                return <TranscriptItem key={t.id} t={t} />;
              })}

              {/* Live Partial Speech Indicators (Grey) */}
              {partialSellerText && (
                <div className="flex flex-col items-end opacity-75 animate-pulse">
                  <span className="text-[10px] font-mono font-medium text-gray-500 mb-0.5">YOU (speaking...):</span>
                  <div className="max-w-[85%] p-2.5 border-2 border-dashed border-gray-400 bg-gray-100 text-gray-700 text-xs italic rounded">
                    "{partialSellerText}"
                  </div>
                </div>
              )}

              {partialBuyerText && (
                <div className="flex flex-col items-start opacity-75 animate-pulse">
                  <span className="text-[10px] font-mono font-medium text-gray-500 mb-0.5">BUYER (speaking...):</span>
                  <div className="max-w-[85%] p-2.5 border-2 border-dashed border-gray-400 bg-gray-100 text-gray-700 text-xs italic rounded">
                    "{partialBuyerText}"
                  </div>
                </div>
              )}

              <div ref={transcriptEndRef} />
            </div>

            {/* Manual Speech Injection Form */}
              <form onSubmit={handleSendManual} className="mt-3 pt-3 border-t-2 border-neo-navy flex gap-2">
                <select
                  value={typedSpeaker}
                  onChange={(e) => setTypedSpeaker(e.target.value)}
                  className="px-2 py-1.5 border-2 border-neo-navy bg-neo-cream font-heading font-bold text-xs uppercase"
                >
                  <option value="BUYER">Buyer Said</option>
                  <option value="SELLER">I Said</option>
                </select>

                <input
                  type="text"
                  placeholder="Type utterance (for testing or manual sync)..."
                  value={typedText}
                  onChange={(e) => setTypedText(e.target.value)}
                  className="flex-1 px-3 py-1.5 border-2 border-neo-navy bg-white text-xs font-medium focus:outline-hidden"
                />

                <button
                  type="submit"
                  className="px-3 py-1.5 bg-neo-orange border-2 border-neo-navy font-heading font-bold text-xs flex items-center gap-1 shadow-[2px_2px_0px_#001524] hover:translate-x-[1px] hover:translate-y-[1px]"
                >
                  <Send className="w-3 h-3" />
                  Inject
                </button>
              </form>
            </div>
          </section>

          {/* ── COLUMN 2: STRATEGIC ADVISORY & TACTICAL REPLIES (5 Cols) ── */}
          <section className="lg:col-span-5 flex flex-col gap-4">
            {/* PRANE-X Action Card */}
            <div className="neo-card p-5 bg-white relative overflow-hidden">
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="text-[11px] font-heading font-black text-neo-navy/60 uppercase tracking-widest">
                  ENGINE RECOMMENDATION
                </div>

                {advisory && (
                  <span
                    className={`px-2 py-0.5 text-[10px] font-heading font-black border rounded flex items-center gap-1 transition-all ${
                      advisory.source === 'ai'
                        ? 'bg-purple-100 text-purple-900 border-purple-300'
                        : 'bg-amber-100 text-amber-900 border-amber-300'
                    }`}
                  >
                    {advisory.source === 'ai' ? (
                      <>
                        <Sparkles className="w-3 h-3 text-purple-600" />
                        AI INTEL
                      </>
                    ) : (
                      <>
                        <Zap className="w-3 h-3 text-amber-600" />
                        INSTANT TEMPLATE
                      </>
                    )}
                  </span>
                )}
              </div>

              {advisory ? (
                <>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div
                      className={`text-lg sm:text-xl font-heading font-black px-3 py-1 border-[3px] border-neo-navy shadow-[3px_3px_0px_#001524] uppercase ${
                        advisory.action === 'ACCEPT'
                          ? 'bg-emerald-400 text-neo-navy'
                          : advisory.action === 'COUNTER'
                          ? 'bg-neo-orange text-neo-navy'
                          : advisory.action === 'FINAL_OFFER'
                          ? 'bg-purple-400 text-neo-navy'
                          : 'bg-neo-maroon text-neo-cream'
                      }`}
                    >
                      {advisory.action}
                    </div>

                    <div className="text-right">
                      <div className="text-[10px] font-heading font-bold uppercase text-neo-navy/60">Target Quote</div>
                      <div className="text-2xl font-heading font-black text-neo-navy">
                        ${advisory.counter_price.toFixed(2)}
                      </div>
                    </div>
                  </div>

                  {advisory.timing && (
                    <div className="flex flex-wrap items-center gap-1.5 mb-3 text-[10px] font-mono text-gray-500">
                      {advisory.timing.t2_to_t5_ms !== undefined && (
                        <span className="bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200">
                          ⚡ Card: {advisory.timing.t2_to_t5_ms}ms
                        </span>
                      )}
                      {advisory.timing.t2_to_t7_ms !== undefined && (
                        <span className="bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded border border-purple-200">
                          ✨ AI: {advisory.timing.t2_to_t7_ms}ms
                        </span>
                      )}
                    </div>
                  )}

                  <p className="text-xs text-neo-navy/80 bg-neo-cream p-2.5 border-2 border-neo-navy rounded font-medium mb-4">
                    💡 <strong>Strategy Rationale:</strong> {advisory.reasoning}
                  </p>
                </>
              ) : (
                <div className="p-4 border-2 border-dashed border-neo-navy/30 rounded text-center text-xs text-neo-navy/60 my-2">
                  Waiting for buyer's initial statement to compute advisory guidance...
                </div>
              )}

              {/* TACTICAL SPOKEN REPLIES */}
              <div className="mt-2">
                <div className="text-[11px] font-heading font-black text-neo-navy uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-neo-orange" />
                  What You Should Say Out Loud:
                </div>

                {advisory && advisory.suggested_replies && advisory.suggested_replies.length > 0 ? (
                  <div className="space-y-2.5">
                    {advisory.suggested_replies.map((reply, idx) => (
                      <div
                        key={idx}
                        className="p-3 bg-neo-cream/70 border-2 border-neo-navy rounded shadow-[2px_2px_0px_#001524] relative group"
                      >
                        <p className="text-xs sm:text-sm font-semibold text-neo-navy pr-8 leading-snug">
                          "{reply}"
                        </p>
                        <button
                          onClick={() => handleCopyReply(reply, idx)}
                          className="absolute top-2.5 right-2.5 p-1 bg-white border border-neo-navy hover:bg-neo-orange/20 rounded transition-all"
                          title="Copy reply text"
                        >
                          {copiedIndex === idx ? (
                            <Check className="w-3.5 h-3.5 text-emerald-600" />
                          ) : (
                            <Copy className="w-3.5 h-3.5 text-neo-navy" />
                          )}
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-3 bg-neo-cream/40 border border-neo-navy/20 rounded text-xs text-neo-navy/50 italic">
                    Suggestions will be generated dynamically as the buyer speaks.
                  </div>
                )}
              </div>
            </div>

            {/* PRANE-X Telemetry Gauges */}
            <div className="neo-card p-4 bg-white">
              <div className="text-[11px] font-heading font-black text-neo-navy/70 uppercase tracking-wider mb-3 flex items-center justify-between">
                <span>PRANE-X Engine Telemetry</span>
                <span className="font-mono text-[10px]">Round {currentRound} / {config.max_rounds}</span>
              </div>

              {advisory && advisory.metrics ? (
                <div className="space-y-3 text-xs">
                  {/* BBI (Buyer Bargaining Index) */}
                  <div>
                    <div className="flex justify-between font-heading font-bold mb-1">
                      <span>Buyer Bargaining Index (BBI)</span>
                      <span className="font-mono">{advisory.metrics.bbi} / 100</span>
                    </div>
                    <div className="w-full h-2.5 bg-neo-cream border border-neo-navy rounded-xs overflow-hidden">
                      <div
                        className="h-full bg-neo-orange transition-all duration-300"
                        style={{ width: `${Math.min(100, advisory.metrics.bbi)}%` }}
                      />
                    </div>
                  </div>

                  {/* High WTP Probability */}
                  <div>
                    <div className="flex justify-between font-heading font-bold mb-1">
                      <span>P(High Willingness to Pay)</span>
                      <span className="font-mono">{(advisory.metrics.p_high_wtp * 100).toFixed(0)}%</span>
                    </div>
                    <div className="w-full h-2.5 bg-neo-cream border border-neo-navy rounded-xs overflow-hidden">
                      <div
                        className="h-full bg-neo-teal transition-all duration-300"
                        style={{ width: `${Math.round(advisory.metrics.p_high_wtp * 100)}%` }}
                      />
                    </div>
                  </div>

                  {/* Surplus Budget Share */}
                  <div>
                    <div className="flex justify-between font-heading font-bold mb-1">
                      <span>Remaining Concession Budget</span>
                      <span className="font-mono">{(advisory.metrics.surplus_share * 100).toFixed(0)}%</span>
                    </div>
                    <div className="w-full h-2.5 bg-neo-cream border border-neo-navy rounded-xs overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 transition-all duration-300"
                        style={{ width: `${Math.round(advisory.metrics.surplus_share * 100)}%` }}
                      />
                    </div>
                  </div>

                  {/* Firmness / Stagnant indicators */}
                  <div className="grid grid-cols-2 gap-2 pt-1 border-t border-neo-navy/10">
                    <div className="bg-neo-cream/50 p-2 border border-neo-navy/30 rounded text-center">
                      <div className="text-[10px] text-neo-navy/60 font-heading font-bold uppercase">Firmness Level</div>
                      <div className="font-heading font-black text-sm text-neo-teal">
                        Level {advisory.metrics.firmness_level}
                      </div>
                    </div>
                    <div className="bg-neo-cream/50 p-2 border border-neo-navy/30 rounded text-center">
                      <div className="text-[10px] text-neo-navy/60 font-heading font-bold uppercase">Stagnant Rounds</div>
                      <div className="font-heading font-black text-sm text-neo-orange">
                        {advisory.metrics.consecutive_stagnant}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-neo-navy/50 italic text-center py-4">
                  Metrics activate upon receiving the first buyer offer.
                </div>
              )}
            </div>
          </section>
        </main>
      )}
    </div>
  );
}
