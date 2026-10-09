const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const AUTH_API_URL = import.meta.env.VITE_AUTH_API_URL || 'http://localhost:8000';

// ============================================================
// Auth API
// ============================================================

export async function registerUser(fullName, email, password) {
  const response = await fetch(`${AUTH_API_URL}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ full_name: fullName, email, password }),
  });
  const data = await response.json();
  if (!response.ok) {
    // Handle validation errors (422) with details array
    if (data.details && Array.isArray(data.details)) {
      const msgs = data.details.map(d => d.message).join('; ');
      throw new Error(msgs || data.message || 'Registration failed');
    }
    throw new Error(data.detail || data.message || 'Registration failed');
  }
  return data;
}

export async function loginUser(email, password) {
  const response = await fetch(`${AUTH_API_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.detail || data.message || 'Login failed');
  }
  return data;
}

export async function getMe(token) {
  const response = await fetch(`${AUTH_API_URL}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.detail || 'Unauthorized');
  }
  return data;
}

// Auth token helpers
export function saveAuthToken(token) {
  localStorage.setItem('trademind_token', token);
}

export function getAuthToken() {
  return localStorage.getItem('trademind_token');
}

export function saveAuthUser(user) {
  localStorage.setItem('trademind_user', JSON.stringify(user));
}

export function getAuthUser() {
  try {
    const u = localStorage.getItem('trademind_user');
    return u ? JSON.parse(u) : null;
  } catch { return null; }
}

export function logout() {
  localStorage.removeItem('trademind_token');
  localStorage.removeItem('trademind_user');
}

export function isAuthenticated() {
  return !!getAuthToken();
}

export async function checkSession(sessionId) {
  const response = await fetch(`${API_URL}/api/session/${sessionId}`);
  return response.json();
}

export async function submitReport(sessionId, payload) {
  const response = await fetch(`${API_URL}/api/report`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ sessionId, payload })
  });
  return response.json();
}

export async function getAuthorityReports() {
  const response = await fetch(`${API_URL}/api/authority/reports`);
  return response.json();
}

export async function decryptReport(reportId) {
  const response = await fetch(`${API_URL}/api/authority/decrypt/${reportId}`, {
    method: 'POST'
  });
  return response.json();
}

export async function verifyReport(reportId, rewardAmount = '0.005') {
  const response = await fetch(`${API_URL}/api/authority/verify/${reportId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ rewardAmount })
  });
  return response.json();
}

export async function rejectReport(reportId) {
  const response = await fetch(`${API_URL}/api/authority/reject/${reportId}`, {
    method: 'POST'
  });
  return response.json();
}

export async function getAuthorityStats() {
  const response = await fetch(`${API_URL}/api/authority/stats`);
  return response.json();
}

// Reporter API functions
export async function createSession(walletAddress) {
  const response = await fetch(`${API_URL}/api/reporter/session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ walletAddress })
  });
  return response.json();
}

export async function getReporterStats(walletAddress) {
  const response = await fetch(`${API_URL}/api/reporter/stats/${walletAddress}`);
  return response.json();
}

export async function getReporterReports(walletAddress, limit = 10) {
  const response = await fetch(`${API_URL}/api/reporter/reports/${walletAddress}?limit=${limit}`);
  return response.json();
}

// export async function getReputationData(walletAddress) {
//   const response = await fetch(`${API_URL}/api/reporter/reputation/${walletAddress}`);
//   return response.json();
// }

export async function getWalletData(walletAddress) {
  const response = await fetch(`${API_URL}/api/reporter/wallet/${walletAddress}`);
  return response.json();
}

export async function claimRewards(walletAddress) {
  const response = await fetch(`${API_URL}/api/reporter/claim-rewards`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ walletAddress })
  });
  return response.json();
}

// Jury API functions
export async function getJuryReports() {
  const response = await fetch(`${API_URL}/api/jury/cases`);
  return response.json();
}

export async function submitJuryVote(reportId, vote, walletAddress) {
  const response = await fetch(`${API_URL}/api/jury/vote/${reportId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ vote, walletAddress })
  });
  return response.json();
}

export async function getJuryStats(walletAddress) {
  const response = await fetch(`${API_URL}/api/jury/stats/${walletAddress}`);
  return response.json();
}

export async function getUserJuryVotes(walletAddress) {
  const response = await fetch(`${API_URL}/api/jury/user-votes/${walletAddress}`);
  return response.json();
}

export async function getReputationData(walletAddress) {
  const response = await fetch(`${API_URL}/api/reputation/${walletAddress}`);
  return response.json();
}

// ============================================================
// Business Analytics API
// ============================================================

const ANALYTICS_API_URL = import.meta.env.VITE_ANALYTICS_API_URL || 'http://localhost:8000/api/v1';

export async function calculateAnalytics(data) {
  const response = await fetch(`${ANALYTICS_API_URL}/analytics/calculate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    let message = 'Calculation failed';
    // Custom backend format: { details: [...] } with field/message/type
    if (Array.isArray(err.details)) {
      message = err.details.map(e => `${e.field || 'unknown'}: ${e.message}`).join('; ');
      // Standard FastAPI format: { detail: [...] }
    } else if (Array.isArray(err.detail)) {
      message = err.detail.map(e => `${(e.loc || []).slice(1).join('.')}: ${e.msg}`).join('; ');
    } else if (err.message) {
      message = err.message;
    } else if (typeof err.detail === 'string') {
      message = err.detail;
    }
    throw new Error(message);
  }
  return response.json();
}

export async function simulateAnalytics(data) {
  const response = await fetch(`${ANALYTICS_API_URL}/analytics/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'Simulation failed' }));
    let message = 'Simulation failed';
    if (Array.isArray(err.detail)) {
      message = err.detail.map(e => `${(e.loc || []).slice(1).join('.')}: ${e.msg}`).join('; ');
    } else if (typeof err.detail === 'string') {
      message = err.detail;
    }
    throw new Error(message);
  }
  return response.json();
}

export async function getCompetitiveAnalysis(data) {
  const response = await fetch(`${ANALYTICS_API_URL}/analytics/competitive-analysis`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'Competitive analysis failed' }));
    let message = 'Competitive analysis failed';
    if (Array.isArray(err.detail)) {
      message = err.detail.map(e => `${(e.loc || []).slice(1).join('.')}: ${e.msg}`).join('; ');
    } else if (typeof err.detail === 'string') {
      message = err.detail;
    }
    throw new Error(message);
  }
  return response.json();
}

export async function getAnalyticsHealth() {
  const response = await fetch(`${ANALYTICS_API_URL}/analytics/health`);
  return response.json();
}

export async function getAnalyticsSchema() {
  const response = await fetch(`${ANALYTICS_API_URL}/analytics/schema`);
  return response.json();
}

// ============================================================
// Dashboard API (real-time negotiation dashboard)
// ============================================================

export async function getDashboardSummary() {
  const token = getAuthToken();
  if (!token) throw new Error('AUTH_REQUIRED');
  const response = await fetch(`${AUTH_API_URL}/api/v1/chat-sessions/dashboard/summary`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status === 401) throw new Error('AUTH_REQUIRED');
  if (!response.ok) throw new Error('Failed to fetch dashboard');
  return response.json();
}

export async function exportSession(sessionId) {
  const token = getAuthToken();
  const response = await fetch(`${AUTH_API_URL}/api/v1/chat-sessions/${sessionId}/export`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error('Failed to export session');
  return response.json();
}

export async function getCallbackRequests() {
  const token = getAuthToken();
  const response = await fetch(`${AUTH_API_URL}/api/v1/chat-sessions/callback-requests`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error('Failed to fetch callback requests');
  return response.json();
}

// ============================================================
// Email Settings API
// ============================================================

export async function getEmailSettings() {
  const token = getAuthToken();
  const response = await fetch(`${AUTH_API_URL}/api/v1/email/settings`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error('Failed to fetch email settings');
  return response.json();
}

export async function updateEmailSettings(settings) {
  const token = getAuthToken();
  const response = await fetch(`${AUTH_API_URL}/api/v1/email/settings`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(settings),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'Failed to update email settings' }));
    throw new Error(err.detail || 'Failed to update email settings');
  }
  return response.json();
}

export async function sendTestEmail(toEmail = null) {
  const token = getAuthToken();
  const response = await fetch(`${AUTH_API_URL}/api/v1/email/test`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ to_email: toEmail }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'Failed to send test email' }));
    throw new Error(err.detail || 'Failed to send test email');
  }
  return response.json();
}

// ============================================================
// Assist & Live Meetings API
// ============================================================

export async function getAssist(payload) {
  const token = getAuthToken();
  const response = await fetch(`${AUTH_API_URL}/api/v1/negotiate/assist`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'Assist request failed' }));
    throw new Error(err.detail || 'Assist request failed');
  }
  return response.json();
}

export async function createMeeting(data) {
  const token = getAuthToken();
  const response = await fetch(`${AUTH_API_URL}/api/v1/meetings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'Failed to create meeting' }));
    throw new Error(err.detail || 'Failed to create meeting');
  }
  return response.json();
}

export async function listMeetings(status = null) {
  const token = getAuthToken();
  const url = status
    ? `${AUTH_API_URL}/api/v1/meetings?status=${encodeURIComponent(status)}`
    : `${AUTH_API_URL}/api/v1/meetings`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'Failed to list meetings' }));
    throw new Error(err.detail || 'Failed to list meetings');
  }
  return response.json();
}

export async function getMeetingByToken(meetingToken) {
  const token = getAuthToken();
  const response = await fetch(`${AUTH_API_URL}/api/v1/meetings/by-token/${meetingToken}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'Failed to get meeting' }));
    throw new Error(err.detail || 'Failed to get meeting');
  }
  return response.json();
}

export async function patchMeeting(meetingId, data) {
  const token = getAuthToken();
  const response = await fetch(`${AUTH_API_URL}/api/v1/meetings/${meetingId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'Failed to update meeting' }));
    throw new Error(err.detail || 'Failed to update meeting');
  }
  return response.json();
}

export async function startMeeting(meetingId) {
  const token = getAuthToken();
  const response = await fetch(`${AUTH_API_URL}/api/v1/meetings/${meetingId}/start`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'Failed to start meeting' }));
    throw new Error(err.detail || 'Failed to start meeting');
  }
  return response.json();
}

export async function endMeeting(meetingId, data = {}) {
  const token = getAuthToken();
  const response = await fetch(`${AUTH_API_URL}/api/v1/meetings/${meetingId}/end`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'Failed to end meeting' }));
    throw new Error(err.detail || 'Failed to end meeting');
  }
  return response.json();
}

export async function patchCallbackStatus(cbId, status) {
  const token = getAuthToken();
  const response = await fetch(`${AUTH_API_URL}/api/v1/chat-sessions/callback-requests/${cbId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ status }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'Failed to update callback status' }));
    throw new Error(err.detail || 'Failed to update callback status');
  }
  return response.json();
}
