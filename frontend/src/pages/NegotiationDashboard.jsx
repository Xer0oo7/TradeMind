import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle, XCircle, Clock,
  DollarSign, RefreshCw, Download, Eye, X, MessageSquare, ArrowUpRight,
  ArrowDownRight, Activity, Loader2, ChevronDown, ChevronUp,
  Search, Phone
} from 'lucide-react';
import Layout from '../components/Layout';
import NeoCard from '../components/NeoCard';
import { getDashboardSummary, exportSession, getCallbackRequests } from '../lib/api';
import { createMeeting, listMeetings, patchCallbackStatus } from '../lib/api';
import { Video, Calendar, Share2, Copy, Check, QrCode } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

const STATUS_CONFIG = {
  accepted:    { label: 'Accepted',    color: 'bg-neo-teal',    text: 'text-neo-cream', icon: CheckCircle  },
  rejected:    { label: 'Rejected',    color: 'bg-neo-maroon',  text: 'text-neo-cream', icon: XCircle      },
  active:      { label: 'Active',      color: 'bg-neo-orange',  text: 'text-neo-navy',  icon: Activity     },
  expired:     { label: 'Expired',     color: 'bg-neo-navy/20', text: 'text-neo-navy',  icon: Clock        },
  walked_away: { label: 'Walked Away', color: 'bg-neo-navy/30', text: 'text-neo-navy',  icon: ArrowUpRight },
};

export default function NegotiationDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState('closed_at');
  const [sortDir, setSortDir] = useState('desc');

  const [chatModal, setChatModal] = useState(null);
  const [chatLoading, setChatLoading] = useState(false);
  const [exporting, setExporting] = useState({});
  const [callbacksModal, setCallbacksModal] = useState(false);
  const [allCallbacks, setAllCallbacks] = useState([]);
  const [callbacksLoading, setCallbacksLoading] = useState(false);
  const [modalTab, setModalTab] = useState('callbacks');
  const [allMeetings, setAllMeetings] = useState([]);
  const [meetingsLoading, setMeetingsLoading] = useState(false);
  const [scheduleModalData, setScheduleModalData] = useState(null);
  const [shareModalData, setShareModalData] = useState(null);
  const [scheduleTime, setScheduleTime] = useState('');
  const [actionLoading, setActionLoading] = useState({});
  const [copiedLink, setCopiedLink] = useState(false);

  const fetchMeetings = useCallback(async () => {
    setMeetingsLoading(true);
    try {
      const list = await listMeetings();
      setAllMeetings(list);
    } catch (e) {
      console.error('Failed to load meetings:', e);
    } finally {
      setMeetingsLoading(false);
    }
  }, []);

  const handleStartInstantMeeting = async (cb) => {
    setActionLoading((p) => ({ ...p, [cb.id]: true }));
    try {
      const meeting = await createMeeting({
        callback_id: cb.id,
        product_name: cb.product_name,
        buyer_phone: cb.phone_number,
        instant: true,
      });
      navigate(`/live/${meeting.room_token}`);
    } catch (err) {
      alert(`Failed to start meeting: ${err.message}`);
    } finally {
      setActionLoading((p) => ({ ...p, [cb.id]: false }));
    }
  };

  const handleConfirmSchedule = async () => {
    if (!scheduleModalData || !scheduleTime) return;
    try {
      await createMeeting({
        callback_id: scheduleModalData.id,
        product_name: scheduleModalData.product_name,
        buyer_phone: scheduleModalData.phone_number,
        meeting_time: new Date(scheduleTime).toISOString(),
        instant: false,
      });
      setScheduleModalData(null);
      setScheduleTime('');
      const data = await getCallbackRequests();
      setAllCallbacks(data);
      fetchMeetings();
    } catch (err) {
      alert(`Failed to schedule meeting: ${err.message}`);
    }
  };

  const handleStatusChange = async (cbId, newStatus) => {
    try {
      await patchCallbackStatus(cbId, newStatus);
      setAllCallbacks((prev) =>
        prev.map((c) => (c.id === cbId ? { ...c, status: newStatus } : c))
      );
    } catch (err) {
      alert(`Failed to update status: ${err.message}`);
    }
  };

  const fetchDashboard = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setRefreshing(true);
    else setLoading(true);
    try {
      const result = await getDashboardSummary();
      setData(result);
      setLastRefresh(new Date());
      setError(null);
    } catch (err) {
      if (err.message === 'AUTH_REQUIRED') {
        navigate('/login', { replace: true });
        return;
      }
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchDashboard(); }, [fetchDashboard]);

  // Close modals on Escape key
  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === 'Escape') {
        if (chatModal) setChatModal(null);
        if (callbacksModal) setCallbacksModal(false);
      }
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [chatModal, callbacksModal]);
  useEffect(() => {
    const timer = setInterval(() => fetchDashboard(true), 30000);
    return () => clearInterval(timer);
  }, [fetchDashboard]);

  const handleViewChat = async (sessionId) => {
    setChatLoading(true);
    try {
      const session = await exportSession(sessionId);
      setChatModal(session);
    } catch (err) {
      console.error('Failed to view chat:', err);
    }
    setChatLoading(false);
  };

  const handleExport = async (sessionId, format = 'json') => {
    const key = format === 'csv' ? `csv-${sessionId}` : sessionId;
    setExporting(p => ({ ...p, [key]: true }));
    try {
      const session = await exportSession(sessionId);
      let blob, filename;
      if (format === 'csv') {
        const msgs = session.messages || [];
        const cb = session.callback;
        const header = 'Round,Buyer Message,Bot Reply,Offered Price,Counter Price,Decision,Time\n';
        const rows = msgs.map(m =>
          `${m.round_number},"${(m.user_message || '').replace(/"/g, '""')}","${(m.bot_reply || '').replace(/"/g, '""')}",${m.offered_price || ''},${m.counter_price || ''},${m.decision || ''},${m.created_at || ''}`
        ).join('\n');
        let csvContent = header + rows;
        if (cb?.phone_number) {
          csvContent += '\n\nCallback Details\n';
          csvContent += `Phone Number,"${cb.phone_number}"\n`;
          csvContent += `Status,"${cb.negotiation_status || ''}"\n`;
          csvContent += `Requested At,"${cb.cb_created_at || ''}"\n`;
        }
        blob = new Blob([csvContent], { type: 'text/csv' });
        filename = `session-${sessionId}.csv`;
      } else {
        blob = new Blob([JSON.stringify(session, null, 2)], { type: 'application/json' });
        filename = `session-${sessionId}.json`;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to export session:', err);
    }
    setExporting(p => ({ ...p, [key]: false }));
  };

  const getFilteredSessions = () => {
    if (!data) return [];
    let list = [...data.closed_sessions];
    if (statusFilter !== 'all') list = list.filter(s => s.status === statusFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(s => s.product_name?.toLowerCase().includes(q));
    }
    list.sort((a, b) => {
      let va = a[sortField] ?? '', vb = b[sortField] ?? '';
      if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      return sortDir === 'asc' ? va - vb : vb - va;
    });
    return list;
  };

  const toggleSort = (field) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const SortIcon = ({ field }) => {
    if (sortField !== field) return <ChevronDown className="w-3 h-3 opacity-20" />;
    return sortDir === 'asc' ? <ChevronUp className="w-3 h-3 text-neo-orange" /> : <ChevronDown className="w-3 h-3 text-neo-orange" />;
  };

  if (loading && !data) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="w-8 h-8 animate-spin text-neo-navy" />
          <span className="ml-3 font-bold text-neo-navy">Loading dashboard...</span>
        </div>
      </Layout>
    );
  }

  const s = data?.summary || {};
  const acceptRate = s.total > 0 ? ((s.accepted / s.total) * 100).toFixed(1) : 0;
  const filteredSessions = getFilteredSessions();

  return (
    <Layout>
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="bg-neo-navy border-b-[3px] border-neo-navy">
        <div className="container mx-auto px-4">
          <div className="max-w-6xl mx-auto flex items-center justify-between py-4">
            <h1 className="text-xl sm:text-2xl font-heading font-bold text-neo-cream">
              Dashboard
            </h1>
            <div className="flex items-center gap-3">
              {lastRefresh && (
                <span className="text-[10px] text-neo-cream/40 font-mono hidden sm:block">
                  {lastRefresh.toLocaleTimeString()}
                </span>
              )}
              <button
                onClick={() => fetchDashboard(true)}
                disabled={refreshing}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase bg-neo-navy text-neo-cream border-[2px] border-neo-navy hover:bg-neo-orange hover:border-neo-orange transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Main Content ──────────────────────────────────── */}
      <section className="py-6 bg-neo-cream min-h-[70vh]">
        <div className="container mx-auto px-4">
          <div className="max-w-6xl mx-auto">

            {error && (
              <div className="bg-neo-maroon text-neo-cream border-[3px] border-neo-navy p-3 mb-5 flex items-center justify-between text-sm font-bold">
                <span>{error}</span>
                <button onClick={() => fetchDashboard()} className="px-3 py-1 bg-neo-orange text-neo-navy text-xs font-bold border-[2px] border-neo-navy">Retry</button>
              </div>
            )}

            {/* ── Stats Cards ──────────────────────────────── */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              {[
                { val: s.total || 0,       label: 'Total',    accent: 'border-neo-navy'  },
                { val: s.accepted || 0,     label: 'Accepted', accent: 'border-neo-teal'  },
                { val: s.rejected || 0,     label: 'Rejected', accent: 'border-neo-maroon'},
                { val: `${acceptRate}%`,    label: 'Accept Rate', accent: 'border-neo-orange' },
              ].map((item, i) => (
                <div key={i} className={`bg-white border-[3px] ${item.accent} p-4`}>
                  <p className="text-2xl sm:text-3xl font-heading font-bold text-neo-navy">{item.val}</p>
                  <p className="text-[11px] text-neo-navy/50 uppercase font-bold tracking-wide mt-1">{item.label}</p>
                </div>
              ))}
            </div>

            {/* ── Revenue + Avg Deal + Rounds row ──────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
              <div className="bg-neo-navy border-[3px] border-neo-navy p-4 flex items-center gap-3">
                <DollarSign className="w-6 h-6 text-neo-orange flex-shrink-0" />
                <div>
                  <p className="text-lg sm:text-xl font-heading font-bold text-neo-cream">
                    ₹{(s.total_revenue || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                  </p>
                  <p className="text-[10px] text-neo-cream/40 uppercase font-bold">Total Revenue</p>
                </div>
              </div>
              <div className="bg-white border-[3px] border-neo-navy p-4 flex items-center gap-3">
                <ArrowUpRight className="w-6 h-6 text-neo-teal flex-shrink-0" />
                <div>
                  <p className="text-lg sm:text-xl font-heading font-bold text-neo-navy">
                    ₹{(s.best_deal || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                  </p>
                  <p className="text-[10px] text-neo-navy/40 uppercase font-bold">Best Deal</p>
                </div>
              </div>
              <button
                onClick={async () => {
                  setCallbacksModal(true);
                  setCallbacksLoading(true);
                  try {
                    const data = await getCallbackRequests();
                    setAllCallbacks(data);
                  } catch { setAllCallbacks([]); }
                  setCallbacksLoading(false);
                }}
                className="bg-neo-orange border-[3px] border-neo-navy p-4 flex items-center gap-3 w-full text-left hover:translate-x-[1px] hover:translate-y-[1px] transition-all cursor-pointer group"
              >
                <Phone className="w-6 h-6 text-neo-navy flex-shrink-0 group-hover:scale-110 transition-transform" />
                <div>
                  <p className="text-lg sm:text-xl font-heading font-bold text-neo-navy">
                    Callback Requests
                  </p>
                  <p className="text-[10px] text-neo-navy/60 uppercase font-bold">Click to view all</p>
                </div>
              </button>
            </div>

            {/* ── Negotiation History ──────────────────────── */}
            <div>
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-3">
                <h2 className="font-heading font-bold text-neo-navy text-sm uppercase tracking-wider">
                  History
                </h2>
                <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap overflow-x-auto">
                  <div className="relative flex-shrink-0">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-neo-navy/30" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      placeholder="Search..."
                      className="pl-8 pr-3 py-1.5 text-xs border-[2px] border-neo-navy/15 bg-white focus:border-neo-orange outline-none w-36 font-mono"
                    />
                  </div>
                  <div className="flex gap-1 overflow-x-auto flex-shrink-0">
                    {['all', 'accepted', 'rejected', 'expired', 'walked_away'].map(f => (
                      <button
                        key={f}
                        onClick={() => setStatusFilter(f)}
                        className={`px-2 py-1 text-[10px] font-bold uppercase border-[2px] transition-all ${
                          statusFilter === f
                            ? 'bg-neo-navy text-neo-cream border-neo-navy'
                            : 'bg-white text-neo-navy/40 border-neo-navy/10 hover:border-neo-navy/30'
                        }`}
                      >
                        {f === 'all' ? 'All' : f.replace('_', ' ')}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="bg-white border-[3px] border-neo-navy overflow-hidden">
                {/* Table header */}
                <div className="overflow-x-auto">
                <div className="bg-neo-navy grid grid-cols-[2fr_0.8fr_1fr_1fr_0.6fr_0.8fr] min-w-[600px] text-[10px] font-bold uppercase tracking-wider text-neo-cream/50">
                  {[
                    { field: 'product_name', label: 'Product' },
                    { field: 'status',       label: 'Status'  },
                    { field: 'base_price',   label: 'Base'    },
                    { field: 'final_price',  label: 'Final'   },
                    { field: 'rounds_used',  label: 'Rounds'  },
                    { field: null,           label: 'Actions' },
                  ].map((col, i) => (
                    <button
                      key={i}
                      onClick={() => col.field && toggleSort(col.field)}
                      className={`px-3 py-2.5 text-left flex items-center gap-1 ${col.field ? 'hover:text-neo-cream cursor-pointer' : 'cursor-default'} transition-colors`}
                    >
                      {col.label}
                      {col.field && <SortIcon field={col.field} />}
                    </button>
                  ))}
                </div>

                {/* Rows */}
                {filteredSessions.length === 0 ? (
                  <div className="p-10 text-center text-neo-navy/30">
                    <p className="text-sm font-bold">No sessions found</p>
                  </div>
                ) : (
                  filteredSessions.map((session, idx) => {
                    const sc = STATUS_CONFIG[session.status] || STATUS_CONFIG.expired;
                    const StatusIcon = sc.icon;
                    const discount = session.base_price && session.final_price
                      ? (((session.base_price - session.final_price) / session.base_price) * 100).toFixed(1)
                      : null;

                    return (
                      <div
                        key={session.id}
                        className={`grid grid-cols-[2fr_0.8fr_1fr_1fr_0.6fr_1fr] min-w-[600px] items-center text-xs border-b last:border-b-0 border-neo-navy/5 ${
                          idx % 2 === 0 ? 'bg-white' : 'bg-neo-cream/30'
                        } hover:bg-neo-orange/5 transition-colors`}
                      >
                        {/* Product */}
                        <div className="px-3 py-3 font-bold text-neo-navy truncate">
                          {session.product_name}
                        </div>
                        {/* Status */}
                        <div className="px-3 py-3">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[9px] font-bold uppercase ${sc.color} ${sc.text}`}>
                            <StatusIcon className="w-3 h-3" />
                            {sc.label}
                          </span>
                        </div>
                        {/* Base */}
                        <div className="px-3 py-3 font-mono text-neo-navy/50">
                          ₹{(session.base_price || 0).toLocaleString('en-IN')}
                        </div>
                        {/* Final */}
                        <div className="px-3 py-3">
                          {session.final_price ? (
                            <span className="font-mono font-bold text-neo-navy">
                              ₹{session.final_price.toLocaleString('en-IN')}
                              {discount && parseFloat(discount) > 0 && (
                                <span className="ml-1 text-[9px] font-bold text-neo-maroon">
                                  <ArrowDownRight className="w-2.5 h-2.5 inline" />{discount}%
                                </span>
                              )}
                              {discount && parseFloat(discount) < 0 && (
                                <span className="ml-1 text-[9px] font-bold text-neo-teal">
                                  <ArrowUpRight className="w-2.5 h-2.5 inline" />{Math.abs(parseFloat(discount))}%
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className="text-neo-navy/20">—</span>
                          )}
                        </div>
                        {/* Rounds */}
                        <div className="px-3 py-3 font-mono text-neo-navy/50 text-center">
                          {session.rounds_used || 0}
                        </div>
                        {/* Actions */}
                        <div className="px-3 py-3 flex items-center gap-1.5">
                          <button onClick={() => handleViewChat(session.id)} className="p-1.5 border-[2px] border-neo-navy/10 hover:border-neo-teal hover:bg-neo-teal/10 transition-colors group" title="View Chat">
                            <Eye className="w-3.5 h-3.5 text-neo-navy/30 group-hover:text-neo-teal" />
                          </button>
                          <button onClick={() => handleExport(session.id)} disabled={exporting[session.id]} className="p-1.5 border-[2px] border-neo-navy/10 hover:border-neo-orange hover:bg-neo-orange/10 transition-colors group" title="Export JSON">
                            {exporting[session.id] ? <Loader2 className="w-3.5 h-3.5 animate-spin text-neo-navy/30" /> : <Download className="w-3.5 h-3.5 text-neo-navy/30 group-hover:text-neo-orange" />}
                          </button>
                          <button onClick={() => handleExport(session.id, 'csv')} disabled={exporting[`csv-${session.id}`]} className="p-1.5 border-[2px] border-neo-navy/10 hover:border-neo-navy hover:bg-neo-navy/10 transition-colors text-[8px] font-bold text-neo-navy/30 hover:text-neo-navy" title="Export CSV">
                            CSV
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
                </div>
              </div>

              <p className="text-[10px] text-neo-navy/30 mt-2 text-right">
                {filteredSessions.length} of {data?.closed_sessions?.length || 0} sessions
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Chat Modal ─────────────────────────────────────── */}
      {(chatModal || chatLoading) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => !chatLoading && setChatModal(null)}>
          <div className="absolute inset-0 bg-neo-navy/60 backdrop-blur-sm" />
          <div className="relative bg-neo-cream border-[4px] border-neo-navy w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            {chatLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-8 h-8 animate-spin text-neo-navy" />
              </div>
            ) : chatModal && (
              <>
                {/* Header */}
                <div className="bg-neo-navy p-4 flex items-center justify-between flex-shrink-0">
                  <div>
                    <h3 className="font-heading font-bold text-neo-cream text-sm">{chatModal.product_name}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[9px] font-bold uppercase ${STATUS_CONFIG[chatModal.status]?.color || 'bg-neo-navy/20'} ${STATUS_CONFIG[chatModal.status]?.text || 'text-neo-navy'}`}>
                        {chatModal.status}
                      </span>
                      <span className="text-[10px] text-neo-cream/40 font-mono">Session {chatModal.id} · {chatModal.rounds_used || 0} rounds</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => handleExport(chatModal.id)} className="p-2 bg-neo-cream/10 hover:bg-neo-cream/20 text-neo-cream transition-colors">
                      <Download className="w-4 h-4" />
                    </button>
                    <button onClick={() => setChatModal(null)} className="p-2 bg-neo-cream/10 hover:bg-neo-maroon text-neo-cream transition-colors">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Price info */}
                <div className="bg-neo-teal/10 border-b-[2px] border-neo-navy/10 px-4 py-2 grid grid-cols-3 gap-3 text-[10px] flex-shrink-0">
                  <div>
                    <span className="text-neo-navy/40 uppercase font-bold">Base</span>
                    <p className="font-mono font-bold text-neo-navy">₹{(chatModal.base_price || 0).toLocaleString('en-IN')}</p>
                  </div>
                  <div>
                    <span className="text-neo-navy/40 uppercase font-bold">Final</span>
                    <p className="font-mono font-bold text-neo-teal">₹{(chatModal.final_price || 0).toLocaleString('en-IN')}</p>
                  </div>
                  <div>
                    <span className="text-neo-navy/40 uppercase font-bold">Min Price</span>
                    <p className="font-mono font-bold text-neo-maroon">₹{(chatModal.min_price || 0).toLocaleString('en-IN')}</p>
                  </div>
                </div>

                {/* Callback banner (if present) */}
                {chatModal.callback && chatModal.callback.phone_number && (
                  <div className="bg-neo-teal/10 border-b-[2px] border-neo-teal/30 px-4 py-2 flex items-center justify-between flex-shrink-0">
                    <div className="flex items-center gap-2">
                      <Phone className="w-3.5 h-3.5 text-neo-teal" />
                      <span className="text-[10px] font-bold uppercase text-neo-teal">Callback Requested</span>
                    </div>
                    <a
                      href={`tel:${chatModal.callback.phone_number}`}
                      className="flex items-center gap-1 text-[10px] font-bold text-neo-navy font-mono hover:text-neo-teal transition-colors"
                    >
                      <Phone className="w-3 h-3" />
                      {chatModal.callback.phone_number}
                    </a>
                  </div>
                )}

                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {(!chatModal.messages || chatModal.messages.length === 0) ? (
                    <div className="text-center text-neo-navy/30 py-8">
                      <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      <p className="text-sm font-bold">No messages recorded</p>
                    </div>
                  ) : (
                    chatModal.messages.map((msg, i) => (
                      <div key={i} className="space-y-2">
                        {(i === 0 || msg.round_number !== chatModal.messages[i - 1]?.round_number) && (
                          <div className="flex items-center gap-2 my-2">
                            <div className="flex-1 h-[1px] bg-neo-navy/10" />
                            <span className="text-[9px] font-bold uppercase text-neo-navy/30 px-2">Round {msg.round_number}</span>
                            <div className="flex-1 h-[1px] bg-neo-navy/10" />
                          </div>
                        )}
                        {msg.user_message && (
                          <div className="flex justify-start">
                            <div className="max-w-[75%] bg-white border-[2px] border-neo-navy/10 p-3">
                              <p className="text-[10px] font-bold text-neo-navy/40 mb-1">Buyer</p>
                              <p className="text-xs text-neo-navy">{msg.user_message}</p>
                              {msg.offered_price && (
                                <p className="text-[10px] font-mono font-bold text-neo-teal mt-1">Offered: ₹{msg.offered_price.toLocaleString('en-IN')}</p>
                              )}
                            </div>
                          </div>
                        )}
                        {msg.bot_reply && (
                          <div className="flex justify-end">
                            <div className="max-w-[75%] bg-neo-navy text-neo-cream border-[2px] border-neo-navy p-3">
                              <p className="text-[10px] font-bold text-neo-cream/50 mb-1">Bot</p>
                              <p className="text-xs">{msg.bot_reply}</p>
                              {msg.counter_price && (
                                <p className="text-[10px] font-mono font-bold text-neo-orange mt-1">Counter: ₹{msg.counter_price.toLocaleString('en-IN')}</p>
                              )}
                              {msg.decision && (
                                <span className={`inline-block mt-1 px-2 py-0.5 text-[9px] font-bold uppercase ${
                                  msg.decision === 'accept' ? 'bg-neo-teal/30 text-neo-teal' :
                                  msg.decision === 'reject' ? 'bg-neo-maroon/30 text-neo-maroon' :
                                  'bg-neo-cream/10 text-neo-cream/60'
                                }`}>
                                  {msg.decision}
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>

                {/* Footer */}
                <div className="bg-neo-navy/5 border-t-[2px] border-neo-navy/10 px-4 py-2 flex items-center justify-between flex-shrink-0">
                  <span className="text-[10px] text-neo-navy/30 font-mono">
                    {chatModal.messages?.length || 0} msgs
                  </span>
                  <div className="flex gap-2">
                    <button onClick={() => handleExport(chatModal.id, 'csv')} className="text-[10px] font-bold uppercase text-neo-navy/40 hover:text-neo-navy px-3 py-1 border-[2px] border-neo-navy/10 hover:border-neo-navy/30 transition-colors">CSV</button>
                    <button onClick={() => handleExport(chatModal.id)} className="text-[10px] font-bold uppercase text-neo-navy/40 hover:text-neo-navy px-3 py-1 border-[2px] border-neo-navy/10 hover:border-neo-navy/30 transition-colors">JSON</button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── All Callback Requests Modal ──────────────────── */}
      {callbacksModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setCallbacksModal(false)}>
          <div className="absolute inset-0 bg-neo-navy/60 backdrop-blur-sm" />
          <div className="relative bg-neo-cream border-[4px] border-neo-navy w-full max-w-2xl max-h-[85vh] flex flex-col shadow-neo" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="bg-neo-navy p-4 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-neo-teal/20 border-[2px] border-neo-teal flex items-center justify-center">
                  <Phone className="w-4 h-4 text-neo-teal" />
                </div>
                <div>
                  <h3 className="font-heading font-bold text-neo-cream text-sm">Callback Requests</h3>
                  <p className="text-[10px] text-neo-cream/40 font-mono">{allCallbacks.length} request{allCallbacks.length !== 1 ? 's' : ''}</p>
                </div>
              </div>
              <button onClick={() => setCallbacksModal(false)} className="p-2 bg-neo-cream/10 hover:bg-neo-maroon text-neo-cream transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Tabs: Callbacks | Meetings */}
            <div className="flex border-b-[2px] border-neo-navy bg-white flex-shrink-0">
              <button
                type="button"
                onClick={() => setModalTab('callbacks')}
                className={`px-4 py-2 text-xs font-heading font-bold uppercase transition-colors border-r-[2px] border-neo-navy ${
                  modalTab === 'callbacks' ? 'bg-neo-orange text-neo-navy' : 'text-neo-navy/60 hover:bg-neo-cream'
                }`}
              >
                Callbacks ({allCallbacks.length})
              </button>
              <button
                type="button"
                onClick={() => {
                  setModalTab('meetings');
                  fetchMeetings();
                }}
                className={`px-4 py-2 text-xs font-heading font-bold uppercase transition-colors ${
                  modalTab === 'meetings' ? 'bg-neo-orange text-neo-navy' : 'text-neo-navy/60 hover:bg-neo-cream'
                }`}
              >
                Meetings ({allMeetings.length})
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {modalTab === 'meetings' && (
                meetingsLoading ? (
                  <div className="flex items-center justify-center py-16">
                    <Loader2 className="w-8 h-8 animate-spin text-neo-navy" />
                  </div>
                ) : allMeetings.length === 0 ? (
                  <div className="text-center py-12">
                    <Calendar className="w-10 h-10 mx-auto mb-3 text-neo-navy/15" />
                    <p className="font-bold text-neo-navy/40 text-sm">No meetings scheduled yet</p>
                    <p className="text-[10px] text-neo-navy/25 mt-1">Schedule a meeting from the Callbacks tab</p>
                  </div>
                ) : (
                  allMeetings.map((m) => (
                    <div key={m.id} className="bg-white border-[3px] border-neo-navy/10 hover:border-neo-orange/50 transition-colors p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-heading font-bold text-neo-navy text-sm">{m.product_name || 'Meeting'}</p>
                          <span className={`px-1.5 py-0.5 text-[9px] font-bold uppercase border border-neo-navy ${
                            m.status === 'live' ? 'bg-neo-teal text-neo-cream animate-pulse' :
                            m.status === 'scheduled' ? 'bg-neo-orange text-neo-navy' :
                            m.status === 'ended' ? 'bg-neo-navy text-neo-cream' :
                            'bg-neo-maroon text-neo-cream'
                          }`}>
                            {m.status}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-[10px] font-mono text-neo-navy/60">
                          {m.buyer_phone && <span>Phone: {m.buyer_phone}</span>}
                          {m.meeting_time && <span>Time: {new Date(m.meeting_time).toLocaleString()}</span>}
                          {m.started_at && <span>Started: {new Date(m.started_at).toLocaleTimeString()}</span>}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {m.status !== 'ended' && m.status !== 'cancelled' && (
                          <button
                            type="button"
                            onClick={() => {
                              navigate(`/live/${m.room_token}`);
                              setCallbacksModal(false);
                            }}
                            className="px-3 py-1.5 bg-neo-teal text-neo-cream font-heading font-bold text-xs uppercase border-[2px] border-neo-navy shadow-neo-sm hover:translate-x-[1px] hover:translate-y-[1px]"
                          >
                            Open Room
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setShareModalData(m)}
                          className="px-2.5 py-1.5 bg-white text-neo-navy border-[2px] border-neo-navy font-heading font-bold text-xs uppercase hover:bg-neo-cream"
                          title="Share Link"
                        >
                          <Share2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))
                )
              )}
              <div style={{ display: modalTab === 'meetings' ? 'none' : 'contents' }}>
              {callbacksLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="w-8 h-8 animate-spin text-neo-navy" />
                </div>
              ) : allCallbacks.length === 0 ? (
                <div className="text-center py-12">
                  <Phone className="w-10 h-10 mx-auto mb-3 text-neo-navy/15" />
                  <p className="font-bold text-neo-navy/40 text-sm">No callback requests yet</p>
                  <p className="text-[10px] text-neo-navy/25 mt-1">When buyers request a callback, they'll appear here</p>
                </div>
              ) : (
                allCallbacks.map((cb) => (
                  <div key={cb.id} className="bg-white border-[3px] border-neo-navy/10 hover:border-neo-teal/50 transition-colors">
                    <div className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                      {/* Phone + Call */}
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <div className="w-10 h-10 bg-neo-teal/10 border-[2px] border-neo-teal flex items-center justify-center flex-shrink-0">
                          <Phone className="w-4 h-4 text-neo-teal" />
                        </div>
                        <div>
                          <p className="font-heading font-bold text-neo-navy text-sm tracking-wide">{cb.phone_number}</p>
                          <a
                            href={`tel:${cb.phone_number}`}
                            className="inline-flex items-center gap-1 mt-0.5 text-[9px] font-bold uppercase text-neo-teal hover:text-neo-navy transition-colors"
                          >
                            <Phone className="w-2.5 h-2.5" />
                            Call Now
                          </a>
                        </div>
                      </div>

                      {/* Details */}
                      <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
                        <div>
                          <p className="uppercase font-bold text-neo-navy/40">Product</p>
                          <p className="font-bold text-neo-navy truncate">{cb.product_name || '—'}</p>
                        </div>
                        <div>
                          <p className="uppercase font-bold text-neo-navy/40">Status</p>
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                            (STATUS_CONFIG[cb.negotiation_status] || STATUS_CONFIG.expired).color
                          } ${(STATUS_CONFIG[cb.negotiation_status] || STATUS_CONFIG.expired).text}`}>
                            {cb.negotiation_status || cb.status || '—'}
                          </span>
                        </div>
                        <div>
                          <p className="uppercase font-bold text-neo-navy/40">Final Price</p>
                          <p className="font-mono font-bold text-neo-teal">{cb.final_price ? `₹${Number(cb.final_price).toLocaleString('en-IN')}` : '—'}</p>
                        </div>
                        <div>
                          <p className="uppercase font-bold text-neo-navy/40">Requested</p>
                          <p className="font-mono text-neo-navy/60">{cb.created_at ? new Date(cb.created_at).toLocaleDateString() : '—'}</p>
                        </div>
                      </div>

                      {/* View Chat */}
                      <button
                        onClick={() => { handleViewChat(cb.session_id); setCallbacksModal(false); }}
                        className="p-1.5 border-[2px] border-neo-navy/10 hover:border-neo-teal hover:bg-neo-teal/10 transition-colors flex-shrink-0 self-start"
                        title="View Chat"
                      >
                        <Eye className="w-3.5 h-3.5 text-neo-navy/30 hover:text-neo-teal" />
                      </button>

                      {/* Live Actions & Status Control */}
                      <div className="flex items-center gap-1.5 flex-wrap flex-shrink-0 self-start">
                        <select
                          value={cb.status || 'pending'}
                          onChange={(e) => handleStatusChange(cb.id, e.target.value)}
                          className="text-[10px] font-mono font-bold uppercase p-1 border-[2px] border-neo-navy bg-white outline-none cursor-pointer"
                          title="Update Status"
                        >
                          <option value="pending">Pending</option>
                          <option value="scheduled">Scheduled</option>
                          <option value="contacted">Contacted</option>
                          <option value="completed">Completed</option>
                          <option value="missed">Missed</option>
                        </select>

                        <button
                          type="button"
                          onClick={() => handleStartInstantMeeting(cb)}
                          disabled={actionLoading[cb.id]}
                          className="px-2 py-1 bg-neo-teal text-neo-cream font-heading font-bold text-[10px] uppercase border-[2px] border-neo-navy flex items-center gap-1 shadow-neo-sm hover:translate-x-[1px] hover:translate-y-[1px]"
                          title="Start Instant Live Chat"
                        >
                          <Video className="w-3 h-3" />
                          <span>Live</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setScheduleModalData(cb);
                            setScheduleTime('');
                          }}
                          className="px-2 py-1 bg-neo-orange text-neo-navy font-heading font-bold text-[10px] uppercase border-[2px] border-neo-navy flex items-center gap-1 shadow-neo-sm hover:translate-x-[1px] hover:translate-y-[1px]"
                          title="Schedule Meeting"
                        >
                          <Calendar className="w-3 h-3" />
                          <span>Schedule</span>
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
              </div>
            </div>

            {/* Schedule Meeting Dialog Overlay */}
            {scheduleModalData && (
              <div className="absolute inset-0 z-10 bg-neo-navy/80 p-6 flex items-center justify-center">
                <div className="bg-neo-cream border-[3px] border-neo-navy p-5 max-w-sm w-full shadow-neo space-y-3">
                  <div className="flex items-center justify-between border-b-[2px] border-neo-navy pb-2">
                    <h4 className="font-heading font-bold text-xs uppercase text-neo-navy flex items-center gap-1.5">
                      <Calendar className="w-4 h-4 text-neo-orange" />
                      Schedule Meeting
                    </h4>
                    <button
                      type="button"
                      onClick={() => setScheduleModalData(null)}
                      className="text-neo-navy hover:text-neo-maroon font-bold text-xs"
                    >
                      ✕
                    </button>
                  </div>
                  <div>
                    <p className="text-[11px] font-bold text-neo-navy">
                      Product: {scheduleModalData.product_name}
                    </p>
                    <p className="text-[10px] font-mono text-neo-navy/60">
                      Buyer: {scheduleModalData.phone_number}
                    </p>
                  </div>
                  <div>
                    <label className="block text-[10px] font-mono font-bold uppercase text-neo-navy/70 mb-1">
                      Meeting Date & Time
                    </label>
                    <input
                      type="datetime-local"
                      value={scheduleTime}
                      onChange={(e) => setScheduleTime(e.target.value)}
                      className="w-full text-xs font-mono p-1.5 border-[2px] border-neo-navy bg-white outline-none"
                    />
                  </div>
                  <div className="flex items-center justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setScheduleModalData(null)}
                      className="px-3 py-1 text-[10px] font-bold uppercase border-[2px] border-neo-navy bg-white"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirmSchedule}
                      disabled={!scheduleTime}
                      className="px-3 py-1 bg-neo-orange text-neo-navy font-heading font-bold text-[10px] uppercase border-[2px] border-neo-navy shadow-neo-sm disabled:opacity-50"
                    >
                      Confirm Schedule
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Share Meeting Dialog Overlay */}
            {shareModalData && (
              <div className="absolute inset-0 z-10 bg-neo-navy/80 p-6 flex items-center justify-center">
                <div className="bg-neo-cream border-[3px] border-neo-navy p-5 max-w-sm w-full shadow-neo text-center space-y-3">
                  <div className="flex items-center justify-between border-b-[2px] border-neo-navy pb-2">
                    <h4 className="font-heading font-bold text-xs uppercase text-neo-navy">
                      Share Buyer Link
                    </h4>
                    <button
                      type="button"
                      onClick={() => setShareModalData(null)}
                      className="text-neo-navy hover:text-neo-maroon font-bold text-xs"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="bg-white p-3 border-[2px] border-neo-navy inline-block shadow-neo-sm mx-auto">
                    <QRCodeSVG
                      value={`${window.location.origin}/join/${shareModalData.room_token}`}
                      size={120}
                    />
                  </div>
                  <div className="flex items-center gap-1.5 p-1.5 bg-white border-[2px] border-neo-navy">
                    <input
                      type="text"
                      readOnly
                      value={`${window.location.origin}/join/${shareModalData.room_token}`}
                      className="flex-1 text-[10px] font-mono outline-none px-1 truncate bg-transparent"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(
                          `${window.location.origin}/join/${shareModalData.room_token}`
                        );
                        setCopiedLink(true);
                        setTimeout(() => setCopiedLink(false), 2000);
                      }}
                      className="px-2 py-0.5 bg-neo-orange text-neo-navy font-heading font-bold text-[9px] uppercase border border-neo-navy flex items-center gap-1"
                    >
                      {copiedLink ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      {copiedLink ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShareModalData(null)}
                    className="w-full py-1 bg-neo-navy text-neo-cream font-heading font-bold text-[10px] uppercase border-[2px] border-neo-navy"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}

            {/* Footer */}
            <div className="bg-neo-navy/5 border-t-[2px] border-neo-navy/10 px-4 py-3 flex items-center justify-end flex-shrink-0">
              <button
                onClick={() => setCallbacksModal(false)}
                className="text-[10px] font-bold uppercase text-neo-cream px-4 py-1.5 bg-neo-navy border-[2px] border-neo-navy hover:bg-neo-navy/80 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
