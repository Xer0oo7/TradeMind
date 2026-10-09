import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  MessageSquare, Send, CheckCircle2, Clock,
  AlertCircle, ShieldCheck, Share2, Phone,
  XCircle, ArrowLeft, Loader2, Sparkles, UserCheck,
  Check, Copy, QrCode
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import Layout from '../components/Layout';
import NeoButton from '../components/NeoButton';
import AssistPanel from '../components/AssistPanel';
import { formatMoney } from '../lib/format';
import {
  getMeetingByToken,
  endMeeting,
  startMeeting,
} from '../lib/api';
import {
  isFirebaseConfigured,
  subscribeToRoom,
  subscribeToMessages,
  sendMessage,
  subscribeToPresence,
  setPresence,
  subscribeToTyping,
  setTyping,
  updateRoom,
  ensureAnonAuth,
} from '../lib/firebase';

export default function LiveChatPage() {
  const { token } = useParams();
  const navigate = useNavigate();

  // Meeting & Room state
  const [meeting, setMeeting] = useState(null);
  const [room, setRoom] = useState(null);
  const [messages, setMessages] = useState([]);
  const [presence, setPresenceState] = useState({ buyerOnline: false });
  const [typing, setTypingState] = useState({ buyerTyping: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Message composer state
  const [inputMessage, setInputMessage] = useState('');
  const [offerPrice, setOfferPrice] = useState('');
  const [offerQty, setOfferQty] = useState('');
  const [showOfferFields, setShowOfferFields] = useState(false);
  const [sending, setSending] = useState(false);

  // End Meeting Modal state
  const [showEndModal, setShowEndModal] = useState(false);
  const [dealAgreed, setDealAgreed] = useState(true);
  const [finalPrice, setFinalPrice] = useState('');
  const [finalQty, setFinalQty] = useState('');
  const [endingNotes, setEndingNotes] = useState('');
  const [ending, setEnding] = useState(false);

  // Share Modal state
  const [showShareModal, setShowShareModal] = useState(false);
  const [copied, setCopied] = useState(false);

  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typing]);

  // Load meeting metadata from Backend
  useEffect(() => {
    async function loadMeeting() {
      try {
        const m = await getMeetingByToken(token);
        setMeeting(m);

        // If meeting is scheduled, automatically mark live
        if (m.status === 'scheduled') {
          try {
            const updated = await startMeeting(m.id);
            setMeeting(updated);
          } catch (e) {
            console.error('Failed to mark meeting live:', e);
          }
        }
      } catch (err) {
        console.error('Failed to fetch meeting:', err);
        setError(err.message || 'Meeting not found');
      }
    }
    if (token) loadMeeting();
  }, [token]);

  // Subscribe to Firestore room, messages, presence, typing
  useEffect(() => {
    if (!token) return;
    if (!isFirebaseConfigured()) {
      setError('Live Chat service requires Firebase configuration.');
      setLoading(false);
      return;
    }

    setLoading(true);
    let unsubRoom = () => {};
    let unsubMessages = () => {};
    let unsubPresence = () => {};
    let unsubTyping = () => {};

    try {
      ensureAnonAuth().catch((err) => console.warn('Anonymous auth warning:', err));
      unsubRoom = subscribeToRoom(
        token,
        (roomData) => {
          setRoom(roomData);
          setLoading(false);
        },
        (err) => {
          console.error('Error subscribing to room:', err);
          setError(err.message);
          setLoading(false);
        }
      );

      unsubMessages = subscribeToMessages(
        token,
        (msgs) => {
          setMessages(msgs);
        },
        (err) => console.error('Error fetching messages:', err)
      );

      unsubPresence = subscribeToPresence(
        token,
        (p) => setPresenceState(p || { buyerOnline: false })
      );

      unsubTyping = subscribeToTyping(
        token,
        (t) => setTypingState(t || { buyerTyping: false })
      );

      // Mark seller online
      setPresence(token, 'seller', true);

      const handleUnload = () => {
        setPresence(token, 'seller', false);
      };
      window.addEventListener('beforeunload', handleUnload);

      return () => {
        unsubRoom();
        unsubMessages();
        unsubPresence();
        unsubTyping();
        setPresence(token, 'seller', false);
        window.removeEventListener('beforeunload', handleUnload);
      };
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }, [token]);

  // Handle typing indicator
  const handleInputChange = (e) => {
    const val = e.target.value;
    setInputMessage(val);

    if (token) {
      setTyping(token, 'seller', true);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        setTyping(token, 'seller', false);
      }, 1500);
    }
  };

  const handleSendMessage = async (e) => {
    e?.preventDefault();
    if (!inputMessage.trim() && !offerPrice) return;
    if (meeting?.status === 'ended' || room?.status === 'ended') return;

    setSending(true);
    try {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      setTyping(token, 'seller', false);

      await sendMessage(token, {
        sender: 'seller',
        text: inputMessage.trim() || (offerPrice ? `I can offer ${formatMoney(offerPrice)}` : ''),
        offerPrice: offerPrice ? Number(offerPrice) : null,
        offerQuantity: offerQty ? Number(offerQty) : null,
      });

      setInputMessage('');
      setOfferPrice('');
      setOfferQty('');
      setShowOfferFields(false);
    } catch (err) {
      console.error('Failed to send seller message:', err);
    } finally {
      setSending(false);
    }
  };

  // Assist callbacks
  const handleApplyAssistCounter = (replyText, counterPrice) => {
    setInputMessage(replyText);
    setOfferPrice(counterPrice);
    setShowOfferFields(true);
  };

  const handleSendAssistCounter = async (replyText, counterPrice) => {
    if (meeting?.status === 'ended' || room?.status === 'ended') return;
    setSending(true);
    try {
      await sendMessage(token, {
        sender: 'seller',
        text: replyText,
        offerPrice: Number(counterPrice),
        offerQuantity: meeting?.quantity || null,
      });
      setInputMessage('');
      setOfferPrice('');
    } catch (err) {
      console.error('Failed to send counter:', err);
    } finally {
      setSending(false);
    }
  };

  // Handle ending meeting (Phase G)
  const handleEndMeeting = async () => {
    if (!meeting) return;
    setEnding(true);

    try {
      const summaryPayload = {
        finalOutcome: {
          dealAgreed,
          finalPrice: dealAgreed && finalPrice ? Number(finalPrice) : null,
          finalQuantity: dealAgreed && finalQty ? Number(finalQty) : null,
          notes: endingNotes,
        },
        roundsCount: messages.length,
        closedAt: new Date().toISOString(),
      };

      // 1. End on MySQL Backend
      const updated = await endMeeting(meeting.id, { summary: summaryPayload });
      setMeeting(updated);

      // 2. Update Firestore room status
      try {
        await updateRoom(token, {
          status: 'ended',
          dealPrice: dealAgreed && finalPrice ? Number(finalPrice) : null,
          dealQuantity: dealAgreed && finalQty ? Number(finalQty) : null,
        });
      } catch (fErr) {
        console.warn('Could not update Firestore room status:', fErr);
      }

      setShowEndModal(false);
    } catch (err) {
      console.error('Failed to end meeting:', err);
      alert(`Error ending meeting: ${err.message}`);
    } finally {
      setEnding(false);
    }
  };

  // Derive latest buyer message and offers for AssistPanel
  const latestBuyerMessageObj = [...messages]
    .reverse()
    .find((m) => m.sender === 'buyer');

  const latestBuyerMessageText = latestBuyerMessageObj?.text || null;

  const sellerLastOffer = [...messages]
    .reverse()
    .find((m) => m.sender === 'seller' && m.offerPrice != null)?.offerPrice || null;

  const buyerLastOffer = latestBuyerMessageObj?.offerPrice || null;

  const buyerJoinUrl = `${window.location.origin}/join/${token}`;

  const isMeetingEnded = meeting?.status === 'ended' || room?.status === 'ended';

  return (
    <Layout>
      <div className="min-h-[85vh] bg-neo-cream flex flex-col font-body">
        {/* ── Top Bar ──────────────────────────────────────────────── */}
        <div className="bg-neo-navy text-neo-cream border-b-[3px] border-neo-navy px-4 py-3">
          <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <button
                onClick={() => navigate('/jury')}
                className="p-1.5 bg-neo-cream/10 hover:bg-neo-cream/20 text-neo-cream border border-neo-cream/20"
                title="Back to Dashboard"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="font-heading font-bold text-base sm:text-lg text-neo-cream truncate">
                    {meeting?.product_name || room?.productLabel || 'Live Negotiation'}
                  </h1>
                  <span
                    className={`px-2 py-0.5 text-[10px] font-mono font-bold uppercase border-[1.5px] border-neo-cream ${
                      isMeetingEnded ? 'bg-neo-maroon text-neo-cream' : 'bg-neo-teal text-neo-cream animate-pulse'
                    }`}
                  >
                    {isMeetingEnded ? 'Ended' : 'Live'}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs font-mono text-neo-cream/60">
                  {meeting?.buyer_phone && (
                    <span className="flex items-center gap-1">
                      <Phone className="w-3 h-3 text-neo-orange" />
                      {meeting.buyer_phone}
                    </span>
                  )}
                  <span>•</span>
                  <span className="flex items-center gap-1.5">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        presence.buyerOnline ? 'bg-neo-teal animate-pulse' : 'bg-neo-cream/30'
                      }`}
                    />
                    <span className="text-[11px] uppercase font-bold text-neo-cream/80">
                      {presence.buyerOnline ? 'Buyer Present' : 'Buyer Away'}
                    </span>
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowShareModal(true)}
                className="px-3 py-1.5 bg-neo-cream/10 hover:bg-neo-orange hover:text-neo-navy text-neo-cream border-[2px] border-neo-cream/30 font-heading font-bold text-xs uppercase transition-all flex items-center gap-1.5"
              >
                <Share2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Buyer Link</span>
              </button>

              {!isMeetingEnded && (
                <button
                  onClick={() => {
                    setShowEndModal(true);
                    if (sellerLastOffer) setFinalPrice(sellerLastOffer);
                    if (meeting?.quantity) setFinalQty(meeting.quantity);
                  }}
                  className="px-3 py-1.5 bg-neo-maroon text-neo-cream border-[2px] border-neo-cream/50 font-heading font-bold text-xs uppercase shadow-neo-sm hover:translate-x-[1px] hover:translate-y-[1px] transition-all flex items-center gap-1.5"
                >
                  <XCircle className="w-3.5 h-3.5 text-neo-orange" />
                  <span>End Meeting</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── Main Two-Pane Grid ───────────────────────────────────── */}
        <div className="flex-1 max-w-7xl w-full mx-auto grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
          {/* LEFT: Live Chat Stream (7 Cols) */}
          <div className="lg:col-span-7 flex flex-col bg-white border-r-[3px] border-b-[3px] lg:border-b-0 border-neo-navy">
            {/* Messages Scroll Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[400px] max-h-[65vh]">
              {loading ? (
                <div className="flex flex-col items-center justify-center py-24 text-center">
                  <Loader2 className="w-8 h-8 animate-spin text-neo-navy mb-2" />
                  <p className="font-heading font-bold text-xs uppercase text-neo-navy">
                    Connecting to live room...
                  </p>
                </div>
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center text-neo-navy/40">
                  <MessageSquare className="w-10 h-10 mb-2 opacity-30" />
                  <p className="font-heading font-bold uppercase text-xs">
                    No messages in this room yet
                  </p>
                  <p className="text-[11px] max-w-xs mt-1">
                    Share the buyer link to begin negotiating in real time.
                  </p>
                </div>
              ) : (
                messages.map((m) => {
                  const isSeller = m.sender === 'seller';
                  return (
                    <div
                      key={m.id}
                      className={`flex flex-col ${isSeller ? 'items-end' : 'items-start'}`}
                    >
                      <div className="flex items-center gap-2 mb-1 px-1">
                        <span className="text-[10px] font-mono uppercase font-bold text-neo-navy/50">
                          {isSeller ? 'You (Seller)' : 'Buyer'}
                        </span>
                        {m.createdAt?.seconds && (
                          <span className="text-[9px] font-mono text-neo-navy/30">
                            {new Date(m.createdAt.seconds * 1000).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        )}
                      </div>

                      <div
                        className={`max-w-[85%] sm:max-w-[75%] p-3.5 border-[2px] border-neo-navy shadow-neo-sm ${
                          isSeller
                            ? 'bg-neo-navy text-neo-cream'
                            : 'bg-neo-cream text-neo-navy'
                        }`}
                      >
                        <p className="text-xs sm:text-sm whitespace-pre-wrap leading-relaxed">
                          {m.text}
                        </p>

                        {m.offerPrice != null && (
                          <div
                            className={`mt-2.5 pt-2 border-t flex items-center justify-between gap-2 text-xs font-mono font-bold ${
                              isSeller
                                ? 'border-neo-cream/20 text-neo-orange'
                                : 'border-neo-navy/20 text-neo-maroon'
                            }`}
                          >
                            <span>PROPOSAL:</span>
                            <span>
                              {formatMoney(m.offerPrice)}
                              {m.offerQuantity ? ` × ${m.offerQuantity} units` : ''}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}

              {/* Typing indicator */}
              {typing.buyerTyping && (
                <div className="flex items-center gap-2 text-xs font-mono text-neo-navy/60 italic pt-2">
                  <div className="flex gap-1">
                    <span className="w-1.5 h-1.5 bg-neo-navy rounded-full animate-bounce" />
                    <span className="w-1.5 h-1.5 bg-neo-navy rounded-full animate-bounce [animation-delay:0.2s]" />
                    <span className="w-1.5 h-1.5 bg-neo-navy rounded-full animate-bounce [animation-delay:0.4s]" />
                  </div>
                  <span>Buyer is typing...</span>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Composer Bar */}
            {!isMeetingEnded ? (
              <form
                onSubmit={handleSendMessage}
                className="border-t-[3px] border-neo-navy bg-neo-cream/50 p-3 flex flex-col gap-2"
              >
                {showOfferFields && (
                  <div className="grid grid-cols-2 gap-2 p-2 bg-white border-[2px] border-neo-navy shadow-neo-sm">
                    <div>
                      <label className="block text-[10px] font-mono font-bold uppercase text-neo-navy/60 mb-1">
                        Attach Offer Price (₹)
                      </label>
                      <input
                        type="number"
                        step="any"
                        placeholder="e.g. 800"
                        value={offerPrice}
                        onChange={(e) => setOfferPrice(e.target.value)}
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
                        value={offerQty}
                        onChange={(e) => setOfferQty(e.target.value)}
                        className="w-full text-xs font-mono p-1.5 border-[2px] border-neo-navy bg-neo-cream/30 focus:bg-white outline-none"
                      />
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowOfferFields(!showOfferFields)}
                    className={`px-3 py-2 text-xs font-heading font-bold uppercase border-[2px] border-neo-navy transition-all ${
                      showOfferFields
                        ? 'bg-neo-navy text-neo-cream'
                        : 'bg-white text-neo-navy hover:bg-neo-cream'
                    }`}
                  >
                    {showOfferFields ? 'Hide Offer' : '+ Attach Offer'}
                  </button>

                  <input
                    type="text"
                    value={inputMessage}
                    onChange={handleInputChange}
                    placeholder="Type your response to the buyer..."
                    className="flex-1 text-xs sm:text-sm p-2 border-[2px] border-neo-navy bg-white focus:outline-none focus:ring-1 focus:ring-neo-orange font-body"
                  />

                  <NeoButton
                    type="submit"
                    variant="orange"
                    size="sm"
                    disabled={sending || (!inputMessage.trim() && !offerPrice)}
                    className="flex items-center gap-1.5"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Send</span>
                  </NeoButton>
                </div>
              </form>
            ) : (
              <div className="p-4 bg-neo-navy text-neo-cream border-t-[3px] border-neo-navy flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-neo-teal" />
                  <span className="font-heading font-bold text-xs uppercase">
                    Meeting Ended
                  </span>
                </div>
                <button
                  onClick={() => navigate('/jury')}
                  className="px-3 py-1 bg-neo-orange text-neo-navy text-xs font-bold border-[2px] border-neo-navy shadow-neo-sm"
                >
                  Return to Dashboard
                </button>
              </div>
            )}
          </div>

          {/* RIGHT: Seller Assist Panel (5 Cols) */}
          <div className="lg:col-span-5 h-full">
            <AssistPanel
              productId={meeting?.product_id}
              latestBuyerMessage={latestBuyerMessageText}
              sellerLastOffer={sellerLastOffer}
              buyerLastOffer={buyerLastOffer}
              roundNumber={Math.max(1, Math.floor(messages.length / 2) + 1)}
              availableInventory={meeting?.available_inventory}
              onApplyCounter={handleApplyAssistCounter}
              onSendCounter={handleSendAssistCounter}
            />
          </div>
        </div>

        {/* ── End Meeting Modal (Phase G) ─────────────────────────── */}
        {showEndModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-neo-navy/60 backdrop-blur-sm">
            <div className="bg-neo-cream border-[4px] border-neo-navy p-6 max-w-md w-full shadow-neo space-y-4">
              <div className="flex items-center justify-between border-b-[2px] border-neo-navy pb-3">
                <h3 className="font-heading font-bold text-base uppercase text-neo-navy">
                  Conclude Live Negotiation
                </h3>
                <button
                  onClick={() => setShowEndModal(false)}
                  className="p-1 hover:bg-neo-maroon hover:text-neo-cream transition-colors"
                >
                  <XCircle className="w-5 h-5" />
                </button>
              </div>

              {/* Outcome Selection Toggle */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setDealAgreed(true)}
                  className={`p-3 border-[2px] font-heading font-bold text-xs uppercase transition-all ${
                    dealAgreed
                      ? 'bg-neo-teal text-neo-cream border-neo-navy shadow-neo-sm'
                      : 'bg-white text-neo-navy border-neo-navy/30 hover:border-neo-navy'
                  }`}
                >
                  Deal Agreed
                </button>
                <button
                  type="button"
                  onClick={() => setDealAgreed(false)}
                  className={`p-3 border-[2px] font-heading font-bold text-xs uppercase transition-all ${
                    !dealAgreed
                      ? 'bg-neo-maroon text-neo-cream border-neo-navy shadow-neo-sm'
                      : 'bg-white text-neo-navy border-neo-navy/30 hover:border-neo-navy'
                  }`}
                >
                  No Deal / Walk Away
                </button>
              </div>

              {dealAgreed && (
                <div className="space-y-3 bg-white p-3 border-[2px] border-neo-navy">
                  <div>
                    <label className="block text-[10px] font-mono font-bold uppercase text-neo-navy/70 mb-1">
                      Final Agreed Price (₹)
                    </label>
                    <input
                      type="number"
                      step="any"
                      placeholder="e.g. 850"
                      value={finalPrice}
                      onChange={(e) => setFinalPrice(e.target.value)}
                      className="w-full text-xs font-mono p-2 border-[2px] border-neo-navy bg-neo-cream/20 focus:bg-white outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-mono font-bold uppercase text-neo-navy/70 mb-1">
                      Agreed Quantity
                    </label>
                    <input
                      type="number"
                      placeholder="e.g. 5"
                      value={finalQty}
                      onChange={(e) => setFinalQty(e.target.value)}
                      className="w-full text-xs font-mono p-2 border-[2px] border-neo-navy bg-neo-cream/20 focus:bg-white outline-none"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-[10px] font-mono font-bold uppercase text-neo-navy/70 mb-1">
                  Closing Notes (Optional)
                </label>
                <textarea
                  rows={2}
                  placeholder="e.g. Buyer requested delivery by Friday..."
                  value={endingNotes}
                  onChange={(e) => setEndingNotes(e.target.value)}
                  className="w-full text-xs p-2 border-[2px] border-neo-navy bg-white focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowEndModal(false)}
                  className="px-4 py-2 text-xs font-bold uppercase border-[2px] border-neo-navy bg-white hover:bg-neo-cream"
                >
                  Cancel
                </button>
                <NeoButton
                  variant={dealAgreed ? 'teal' : 'maroon'}
                  size="sm"
                  onClick={handleEndMeeting}
                  disabled={ending}
                >
                  {ending ? 'Closing...' : 'Finalize & Save'}
                </NeoButton>
              </div>
            </div>
          </div>
        )}

        {/* ── Share Modal (QR Code & Link) ───────────────────────── */}
        {showShareModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-neo-navy/60 backdrop-blur-sm">
            <div className="bg-neo-cream border-[4px] border-neo-navy p-6 max-w-sm w-full shadow-neo text-center space-y-4">
              <div className="flex items-center justify-between border-b-[2px] border-neo-navy pb-2">
                <h3 className="font-heading font-bold text-sm uppercase text-neo-navy">
                  Buyer Invite Link
                </h3>
                <button onClick={() => setShowShareModal(false)}>
                  <XCircle className="w-4 h-4 text-neo-navy" />
                </button>
              </div>

              <div className="bg-white p-4 border-[3px] border-neo-navy inline-block shadow-neo-sm mx-auto">
                <QRCodeSVG value={buyerJoinUrl} size={160} />
              </div>

              <p className="text-xs text-neo-navy/70">
                Share this secure link or QR code with your buyer to join this negotiation.
              </p>

              <div className="flex items-center gap-1.5 p-1.5 bg-white border-[2px] border-neo-navy">
                <input
                  type="text"
                  readOnly
                  value={buyerJoinUrl}
                  className="flex-1 text-[11px] font-mono outline-none px-1 truncate bg-transparent"
                />
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(buyerJoinUrl);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="px-2.5 py-1 bg-neo-orange text-neo-navy font-heading font-bold text-[10px] uppercase border-[1.5px] border-neo-navy flex items-center gap-1"
                >
                  {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>

              <NeoButton
                variant="default"
                size="sm"
                onClick={() => setShowShareModal(false)}
                className="w-full text-xs"
              >
                Done
              </NeoButton>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
