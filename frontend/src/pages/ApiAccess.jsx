import { useState, useEffect } from 'react';
import {
    Key, Plus, Copy, Check, Trash2, Code2, AlertCircle, Loader2,
    Shield, Zap, RefreshCw, Eye, EyeOff, Terminal, BookOpen,
    ArrowRight, Hash
} from 'lucide-react';
import Layout from '../components/Layout';
import NeoCard from '../components/NeoCard';
import NeoButton from '../components/NeoButton';
import { getAuthToken } from '../lib/api';

const AUTH_API = import.meta.env.VITE_AUTH_API_URL || 'http://localhost:8000';

// ── API helpers ────────────────────────────────────────────────────
async function fetchKeys() {
    const res = await fetch(`${AUTH_API}/api/v1/api-keys`, {
        headers: { Authorization: `Bearer ${getAuthToken()}` },
    });
    if (!res.ok) throw new Error('Failed to load keys');
    return (await res.json()).keys;
}

async function generateKey(label) {
    const res = await fetch(`${AUTH_API}/api/v1/api-keys`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${getAuthToken()}`,
        },
        body: JSON.stringify({ label }),
    });
    if (!res.ok) throw new Error('Failed to generate key');
    return res.json();
}

async function revokeKey(id) {
    const res = await fetch(`${AUTH_API}/api/v1/api-keys/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${getAuthToken()}` },
    });
    if (!res.ok) throw new Error('Failed to revoke key');
}

// ── Code snippets ──────────────────────────────────────────────────
const LANGS = ['Python', 'JavaScript', 'TypeScript'];

function getSnippet(lang, apiKey) {
    const key = apiKey || 'tm_YOUR_API_KEY_HERE';
    const base = 'http://localhost:8000';

    if (lang === 'Python') {
        return `import requests
API_KEY = "${key}"
BASE = "${base}"
H = {"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"}
# Create a negotiation session
session = requests.post(f"{BASE}/api/v1/chat-sessions", json={
    "product_name": "Premium Widget",
    "base_price": 100.0, "cost_price": 40.0,
    "min_acceptable_price": 60.0,
    "max_rounds": 10, "strategy_mode": "MAX_PROFIT"
}, headers=H).json()
print("Session:", session["id"])
# Send a buyer offer
reply = requests.post(f"{BASE}/api/v1/chat-sessions/{session['id']}/messages", json={
    "user_message": "I'll pay ₹65", "bot_reply": "",
    "buyer_offer": 65.0, "seller_counter": None, "round_number": 1
}, headers=H).json()
print("Reply:", reply)`;
    }

    if (lang === 'JavaScript') {
        return `const API_KEY = "${key}";
const BASE = "${base}";
const headers = { Authorization: \`Bearer \${API_KEY}\`, "Content-Type": "application/json" };
// Create a negotiation session
const session = await fetch(\`\${BASE}/api/v1/chat-sessions\`, {
  method: "POST", headers,
  body: JSON.stringify({
    product_name: "Premium Widget", base_price: 100, cost_price: 40,
    min_acceptable_price: 60, max_rounds: 10, strategy_mode: "MAX_PROFIT"
  })
}).then(r => r.json());
console.log("Session:", session.id);
// Send a buyer offer
const reply = await fetch(\`\${BASE}/api/v1/chat-sessions/\${session.id}/messages\`, {
  method: "POST", headers,
  body: JSON.stringify({
    user_message: "I'll pay ₹65", bot_reply: "",
    buyer_offer: 65, seller_counter: null, round_number: 1
  })
}).then(r => r.json());
console.log("Reply:", reply);`;
    }

    // TypeScript
    return `const API_KEY: string = "${key}";
const BASE: string = "${base}";
const headers: Record<string, string> = {
  Authorization: \`Bearer \${API_KEY}\`, "Content-Type": "application/json"
};
// Create a negotiation session
const session = await fetch(\`\${BASE}/api/v1/chat-sessions\`, {
  method: "POST", headers,
  body: JSON.stringify({
    product_name: "Premium Widget", base_price: 100, cost_price: 40,
    min_acceptable_price: 60, max_rounds: 10,
    strategy_mode: "MAX_PROFIT" as "MAX_PROFIT" | "MIN_LOSS"
  })
}).then((r: Response) => r.json());
console.log("Session:", session.id);
// Send a buyer offer
const reply = await fetch(\`\${BASE}/api/v1/chat-sessions/\${session.id}/messages\`, {
  method: "POST", headers,
  body: JSON.stringify({
    user_message: "I'll pay ₹65", bot_reply: "",
    buyer_offer: 65, seller_counter: null, round_number: 1
  })
}).then((r: Response) => r.json());
console.log("Reply:", reply);`;
}

// ── Component ──────────────────────────────────────────────────────
export default function ApiAccess() {
    const [keys, setKeys] = useState([]);
    const [loading, setLoading] = useState(true);
    const [generating, setGenerating] = useState(false);
    const [label, setLabel] = useState('');
    const [error, setError] = useState('');
    const [copied, setCopied] = useState(null);       // key id that was copied
    const [selectedLang, setSelectedLang] = useState('Python');
    const [activeKey, setActiveKey] = useState(null);  // key to show in snippets
    const [revealedKeys, setRevealedKeys] = useState(new Set());
    const [deleteConfirm, setDeleteConfirm] = useState(null);

    useEffect(() => {
        loadKeys();
    }, []);

    async function loadKeys() {
        setLoading(true);
        try {
            const data = await fetchKeys();
            setKeys(data);
            if (data.length > 0 && !activeKey) setActiveKey(data[0].api_key_full);
        } catch {
            setError('Failed to load API keys. Are you logged in?');
        }
        setLoading(false);
    }

    async function handleGenerate() {
        setGenerating(true);
        setError('');
        try {
            const newKey = await generateKey(label || 'Default');
            setKeys(prev => [{ ...newKey, api_key_masked: newKey.api_key.slice(0, 3) + '•'.repeat(newKey.api_key.length - 11) + newKey.api_key.slice(-8), api_key_full: newKey.api_key, is_active: 1, created_at: new Date().toISOString() }, ...prev]);
            setActiveKey(newKey.api_key);
            setLabel('');
            // auto-reveal just-created key
            setRevealedKeys(prev => new Set(prev).add(newKey.id));
        } catch {
            setError('Failed to generate API key');
        }
        setGenerating(false);
    }

    async function handleRevoke(id) {
        try {
            await revokeKey(id);
            setKeys(prev => prev.filter(k => k.id !== id));
            setDeleteConfirm(null);
        } catch {
            setError('Failed to revoke key');
        }
    }

    function copyToClipboard(text, id) {
        navigator.clipboard.writeText(text);
        setCopied(id);
        setTimeout(() => setCopied(null), 2000);
    }

    function copySnippet() {
        navigator.clipboard.writeText(getSnippet(selectedLang, activeKey));
        setCopied('snippet');
        setTimeout(() => setCopied(null), 2000);
    }

    function toggleReveal(id) {
        setRevealedKeys(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    }

    return (
        <Layout>
            <section className="min-h-screen bg-neo-cream py-10 px-4">
                <div className="container mx-auto max-w-5xl">

                    {/* ── Header ─────────────────────────────────────── */}
                    <div className="mb-8">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="w-12 h-12 bg-neo-navy flex items-center justify-center">
                                <Key className="w-6 h-6 text-neo-orange" />
                            </div>
                            <div>
                                <h1 className="font-heading text-3xl font-bold text-neo-navy tracking-tight">
                                    API <span className="text-neo-orange">ACCESS</span>
                                </h1>
                                <p className="text-neo-navy/50 text-sm font-bold uppercase tracking-wider">
                                    Generate keys · Integrate your negotiation engine
                                </p>
                            </div>
                        </div>
                    </div>

                    {error && (
                        <div className="mb-4 p-3 bg-neo-maroon/10 border-[2px] border-neo-maroon flex items-center gap-2 text-neo-maroon text-sm font-bold">
                            <AlertCircle className="w-4 h-4" /> {error}
                        </div>
                    )}

                    {/* ── Top Row: Generate + Keys ───────────────── */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">

                        {/* Generate Card */}
                        <NeoCard className="p-5">
                            <p className="text-[10px] uppercase font-bold text-neo-navy/50 mb-3 flex items-center gap-1">
                                <Zap className="w-3 h-3" /> Generate New Key
                            </p>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    placeholder="Label (e.g. Production, Testing…)"
                                    value={label}
                                    onChange={e => setLabel(e.target.value)}
                                    className="flex-1 px-3 py-2.5 border-[2px] border-neo-navy bg-white text-sm font-bold text-neo-navy placeholder:text-neo-navy/30 focus:outline-none focus:border-neo-orange"
                                />
                                <NeoButton
                                    variant="orange"
                                    onClick={handleGenerate}
                                    disabled={generating}
                                >
                                    {generating ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                        <><Plus className="w-4 h-4 mr-1" /> Generate</>
                                    )}
                                </NeoButton>
                            </div>
                        </NeoCard>

                        {/* Keys List */}
                        <NeoCard className="p-5">
                            <div className="flex items-center justify-between mb-3">
                                <p className="text-[10px] uppercase font-bold text-neo-navy/50 flex items-center gap-1">
                                    <Shield className="w-3 h-3" /> Your API Keys
                                </p>
                                <button onClick={loadKeys} className="text-neo-navy/40 hover:text-neo-teal transition-colors">
                                    <RefreshCw className="w-4 h-4" />
                                </button>
                            </div>

                            {loading ? (
                                <div className="h-24 flex items-center justify-center">
                                    <Loader2 className="w-6 h-6 text-neo-teal animate-spin" />
                                </div>
                            ) : keys.length === 0 ? (
                                <div className="h-24 flex items-center justify-center border-[2px] border-dashed border-neo-navy/20">
                                    <div className="text-center text-neo-navy/30">
                                        <Key className="w-6 h-6 mx-auto mb-2 opacity-40" />
                                        <p className="text-xs font-bold">No API keys yet</p>
                                        <p className="text-[10px]">Generate one to get started</p>
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-2 max-h-48 overflow-y-auto">
                                    {keys.map(k => (
                                        <div
                                            key={k.id}
                                            className={`border-[2px] p-3 transition-all cursor-pointer ${
                                                activeKey === k.api_key_full
                                                    ? 'border-neo-orange bg-neo-orange/5'
                                                    : 'border-neo-navy/20 hover:border-neo-navy/40'
                                            }`}
                                            onClick={() => setActiveKey(k.api_key_full)}
                                        >
                                            <div className="flex items-center justify-between gap-2">
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <span className="font-heading font-bold text-sm text-neo-navy">{k.label}</span>
                                                        {k.is_active ? (
                                                            <span className="text-[8px] px-1.5 py-0.5 bg-neo-teal/20 text-neo-teal font-bold uppercase">Active</span>
                                                        ) : (
                                                            <span className="text-[8px] px-1.5 py-0.5 bg-neo-maroon/20 text-neo-maroon font-bold uppercase">Revoked</span>
                                                        )}
                                                    </div>
                                                    <div className="flex items-center gap-1.5">
                                                        <code className="text-xs text-neo-navy/60 font-mono truncate">
                                                            {revealedKeys.has(k.id) ? k.api_key_full : k.api_key_masked}
                                                        </code>
                                                        <button
                                                            onClick={e => { e.stopPropagation(); toggleReveal(k.id); }}
                                                            className="text-neo-navy/30 hover:text-neo-navy transition-colors"
                                                        >
                                                            {revealedKeys.has(k.id) ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                                        </button>
                                                    </div>
                                                    <p className="text-[10px] text-neo-navy/40 mt-1">
                                                        Created {k.created_at ? new Date(k.created_at).toLocaleDateString() : '—'}
                                                    </p>
                                                </div>
                                                <div className="flex items-center gap-1.5">
                                                    <button
                                                        onClick={e => { e.stopPropagation(); copyToClipboard(k.api_key_full, k.id); }}
                                                        className="w-8 h-8 flex items-center justify-center border-[2px] border-neo-navy/20 hover:border-neo-teal hover:text-neo-teal transition-colors"
                                                    >
                                                        {copied === k.id ? <Check className="w-3.5 h-3.5 text-neo-teal" /> : <Copy className="w-3.5 h-3.5" />}
                                                    </button>
                                                    {deleteConfirm === k.id ? (
                                                        <div className="flex items-center gap-1">
                                                            <button
                                                                onClick={e => { e.stopPropagation(); handleRevoke(k.id); }}
                                                                className="text-[10px] font-bold text-neo-cream bg-neo-maroon px-2 py-1 border-[2px] border-neo-maroon hover:bg-neo-maroon/80 transition-colors"
                                                            >
                                                                Yes
                                                            </button>
                                                            <button
                                                                onClick={e => { e.stopPropagation(); setDeleteConfirm(null); }}
                                                                className="text-[10px] font-bold px-2 py-1 border-[2px] border-neo-navy/20"
                                                            >
                                                                No
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <button
                                                            onClick={e => { e.stopPropagation(); setDeleteConfirm(k.id); }}
                                                            className="w-8 h-8 flex items-center justify-center border-[2px] border-neo-navy/20 text-neo-navy/30 hover:border-neo-maroon hover:text-neo-maroon transition-colors"
                                                        >
                                                            <Trash2 className="w-3.5 h-3.5" />
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </NeoCard>
                    </div>

                    {/* ── Endpoint Reference — Full Width Grid ───────── */}
                    <div className="mb-8">
                    <NeoCard className="p-5">
                        <div className="flex items-center gap-2 mb-4">
                            <BookOpen className="w-4 h-4 text-neo-navy/40" />
                            <p className="text-[10px] uppercase font-bold text-neo-navy/50 tracking-wider">API Endpoint Reference</p>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
                            {[
                                { method: 'POST', path: '/api/v1/chat-sessions', desc: 'Create a new negotiation session' },
                                { method: 'GET', path: '/api/v1/chat-sessions', desc: 'List all your sessions' },
                                { method: 'GET', path: '/api/v1/chat-sessions/:id', desc: 'Get session with messages' },
                                { method: 'POST', path: '/api/v1/chat-sessions/:id/messages', desc: 'Send a buyer offer' },
                                { method: 'PUT', path: '/api/v1/chat-sessions/:id/close', desc: 'Close & finalize session' },
                                { method: 'GET', path: '/api/v1/products', desc: 'List all products' },
                                { method: 'GET', path: '/api/v1/products/:id/stats', desc: 'Get product analytics' },
                                { method: 'GET', path: '/api/v1/auth/me', desc: 'Verify your identity' },
                            ].map((ep, i) => (
                                <div key={i} className="border-[2px] border-neo-navy/10 hover:border-neo-navy/25 p-3 transition-colors group">
                                    <div className="flex items-center gap-2 mb-1.5">
                                        <span className={`font-mono font-bold px-2 py-0.5 text-[9px] tracking-wider ${
                                            ep.method === 'GET' ? 'bg-neo-teal/15 text-neo-teal border border-neo-teal/20' :
                                            ep.method === 'POST' ? 'bg-neo-orange/15 text-neo-orange border border-neo-orange/20' :
                                            'bg-neo-navy/10 text-neo-navy border border-neo-navy/15'
                                        }`}>{ep.method}</span>
                                    </div>
                                    <code className="text-[10.5px] text-neo-navy/70 font-mono block mb-1 truncate">{ep.path}</code>
                                    <p className="text-[10px] text-neo-navy/40">{ep.desc}</p>
                                </div>
                            ))}
                        </div>
                    </NeoCard>
                    </div>

                    {/* ── Code Snippets — Full Width ─────────────────── */}
                    <NeoCard className="p-0 overflow-hidden">
                        {/* Header bar with tabs */}
                        <div className="bg-neo-navy flex items-center justify-between">
                            <div className="flex items-center">
                                <div className="flex items-center gap-2 px-5 py-3.5 border-r border-neo-cream/10">
                                    <Terminal className="w-5 h-5 text-neo-orange" />
                                    <span className="text-sm text-neo-cream font-heading font-bold tracking-wide">Quick Start Guide</span>
                                </div>
                                <div className="flex items-center">
                                    {LANGS.map(lang => {
                                        const isActive = selectedLang === lang;
                                        return (
                                            <button
                                                key={lang}
                                                onClick={() => setSelectedLang(lang)}
                                                className={`
                                                    relative px-5 py-3.5 text-xs font-bold uppercase tracking-wider transition-all
                                                    ${isActive
                                                        ? 'bg-neo-orange/15 text-neo-orange'
                                                        : 'text-neo-cream/40 hover:text-neo-cream/70 hover:bg-neo-cream/5'
                                                    }
                                                `}
                                            >
                                                {lang}
                                                {isActive && (
                                                    <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-neo-orange" />
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                            <button
                                onClick={copySnippet}
                                className="mr-3 px-3 py-1.5 bg-neo-cream/10 hover:bg-neo-cream/20 text-neo-cream text-[11px] font-bold uppercase flex items-center gap-1.5 transition-colors border border-neo-cream/10"
                            >
                                {copied === 'snippet' ? <><Check className="w-3.5 h-3.5 text-neo-teal" /> Copied!</> : <><Copy className="w-3.5 h-3.5" /> Copy Code</>}
                            </button>
                        </div>

                        {/* Code block with line numbers */}
                        <div className="relative bg-[#0a1628]">
                            <div className="flex">
                                {/* Line numbers */}
                                <div className="flex-shrink-0 py-5 pl-4 pr-3 select-none border-r border-neo-cream/5">
                                    {getSnippet(selectedLang, activeKey).split('\n').map((_, i) => (
                                        <div key={i} className="text-[11px] leading-[1.7] text-neo-cream/15 font-mono text-right" style={{ minWidth: '24px' }}>
                                            {i + 1}
                                        </div>
                                    ))}
                                </div>
                                {/* Code content */}
                                <pre className="flex-1 py-5 px-5 overflow-x-auto max-h-[55vh]">
                                    <code className="text-[12.5px] leading-[1.7] font-mono">
                                        {getSnippet(selectedLang, activeKey).split('\n').map((line, i) => {
                                            // Simple syntax highlighting
                                            let colored = line;
                                            // Comments
                                            if (line.trimStart().startsWith('#') || line.trimStart().startsWith('//')) {
                                                return <div key={i} className="text-neo-teal/40">{line}</div>;
                                            }
                                            // Strings
                                            if (/^(import |from |const |async |interface |type )/.test(line.trimStart())) {
                                                const keyword = line.match(/^\s*(import|from|const|async|interface|type|function|return|await)\b/);
                                                if (keyword) {
                                                    const idx = line.indexOf(keyword[1]);
                                                    return (
                                                        <div key={i}>
                                                            <span className="text-neo-cream/50">{line.slice(0, idx)}</span>
                                                            <span className="text-neo-orange">{keyword[1]}</span>
                                                            <span className="text-neo-cream/80">{line.slice(idx + keyword[1].length)}</span>
                                                        </div>
                                                    );
                                                }
                                            }
                                            return <div key={i} className="text-neo-cream/80">{line || '\u00A0'}</div>;
                                        })}
                                    </code>
                                </pre>
                            </div>
                        </div>

                        {/* Active key indicator */}
                        <div className="bg-[#0d1d33] px-5 py-2.5 flex items-center gap-3 border-t border-neo-cream/5">
                            <Hash className="w-3.5 h-3.5 text-neo-cream/20" />
                            <span className="text-[10px] text-neo-cream/30 font-bold uppercase tracking-wider">Using Key:</span>
                            <code className="text-[11px] text-neo-orange/70 font-mono">
                                {activeKey ? activeKey.slice(0, 3) + '••••' + activeKey.slice(-8) : 'No key selected'}
                            </code>
                            {activeKey && (
                                <button
                                    onClick={() => copyToClipboard(activeKey, 'active-key')}
                                    className="text-neo-cream/20 hover:text-neo-cream/50 transition-colors ml-1"
                                >
                                    {copied === 'active-key' ? <Check className="w-3 h-3 text-neo-teal" /> : <Copy className="w-3 h-3" />}
                                </button>
                            )}
                        </div>
                    </NeoCard>
                </div>
            </section>
        </Layout>
    );
}
