const API_SERVER = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000';
const API_BASE = `${API_SERVER}/api/v1/negotiate`;
const CHAT_DB_BASE = `${API_SERVER}/api/v1/chat-sessions`;

/** Default fetch timeout (15 seconds) */
const FETCH_TIMEOUT_MS = 15000;

function _token() {
    return localStorage.getItem('trademind_token');
}

function _authHeaders() {
    const h = { 'Content-Type': 'application/json' };
    const t = _token();
    if (t) h['Authorization'] = `Bearer ${t}`;
    return h;
}

// ── Chat DB persistence helpers ──────────────────────────────────

const DB_RETRY_ATTEMPTS = 3;
const DB_RETRY_DELAY_MS = 1000;

/** Internal retry wrapper for critical DB operations */
async function _retryFetch(url, options, attempts = DB_RETRY_ATTEMPTS) {
    let lastError = null;
    for (let i = 0; i < attempts; i++) {
        try {
            const res = await fetch(url, options);
            if (res.status === 401) {
                // Token expired — don't retry, surface immediately
                const err = new Error('Authentication expired. Please log in again.');
                err.code = 'AUTH_EXPIRED';
                throw err;
            }
            if (!res.ok) {
                const errText = await res.text().catch(() => `HTTP ${res.status}`);
                throw new Error(`HTTP ${res.status}: ${errText}`);
            }
            return await res.json();
        } catch (e) {
            lastError = e;
            if (e.code === 'AUTH_EXPIRED') throw e; // Don't retry auth failures
            if (i < attempts - 1) {
                console.warn(`[DB] Retry ${i + 1}/${attempts} for ${url}:`, e.message);
                await new Promise(r => setTimeout(r, DB_RETRY_DELAY_MS * (i + 1)));
            }
        }
    }
    throw lastError;
}

/** Create a chat session in MySQL (returns { id, status }) */
export async function dbStartSession({ product_name, mode, base_price, cost_price, min_price, max_rounds }) {
    if (!_token()) {
        console.warn('[DB] dbStartSession skipped — no auth token');
        return null;
    }
    try {
        return await _retryFetch(CHAT_DB_BASE, {
            method: 'POST',
            headers: _authHeaders(),
            body: JSON.stringify({ product_name, mode, base_price, cost_price, min_price, max_rounds }),
        });
    } catch (e) {
        console.error('[DB] dbStartSession FAILED after retries:', e.message);
        throw e; // Let caller handle — session creation failure is critical
    }
}

/** Save a chat round to MySQL */
export async function dbSaveMessage(dbSessionId, { round_number, user_message, bot_reply, offered_price, counter_price, decision }) {
    if (!_token() || !dbSessionId) return null;
    try {
        return await _retryFetch(`${CHAT_DB_BASE}/${dbSessionId}/messages`, {
            method: 'POST',
            headers: _authHeaders(),
            body: JSON.stringify({ round_number, user_message, bot_reply, offered_price, counter_price, decision }),
        });
    } catch (e) {
        console.error('[DB] dbSaveMessage failed:', e.message);
        return null; // Non-critical: message can be lost without breaking flow
    }
}

/** Close a chat session in MySQL with final outcome — CRITICAL, uses retries */
export async function dbCloseSession(dbSessionId, { status, final_price, final_decision, deal_closed, buyer_last_offer, seller_last_offer, rounds_used }) {
    if (!_token() || !dbSessionId) {
        const err = new Error(`Cannot close session: ${!_token() ? 'no auth token' : 'no session ID'}`);
        err.code = 'DB_PRECONDITION';
        throw err;
    }
    // This is critical — uses retry. Throws on failure so caller can warn user.
    return await _retryFetch(`${CHAT_DB_BASE}/${dbSessionId}/close`, {
        method: 'PUT',
        headers: _authHeaders(),
        body: JSON.stringify({ status, final_price, final_decision, deal_closed, buyer_last_offer, seller_last_offer, rounds_used }),
    });
}

/** Save a callback request (phone number for scheduling a call) */
export async function dbSaveCallbackRequest({ session_id, phone_number, product_name, negotiation_status, final_price }) {
    if (!_token()) return null;
    try {
        return await _retryFetch(`${CHAT_DB_BASE}/callback-request`, {
            method: 'POST',
            headers: _authHeaders(),
            body: JSON.stringify({ session_id, phone_number, product_name, negotiation_status, final_price }),
        });
    } catch (e) {
        console.error('[DB] dbSaveCallbackRequest failed:', e.message);
        return null;
    }
}

/** Get all chat sessions for current user */
export async function dbGetSessions() {
    if (!_token()) return [];
    try {
        const res = await fetch(CHAT_DB_BASE, { headers: _authHeaders() });
        if (!res.ok) return [];
        return await res.json();
    } catch { return []; }
}

/** Get a single session with messages */
export async function dbGetSession(dbSessionId) {
    if (!_token() || !dbSessionId) return null;
    try {
        const res = await fetch(`${CHAT_DB_BASE}/${dbSessionId}`, { headers: _authHeaders() });
        if (!res.ok) return null;
        return await res.json();
    } catch { return null; }
}

// Default product config for demo/testing
const DEFAULT_SESSION_CONFIG = {
    product: {
        product_id: "DEMO-001",
        product_name: "Premium Widget",
        base_price: 100.00,
        cost_price: 40.00,
        min_acceptable_price: 50.00,
        max_loss_percentage: 0
    },
    inventory: {
        available_quantity: 100,
        requested_quantity: 10,
        inventory_pressure: "medium",
        sales_frequency: "medium"
    },
    strategy: {
        mode: "MAX_PROFIT",
        urgency: "medium",
        relationship_priority: "medium",
        max_rounds: 10
    }
};

// Create a new negotiation session
export async function createSession(config = null) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        const body = config || DEFAULT_SESSION_CONFIG;
        const response = await fetch(`${API_BASE}/sessions`, {
            method: 'POST',
            headers: _authHeaders(),
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorData = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorData}`);
        }

        return await response.json();
    } catch (error) {
        if (error.name === 'AbortError') throw new Error('Request timed out. Please try again.');
        console.error('Failed to create session:', error);
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

// Submit a buyer offer (negotiation turn)
export async function submitOffer(sessionId, offeredPrice, message = null, offeredQuantity = null) {
    try {
        const body = {
            offered_price: offeredPrice,
        };
        if (message) body.message = message;
        if (offeredQuantity) body.offered_quantity = offeredQuantity;

        const response = await fetch(`${API_BASE}/sessions/${sessionId}/turns`, {
            method: 'POST',
            headers: _authHeaders(),
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorData = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorData}`);
        }

        return await response.json();
    } catch (error) {
        console.error('Failed to submit offer:', error);
        throw error;
    }
}

// Send a free-text chat message (AI understands intent)
export async function sendChat(sessionId, message) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS * 2); // Double timeout for LLM
    try {
        const body = { message };

        const response = await fetch(`${API_BASE}/sessions/${sessionId}/chat`, {
            method: 'POST',
            headers: _authHeaders(),
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorData = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorData}`);
        }

        return await response.json();
    } catch (error) {
        if (error.name === 'AbortError') throw new Error('AI response timed out. Please try again.');
        console.error('Failed to send chat:', error);
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

// Get session summary
export async function getSession(sessionId) {
    try {
        const response = await fetch(`${API_BASE}/sessions/${sessionId}`, {
            method: 'GET',
            headers: _authHeaders()
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        console.error('Failed to get session:', error);
        throw error;
    }
}

// Get session analytics
export async function getAnalytics(sessionId) {
    try {
        const response = await fetch(`${API_BASE}/sessions/${sessionId}/analytics`, {
            method: 'GET',
            headers: _authHeaders()
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        console.error('Failed to get analytics:', error);
        throw error;
    }
}

// Health check
export async function healthCheck() {
    try {
        const response = await fetch(`${API_BASE}/health`, {
            method: 'GET'
        });
        return response.ok;
    } catch (error) {
        console.error('Health check failed:', error);
        return false;
    }
}

// Helper: extract a numeric price from user text
export function extractPrice(text) {
    const match = text.match(/\$?\s?(\d+(?:\.\d{1,2})?)/);
    return match ? parseFloat(match[1]) : null;
}

