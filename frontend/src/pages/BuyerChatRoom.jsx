import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import {
  MessageSquare, Send, CheckCircle2,
  Clock, AlertCircle, ShoppingBag, ShieldCheck
} from 'lucide-react';
import NeoButton from '../components/NeoButton';
import { formatMoney } from '../lib/format';
import {
  isFirebaseConfigured,
  subscribeToRoom,
  subscribeToMessages,
  sendMessage,
  subscribeToPresence,
  setPresence,
  subscribeToTyping,
  setTyping,
  ensureAnonAuth,
} from '../lib/firebase';

export default function BuyerChatRoom() {
  const { token } = useParams();

  const [room, setRoom] = useState(null);
  const [messages, setMessages] = useState([]);
  const [presence, setPresenceState] = useState({ sellerOnline: false });
  const [typing, setTypingState] = useState({ sellerTyping: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [inputMessage, setInputMessage] = useState('');
  const [offerPrice, setOfferPrice] = useState('');
  const [offerQty, setOfferQty] = useState('');
  const [showOfferFields, setShowOfferFields] = useState(false);
  const [sending, setSending] = useState(false);

  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typing]);

  // Subscribe to room, messages, presence, typing
  useEffect(() => {
    if (!token) {
      setError('Invalid meeting link.');
      setLoading(false);
      return;
    }

    if (!isFirebaseConfigured()) {
      setError('Live Chat service is currently unavailable. (Firebase configuration missing)');
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
          if (!roomData) {
            setError('Meeting room not found or link has expired.');
          } else {
            setRoom(roomData);
            setError(null);
          }
          setLoading(false);
        },
        (err) => {
          setError(err.message || 'Failed to load meeting room.');
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
        (p) => setPresenceState(p || { sellerOnline: false })
      );

      unsubTyping = subscribeToTyping(
        token,
        (t) => setTypingState(t || { sellerTyping: false })
      );

      // Mark buyer online
      setPresence(token, 'buyer', true);

      const handleUnload = () => {
        setPresence(token, 'buyer', false);
      };
      window.addEventListener('beforeunload', handleUnload);

      return () => {
        unsubRoom();
        unsubMessages();
        unsubPresence();
        unsubTyping();
        setPresence(token, 'buyer', false);
        window.removeEventListener('beforeunload', handleUnload);
      };
    } catch (err) {
      setError(err.message || 'Connection error.');
      setLoading(false);
    }
  }, [token]);

  // Handle typing indicator
  const handleInputChange = (e) => {
    const val = e.target.value;
    setInputMessage(val);

    if (token) {
      setTyping(token, 'buyer', true);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        setTyping(token, 'buyer', false);
      }, 1500);
    }
  };

  const handleSendMessage = async (e) => {
    e?.preventDefault();
    if (!inputMessage.trim() && !offerPrice) return;
    if (room?.status === 'ended') return;

    setSending(true);
    try {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      setTyping(token, 'buyer', false);

      await sendMessage(token, {
        sender: 'buyer',
        text: inputMessage.trim() || (offerPrice ? `I offer ${formatMoney(offerPrice)}` : ''),
        offerPrice: offerPrice ? Number(offerPrice) : null,
        offerQuantity: offerQty ? Number(offerQty) : null,
      });

      setInputMessage('');
      setOfferPrice('');
      setOfferQty('');
      setShowOfferFields(false);
    } catch (err) {
      console.error('Failed to send message:', err);
    } finally {
      setSending(false);
    }
  };

  // Find last offer from seller
  const lastSellerOfferMsg = [...messages]
    .reverse()
    .find((m) => m.sender === 'seller' && m.offerPrice != null);

  const handleAcceptSellerOffer = async () => {
    if (!lastSellerOfferMsg) return;
    const price = lastSellerOfferMsg.offerPrice;
    setInputMessage(`Deal agreed at ${formatMoney(price)}!`);
    setOfferPrice(price);
  };

  const isRoomEnded = room?.status === 'ended';

  return (
    <div className="min-h-screen bg-neo-cream flex flex-col font-body selection:bg-neo-orange selection:text-neo-navy">
      {/* ── Top Header Bar ─────────────────────────────────────────── */}
      <header className="bg-neo-navy border-b-[3px] border-neo-navy sticky top-0 z-20 text-neo-cream">
        <div className="container mx-auto px-4 py-3 max-w-4xl flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 bg-neo-orange border-[2px] border-neo-cream flex items-center justify-center flex-shrink-0 shadow-neo-sm">
              <ShoppingBag className="w-5 h-5 text-neo-navy" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base sm:text-lg font-heading font-bold text-neo-cream truncate">
                {room?.productLabel || 'Live Negotiation'}
              </h1>
              <div className="flex items-center gap-2 text-xs font-mono">
                {room?.askPrice != null && (
                  <span className="text-neo-orange font-bold">
                    Asking: {formatMoney(room.askPrice)}
                  </span>
                )}
                <span className="text-neo-cream/40">•</span>
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      presence.sellerOnline ? 'bg-neo-teal animate-pulse' : 'bg-neo-cream/30'
                    }`}
                  />
                  <span className="text-neo-cream/70 text-[11px] uppercase font-bold">
                    {presence.sellerOnline ? 'Seller Online' : 'Seller Away'}
                  </span>
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {isRoomEnded ? (
              <span className="px-2.5 py-1 text-xs font-bold uppercase bg-neo-maroon text-neo-cream border-[2px] border-neo-navy">
                Closed
              </span>
            ) : (
              <span className="px-2.5 py-1 text-xs font-bold uppercase bg-neo-teal text-neo-cream border-[2px] border-neo-navy animate-pulse">
                Live Chat
              </span>
            )}
          </div>
        </div>
      </header>

      {/* ── Main Chat Area ──────────────────────────────────────────── */}
      <main className="flex-1 container mx-auto px-4 py-4 max-w-4xl flex flex-col justify-between">
        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center py-20 text-center">
            <div className="w-12 h-12 border-[4px] border-neo-navy border-t-neo-orange animate-spin mb-4" />
            <p className="font-heading font-bold text-neo-navy uppercase tracking-wider text-sm">
              Connecting to secure negotiation room...
            </p>
          </div>
        ) : error ? (
          <div className="flex-1 flex items-center justify-center py-16">
            <div className="bg-white border-[4px] border-neo-navy p-6 max-w-md w-full shadow-neo text-center">
              <AlertCircle className="w-12 h-12 text-neo-maroon mx-auto mb-3" />
              <h2 className="font-heading font-bold text-lg text-neo-navy mb-2">
                Unable to Join
              </h2>
              <p className="text-xs text-neo-navy/70 mb-4">{error}</p>
              <a
                href="/"
                className="inline-block px-4 py-2 bg-neo-orange text-neo-navy border-[2px] border-neo-navy font-heading font-bold text-xs uppercase shadow-neo-sm hover:translate-x-[1px] hover:translate-y-[1px]"
              >
                Return to TradeMind
              </a>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col justify-between bg-white border-[3px] border-neo-navy shadow-neo overflow-hidden">
            {/* Deal Conclusion Banner */}
            {isRoomEnded && (
              <div className="bg-neo-navy text-neo-cream p-4 border-b-[3px] border-neo-navy flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-neo-teal flex items-center justify-center border-[2px] border-neo-cream">
                    <CheckCircle2 className="w-5 h-5 text-neo-cream" />
                  </div>
                  <div>
                    <h3 className="font-heading font-bold text-sm uppercase text-neo-orange">
                      Negotiation Concluded
                    </h3>
                    <p className="text-xs text-neo-cream/80">
                      {room?.dealPrice
                        ? `Final Deal Price: ${formatMoney(room.dealPrice)} ${
                            room.dealQuantity ? `(${room.dealQuantity} units)` : ''
                          }`
                        : 'This live session has been ended.'}
                    </p>
                  </div>
                </div>
                <ShieldCheck className="w-6 h-6 text-neo-teal flex-shrink-0" />
              </div>
            )}

            {/* Message Feed */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[350px] max-h-[55vh]">
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center py-16 text-neo-navy/40">
                  <MessageSquare className="w-12 h-12 mb-2 stroke-[1.5]" />
                  <p className="font-heading font-bold uppercase text-xs">
                    Start the conversation
                  </p>
                  <p className="text-[11px] max-w-xs mt-1">
                    Send a message or make your initial offer to the seller below.
                  </p>
                </div>
              ) : (
                messages.map((m) => {
                  const isMe = m.sender === 'buyer';
                  return (
                    <div
                      key={m.id}
                      className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
                    >
                      <div className="flex items-center gap-2 mb-1 px-1">
                        <span className="text-[10px] font-mono uppercase font-bold text-neo-navy/50">
                          {isMe ? 'You' : 'Seller'}
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
                        className={`max-w-[85%] sm:max-w-[70%] p-3.5 border-[2px] border-neo-navy shadow-neo-sm ${
                          isMe
                            ? 'bg-neo-cream text-neo-navy'
                            : 'bg-neo-navy text-neo-cream'
                        }`}
                      >
                        <p className="text-xs sm:text-sm whitespace-pre-wrap leading-relaxed">
                          {m.text}
                        </p>

                        {/* Offer badge attached to message */}
                        {m.offerPrice != null && (
                          <div
                            className={`mt-2.5 pt-2 border-t flex items-center justify-between gap-2 text-xs font-mono font-bold ${
                              isMe
                                ? 'border-neo-navy/20 text-neo-maroon'
                                : 'border-neo-cream/20 text-neo-orange'
                            }`}
                          >
                            <span>OFFER PROPOSAL:</span>
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
              {typing.sellerTyping && (
                <div className="flex items-center gap-2 text-xs font-mono text-neo-navy/60 italic pt-2">
                  <div className="flex gap-1">
                    <span className="w-1.5 h-1.5 bg-neo-navy rounded-full animate-bounce" />
                    <span className="w-1.5 h-1.5 bg-neo-navy rounded-full animate-bounce [animation-delay:0.2s]" />
                    <span className="w-1.5 h-1.5 bg-neo-navy rounded-full animate-bounce [animation-delay:0.4s]" />
                  </div>
                  <span>Seller is typing...</span>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Seller Offer Quick-Action Bar */}
            {!isRoomEnded && lastSellerOfferMsg && (
              <div className="bg-neo-orange/15 border-t-[2px] border-neo-navy p-2.5 px-4 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs">
                  <Clock className="w-3.5 h-3.5 text-neo-maroon flex-shrink-0" />
                  <span className="font-bold text-neo-navy">
                    Latest Seller Counter:
                  </span>
                  <span className="font-mono font-bold text-neo-maroon">
                    {formatMoney(lastSellerOfferMsg.offerPrice)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleAcceptSellerOffer}
                  className="px-3 py-1 bg-neo-teal text-neo-cream font-heading font-bold text-[11px] uppercase border-[2px] border-neo-navy shadow-neo-sm hover:translate-x-[1px] hover:translate-y-[1px]"
                >
                  Accept Offer
                </button>
              </div>
            )}

            {/* Input Bar */}
            {!isRoomEnded ? (
              <form
                onSubmit={handleSendMessage}
                className="border-t-[3px] border-neo-navy bg-neo-cream/60 p-3 flex flex-col gap-2"
              >
                {/* Optional Offer Fields Accordion */}
                {showOfferFields && (
                  <div className="grid grid-cols-2 gap-2 p-2 bg-white border-[2px] border-neo-navy shadow-neo-sm">
                    <div>
                      <label className="block text-[10px] font-mono font-bold uppercase text-neo-navy/60 mb-0.5">
                        Offer Price (₹)
                      </label>
                      <input
                        type="number"
                        step="any"
                        placeholder="e.g. 750"
                        value={offerPrice}
                        onChange={(e) => setOfferPrice(e.target.value)}
                        className="w-full text-xs font-mono p-1.5 border-[2px] border-neo-navy bg-neo-cream/30 focus:outline-none focus:bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-mono font-bold uppercase text-neo-navy/60 mb-0.5">
                        Quantity
                      </label>
                      <input
                        type="number"
                        placeholder="e.g. 10"
                        value={offerQty}
                        onChange={(e) => setOfferQty(e.target.value)}
                        className="w-full text-xs font-mono p-1.5 border-[2px] border-neo-navy bg-neo-cream/30 focus:outline-none focus:bg-white"
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
                    {showOfferFields ? 'Hide Offer' : '+ Add Offer'}
                  </button>

                  <input
                    type="text"
                    value={inputMessage}
                    onChange={handleInputChange}
                    placeholder="Type a message or proposal..."
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
                    <span className="hidden sm:inline">Send</span>
                  </NeoButton>
                </div>
              </form>
            ) : (
              <div className="p-4 bg-neo-cream text-center text-xs font-bold text-neo-navy/60 border-t-[2px] border-neo-navy">
                This chat is closed. No further messages can be sent.
              </div>
            )}
          </div>
        )}
      </main>

      {/* ── Footer ─────────────────────────────────────────────────── */}
      <footer className="py-3 bg-neo-cream border-t-[2px] border-neo-navy/15 text-center text-[10px] font-mono uppercase text-neo-navy/40">
        TradeMind Live Negotiation • Powered by Real-Time Deterministic Engine
      </footer>
    </div>
  );
}
