import React, { useState, useEffect, useRef } from 'react';
import { Send, Loader2, AlertCircle, TrendingUp, TrendingDown, RotateCcw, Plus, Minus, Zap, Shield, Phone, X, CheckCircle, Package, Search, ChevronDown, Database, Edit3, PhoneCall } from 'lucide-react';
import { createSession, sendChat, healthCheck, dbStartSession, dbSaveMessage, dbCloseSession, dbSaveCallbackRequest } from './api';
import { getProducts } from '../../lib/productStore';
import { VoiceCall } from '../../call-feature';
import { formatMoney } from '../../lib/formatters';
import { getMarketComparison } from '../../lib/api';
import './Chat.css';

const MarketDock = React.lazy(() => import('../../components/market/MarketDock'));

export default function Chat() {
    // Setup config
    const [showSetup, setShowSetup] = useState(true);
    const [configSource, setConfigSource] = useState('database'); // 'database' | 'manual'
    const [products, setProductsList] = useState([]);
    const [productsLoading, setProductsLoading] = useState(false);
    const [selectedProduct, setSelectedProduct] = useState(null);
    const [productSearch, setProductSearch] = useState('');
    const [showProductDropdown, setShowProductDropdown] = useState(false);
    const productDropdownRef = useRef(null);
    const [config, setConfig] = useState({
        productName: 'Sony WH-1000XM5',
        mode: 'MAX_PROFIT',
        maxRounds: 10,
        basePrice: 2499,
        costPrice: 1500,
        quantity: 1,
    });

    // Session state
    const [sessionId, setSessionId] = useState(null);
    const [sessionInfo, setSessionInfo] = useState(null);
    const [messages, setMessages] = useState([]);
    const [inputValue, setInputValue] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [backendHealthy, setBackendHealthy] = useState(null);
    const [negotiationEnded, setNegotiationEnded] = useState(false);
    const [dbSessionId, setDbSessionId] = useState(null);
    const [lastBuyerOffer, setLastBuyerOffer] = useState(null);
    const [lastSellerOffer, setLastSellerOffer] = useState(null);

    // Callback scheduling flow
    const [callbackPhase, setCallbackPhase] = useState('none'); // none | asking | phone_popup | submitted
    const [showPhonePopup, setShowPhonePopup] = useState(false);
    const [phoneNumber, setPhoneNumber] = useState('');
    const [phoneError, setPhoneError] = useState('');
    const [callbackSaving, setCallbackSaving] = useState(false);
    const [finalNegotiationStatus, setFinalNegotiationStatus] = useState(null);
    const [finalDealPrice, setFinalDealPrice] = useState(null);
    const [autoExpandSignal, setAutoExpandSignal] = useState(false);
    const productCurrency = selectedProduct?.currency || 'INR';

    // Voice call state
    const [showVoiceCall, setShowVoiceCall] = useState(false);

    const messagesEndRef = useRef(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    // Check backend health on mount & load products
    useEffect(() => {
        healthCheck().then(ok => setBackendHealthy(ok));
        loadProducts();
    }, []);

    // Close dropdown on outside click
    useEffect(() => {
        function handleClickOutside(e) {
            if (productDropdownRef.current && !productDropdownRef.current.contains(e.target)) {
                setShowProductDropdown(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    async function loadProducts() {
        setProductsLoading(true);
        try {
            const data = await getProducts();
            setProductsList(data);
        } catch (err) {
            console.error('Failed to load products:', err);
        } finally {
            setProductsLoading(false);
        }
    }

    function selectProduct(product) {
        setSelectedProduct(product);
        setConfig({
            mode: product.mode || 'MAX_PROFIT',
            maxRounds: product.maxRounds || 10,
            basePrice: product.basePrice,
            costPrice: product.costPrice,
            quantity: product.quantity || 1,
        });
        setShowProductDropdown(false);
        setProductSearch('');
    }

    const filteredProducts = products.filter(p =>
        p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
        (p.category && p.category.toLowerCase().includes(productSearch.toLowerCase()))
    );

    async function startNegotiation() {
        setLoading(true);
        setError(null);

        const productName = selectedProduct ? selectedProduct.name : (config.productName?.trim() || 'Wireless Earbuds');
        const productId = selectedProduct ? String(selectedProduct.id) : 'TRADE-001';
        const minAcceptable = selectedProduct ? selectedProduct.minAcceptablePrice : config.costPrice;
        const maxLoss = selectedProduct ? (selectedProduct.maxLossPercent || 0) : 0;

        const sessionConfig = {
            product: {
                product_id: productId,
                product_name: productName,
                base_price: config.basePrice,
                cost_price: config.costPrice,
                min_acceptable_price: minAcceptable,
                max_loss_percentage: maxLoss
            },
            inventory: {
                available_quantity: selectedProduct ? (selectedProduct.availableQuantity || 100) : 100,
                requested_quantity: config.quantity || 1,
                inventory_pressure: "medium",
                sales_frequency: "medium"
            },
            strategy: {
                mode: config.mode,
                urgency: "medium",
                relationship_priority: "medium",
                max_rounds: config.maxRounds
            }
        };

        try {
            const healthy = await healthCheck();
            setBackendHealthy(healthy);
            if (!healthy) {
                setError('Backend not available. Start the server first.');
                setLoading(false);
                return;
            }

            // Trigger live web scraping so competitor data is updated before negotiation starts
            try {
                await getMarketComparison(
                    productId,
                    5,
                    productName,
                    config.basePrice,
                    productCurrency,
                    true
                );
            } catch (marketErr) {
                console.warn('[Market] Live scrape prefetch notice:', marketErr);
            }

            const sessionData = await createSession(sessionConfig);
            if (sessionData?.session_id) {
                setSessionId(sessionData.session_id);
                setSessionInfo(sessionData);
                setShowSetup(false);

                // ── Persist to MySQL ──
                try {
                    const dbSess = await dbStartSession({
                        product_name: productName,
                        mode: config.mode,
                        base_price: config.basePrice,
                        cost_price: config.costPrice,
                        min_price: minAcceptable,
                        max_rounds: config.maxRounds,
                    });
                    if (dbSess?.id) {
                        setDbSessionId(dbSess.id);
                        // Save the initial bot greeting as round 0
                        await dbSaveMessage(dbSess.id, {
                            round_number: 0,
                            user_message: null,
                            bot_reply: sessionData.message,
                            offered_price: null,
                            counter_price: sessionData.initial_offer ? parseFloat(sessionData.initial_offer) : null,
                            decision: 'chat',
                        });
                        setLastSellerOffer(sessionData.initial_offer ? parseFloat(sessionData.initial_offer) : config.basePrice);
                    }
                } catch (dbErr) {
                    console.error('[DB] Failed to persist session start:', dbErr);
                    // Non-blocking: negotiation can still proceed without DB persistence
                }
                setMessages([{
                    id: Date.now(),
                    text: sessionData.message,
                    sender: 'bot',
                    timestamp: new Date(),
                    meta: {
                        initialOffer: sessionData.initial_offer,
                        mode: sessionData.mode,
                        maxRounds: sessionData.max_rounds,
                    }
                }]);
            } else {
                setError('Failed to create session');
            }
        } catch (err) {
            setError("Failed to start: " + err.message);
        } finally {
            setLoading(false);
        }
    }

    function resetToSetup() {
        setShowSetup(true);
        setSessionId(null);
        setSessionInfo(null);
        setMessages([]);
        setNegotiationEnded(false);
        setDbSessionId(null);
        setLastBuyerOffer(null);
        setLastSellerOffer(null);
        setError(null);
        setInputValue('');
        setCallbackPhase('none');
        setShowPhonePopup(false);
        setPhoneNumber('');
        setPhoneError('');
        setFinalNegotiationStatus(null);
        setFinalDealPrice(null);
        setSelectedProduct(null);
        setProductSearch('');
        loadProducts();
    }

    // ── Callback scheduling handlers ──
    function handleCallbackYes() {
        setCallbackPhase('phone_popup');
        setShowPhonePopup(true);
        // Add a bot message acknowledging
        setMessages(prev => [...prev, {
            id: Date.now(),
            text: "That's wonderful! I'd be happy to arrange that for you. Please share your phone number and our team will reach out at a convenient time.",
            sender: 'bot',
            timestamp: new Date(),
            meta: { isCallbackFlow: true }
        }]);
    }

    function handleCallbackNo() {
        setCallbackPhase('submitted');
        setMessages(prev => [...prev, {
            id: Date.now(),
            text: "No worries at all! Thank you for your time and for negotiating with us. We truly appreciate your interest. Feel free to come back anytime — we're always here to help. Have a great day! 🙏",
            sender: 'bot',
            timestamp: new Date(),
            meta: { isCallbackFlow: true }
        }]);
    }

    async function handlePhoneSubmit() {
        // Validate phone
        const cleaned = phoneNumber.replace(/[\s\-\(\)]/g, '');
        if (!/^\+?\d{7,15}$/.test(cleaned)) {
            setPhoneError('Please enter a valid phone number (7-15 digits)');
            return;
        }
        setPhoneError('');
        setCallbackSaving(true);

        try {
            const result = await dbSaveCallbackRequest({
                session_id: dbSessionId,
                phone_number: cleaned,
                product_name: selectedProduct ? selectedProduct.name : 'Custom Product',
                negotiation_status: finalNegotiationStatus,
                final_price: finalDealPrice,
            });

            setShowPhonePopup(false);
            setCallbackPhase('submitted');

            if (result?.saved) {
                setMessages(prev => [...prev, {
                    id: Date.now(),
                    text: "Thank you so much! Your callback request has been saved successfully. Our team will reach out to you shortly at the number provided. We look forward to speaking with you! 🤝",
                    sender: 'bot',
                    timestamp: new Date(),
                    meta: { isCallbackFlow: true, callbackSaved: true }
                }]);
            } else {
                setMessages(prev => [...prev, {
                    id: Date.now(),
                    text: "Thank you for sharing your number. We've noted your interest — our team will follow up soon. Apologies for any delay in processing.",
                    sender: 'bot',
                    timestamp: new Date(),
                    meta: { isCallbackFlow: true }
                }]);
            }
        } catch (err) {
            setPhoneError('Failed to save. Please try again.');
        } finally {
            setCallbackSaving(false);
        }
    }

    const handleSendMessage = async (e) => {
        e.preventDefault();
        if (!inputValue.trim() || !sessionId || loading || negotiationEnded) return;

        const userText = inputValue.trim();
        const userMessage = {
            id: Date.now(),
            text: userText,
            sender: 'user',
            timestamp: new Date(),
            meta: {}
        };

        setMessages(prev => [...prev, userMessage]);
        setInputValue('');
        setLoading(true);
        setError(null);

        try {
            const response = await sendChat(sessionId, userText);
            if (response) {
                let botText = response.message;

                if (response.has_price_offer && response.pricing) {
                    const decision = response.pricing?.decision;
                    const counterPrice = response.pricing?.counter_offer_price;
                    const acceptedPrice = response.pricing?.accepted_price;

                    if (decision === 'counter' && counterPrice) {
                        botText += "\n\n\u{1F4B0} Counter offer: $" + parseFloat(counterPrice).toFixed(2);
                    } else if (decision === 'accept' && acceptedPrice) {
                        botText += "\n\n\u2705 Deal accepted at $" + parseFloat(acceptedPrice).toFixed(2) + "!";
                    } else if (decision === 'reject') {
                        botText += "\n\n\u274C Offer rejected.";
                    }

                    if (response.extracted_price) {
                        setMessages(prev => prev.map(m =>
                            m.id === userMessage.id
                                ? { ...m, meta: { ...m.meta, offeredPrice: parseFloat(response.extracted_price) } }
                                : m
                        ));
                    }
                    
                    if (response.competitor_price_claim || 
                        userText.toLowerCase().includes('too expensive') || 
                        userText.toLowerCase().includes('too high') || 
                        userText.toLowerCase().includes('cheaper')) {
                        setAutoExpandSignal(Date.now());
                    }
                }

                const botMessage = {
                    id: Date.now() + 1,
                    text: botText,
                    sender: 'bot',
                    timestamp: new Date(),
                    meta: {
                        decision: response.pricing?.decision,
                        counterPrice: response.pricing?.counter_offer_price,
                        acceptedPrice: response.pricing?.accepted_price,
                        round: response.round_number,
                        roundsRemaining: response.rounds_remaining,
                        status: response.status,
                        margin: response.pricing?.margin_percentage,
                        isChat: !response.has_price_offer,
                    }
                };
                setMessages(prev => [...prev, botMessage]);

                // ── Persist round to MySQL ──
                const roundDecision = response.pricing?.decision || (response.has_price_offer ? 'counter' : 'chat');
                const offeredPrice = response.extracted_price ? parseFloat(response.extracted_price) : null;
                const counterPrice = response.pricing?.counter_offer_price ? parseFloat(response.pricing.counter_offer_price) : null;
                const acceptedPrice = response.pricing?.accepted_price ? parseFloat(response.pricing.accepted_price) : null;

                if (offeredPrice) setLastBuyerOffer(offeredPrice);
                if (counterPrice) setLastSellerOffer(counterPrice);
                if (acceptedPrice) setLastSellerOffer(acceptedPrice);

                await dbSaveMessage(dbSessionId, {
                    round_number: response.round_number || 0,
                    user_message: userText,
                    bot_reply: botText,
                    offered_price: offeredPrice,
                    counter_price: counterPrice || acceptedPrice,
                    decision: roundDecision,
                });

                if (response.can_continue === false) {
                    setNegotiationEnded(true);

                    // ── Close session in MySQL (with error handling + retry) ──
                    const finalStatus = response.status || roundDecision;
                    const dealWasMade = roundDecision === 'accept';
                    let dbSaveFailed = false;
                    try {
                        await dbCloseSession(dbSessionId, {
                            status: finalStatus,
                            final_price: dealWasMade ? (acceptedPrice || offeredPrice) : null,
                            final_decision: finalStatus,
                            deal_closed: dealWasMade,
                            buyer_last_offer: offeredPrice || lastBuyerOffer,
                            seller_last_offer: counterPrice || acceptedPrice || lastSellerOffer,
                            rounds_used: response.round_number || 0,
                        });
                    } catch (closeErr) {
                        console.error('[DB] Failed to save session close:', closeErr);
                        dbSaveFailed = true;
                    }

                    // ── Trigger callback scheduling flow ──
                    setFinalNegotiationStatus(finalStatus);
                    setFinalDealPrice(dealWasMade ? (acceptedPrice || offeredPrice) : null);
                    setCallbackPhase('asking');

                    // Add a professional message asking about scheduling a call
                    setTimeout(() => {
                        const dbWarning = dbSaveFailed
                            ? "\n\n⚠️ Note: We had trouble saving this session to our records. Don't worry — your negotiation result is still valid. Our team will follow up if needed."
                            : "";
                        setMessages(prev => [...prev, {
                            id: Date.now() + 100,
                            text: "Thank you for taking the time to negotiate with us — we truly value your interest.\n\nWould you like us to schedule a professional call to discuss this further? Our team would be happy to connect with you at your convenience." + dbWarning,
                            sender: 'bot',
                            timestamp: new Date(),
                            meta: { isCallbackPrompt: true }
                        }]);
                    }, 1200);
                }
            } else {
                setError('Empty response from server');
            }
        } catch (err) {
            console.error('Send message error:', err);
            // Edge case: handle auth expiry mid-negotiation
            if (err.message?.includes('401') || err.message?.includes('Authentication expired') || err.message?.includes('Token expired')) {
                setError("Your session has expired. Please log in again to continue.");
            } else if (err.message?.includes('timed out')) {
                setError("The AI took too long to respond. Please try again.");
            } else {
                setError("Failed to send: " + err.message);
            }
        } finally {
            setLoading(false);
        }
    };

    //  SETUP SCREEN 
    if (showSetup) {
        const isDbMode = configSource === 'database';
        const canStart = isDbMode
            ? (selectedProduct && backendHealthy === true)
            : (config.productName?.trim() && config.basePrice > 0 && config.costPrice > 0 && config.costPrice < config.basePrice && backendHealthy === true);

        return (
            <div className="min-h-screen bg-neo-cream flex items-center justify-center p-4">
                <div className="w-full max-w-lg">
                    <div className="flex items-center justify-center gap-3 mb-8">
                        <div className="w-12 h-12 bg-neo-orange flex items-center justify-center border-4 border-neo-navy">
                            <TrendingUp className="w-7 h-7 text-neo-navy" />
                        </div>
                        <h1 className="text-3xl font-bold font-heading text-neo-navy">Peitho</h1>
                    </div>

                    <div className="neo-card p-6 space-y-6">
                        <h2 className="text-xl font-bold text-neo-navy text-center font-heading">Configure Negotiation</h2>

                        {/* Source Toggle: Database vs Manual */}
                        <div>
                            <label className="text-xs font-bold text-neo-navy/60 mb-2 block uppercase tracking-widest">Product Source</label>
                            <div className="grid grid-cols-2 gap-3">
                                <button
                                    onClick={() => { setConfigSource('database'); setSelectedProduct(null); }}
                                    className={"px-4 py-3 border-3 border-neo-navy font-bold text-sm transition-all flex items-center justify-center gap-2 " + (isDbMode ? 'bg-neo-teal text-neo-cream shadow-neo' : 'bg-white text-neo-navy hover:bg-neo-navy/5')}
                                >
                                    <Database className="w-4 h-4" />
                                    FROM DATABASE
                                </button>
                                <button
                                    onClick={() => { setConfigSource('manual'); setSelectedProduct(null); }}
                                    className={"px-4 py-3 border-3 border-neo-navy font-bold text-sm transition-all flex items-center justify-center gap-2 " + (!isDbMode ? 'bg-neo-teal text-neo-cream shadow-neo' : 'bg-white text-neo-navy hover:bg-neo-navy/5')}
                                >
                                    <Edit3 className="w-4 h-4" />
                                    MANUAL ENTRY
                                </button>
                            </div>
                        </div>

                        {/* ── Database Product Picker ── */}
                        {isDbMode && (
                            <div>
                                <label className="text-xs font-bold text-neo-navy/60 mb-2 block uppercase tracking-widest">Select Product</label>
                                <div className="relative" ref={productDropdownRef}>
                                    {/* Search / Trigger */}
                                    <div
                                        className={"flex items-center border-3 border-neo-navy overflow-hidden cursor-pointer " + (selectedProduct ? 'bg-neo-teal/10' : 'bg-white')}
                                        onClick={() => setShowProductDropdown(!showProductDropdown)}
                                    >
                                        <span className="px-3 py-3 bg-neo-navy text-neo-cream">
                                            <Package className="w-5 h-5" />
                                        </span>
                                        {showProductDropdown ? (
                                            <input
                                                type="text"
                                                value={productSearch}
                                                onChange={e => setProductSearch(e.target.value)}
                                                placeholder="Search products..."
                                                className="flex-1 px-3 py-3 bg-transparent text-neo-navy font-bold focus:outline-none"
                                                autoFocus
                                                onClick={e => e.stopPropagation()}
                                            />
                                        ) : (
                                            <span className={"flex-1 px-3 py-3 font-bold " + (selectedProduct ? 'text-neo-navy' : 'text-neo-navy/50')}>
                                                {selectedProduct ? selectedProduct.name : 'Choose a product...'}
                                            </span>
                                        )}
                                        <span className="px-3 py-3 text-neo-navy">
                                            <ChevronDown className={"w-5 h-5 transition-transform " + (showProductDropdown ? 'rotate-180' : '')} />
                                        </span>
                                    </div>

                                    {/* Dropdown */}
                                    {showProductDropdown && (
                                        <div className="absolute left-0 right-0 top-full mt-1 bg-white border-3 border-neo-navy z-50 max-h-64 overflow-y-auto shadow-neo product-dropdown">
                                            {productsLoading ? (
                                                <div className="flex items-center justify-center gap-2 p-4 text-neo-navy/60">
                                                    <Loader2 className="w-4 h-4 animate-spin" /> Loading products...
                                                </div>
                                            ) : filteredProducts.length === 0 ? (
                                                <div className="p-4 text-center">
                                                    <Package className="w-8 h-8 text-neo-navy/20 mx-auto mb-2" />
                                                    <p className="text-sm text-neo-navy/50 font-bold">
                                                        {products.length === 0 ? 'No products found. Add products in the Products section first.' : 'No matching products.'}
                                                    </p>
                                                </div>
                                            ) : (
                                                filteredProducts.map(p => (
                                                    <button
                                                        key={p.id}
                                                        onClick={() => selectProduct(p)}
                                                        className={"w-full text-left px-4 py-3 hover:bg-neo-orange/10 transition-colors border-b border-neo-navy/10 last:border-b-0 " + (selectedProduct?.id === p.id ? 'bg-neo-teal/10' : '')}
                                                    >
                                                        <div className="flex items-center justify-between">
                                                            <div>
                                                                <p className="font-bold text-neo-navy text-sm">{p.name}</p>
                                                                <p className="text-xs text-neo-navy/50 mt-0.5">
                                                                    {p.category} · {p.mode === 'MAX_PROFIT' ? 'Max Profit' : 'Min Loss'} · {p.maxRounds} rounds
                                                                </p>
                                                            </div>
                                                            <div className="text-right">
                                                                <p className="font-bold text-neo-teal text-sm">{formatMoney(p.basePrice, p.currency || 'INR')}</p>
                                                                <p className="text-xs text-neo-navy/40">Cost: {formatMoney(p.costPrice, p.currency || 'INR')}</p>
                                                            </div>
                                                        </div>
                                                    </button>
                                                ))
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* Selected Product Summary Card */}
                                {selectedProduct && (
                                    <div className="mt-3 border-3 border-neo-navy bg-neo-teal/5 p-4 space-y-3">
                                        <div className="flex items-center justify-between">
                                            <h3 className="font-bold text-neo-navy text-sm flex items-center gap-2">
                                                <Package className="w-4 h-4 text-neo-teal" />
                                                {selectedProduct.name}
                                            </h3>
                                            <button
                                                onClick={() => { setSelectedProduct(null); setConfig({ productName: 'Sony WH-1000XM5', mode: 'MAX_PROFIT', maxRounds: 10, basePrice: 2499, costPrice: 1500 }); }}
                                                className="text-neo-navy/40 hover:text-neo-maroon transition-colors"
                                            >
                                                <X className="w-4 h-4" />
                                            </button>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div className="border-2 border-neo-navy/20 p-2 bg-white">
                                                <p className="text-[10px] font-bold text-neo-navy/50 uppercase tracking-widest">Base Price</p>
                                                <p className="text-lg font-bold text-neo-navy">{formatMoney(selectedProduct.basePrice, selectedProduct.currency || 'INR')}</p>
                                            </div>
                                            <div className="border-2 border-neo-navy/20 p-2 bg-white">
                                                <p className="text-[10px] font-bold text-neo-navy/50 uppercase tracking-widest">Cost Price</p>
                                                <p className="text-lg font-bold text-neo-navy">{formatMoney(selectedProduct.costPrice, selectedProduct.currency || 'INR')}</p>
                                            </div>
                                            <div className="border-2 border-neo-navy/20 p-2 bg-white">
                                                <p className="text-[10px] font-bold text-neo-navy/50 uppercase tracking-widest">Min Acceptable</p>
                                                <p className="text-lg font-bold text-neo-navy">{formatMoney(selectedProduct.minAcceptablePrice, selectedProduct.currency || 'INR')}</p>
                                            </div>
                                            <div className="border-2 border-neo-navy/20 p-2 bg-white">
                                                <p className="text-[10px] font-bold text-neo-navy/50 uppercase tracking-widest">Margin</p>
                                                <p className="text-lg font-bold text-neo-teal">
                                                    {((selectedProduct.basePrice - selectedProduct.costPrice) / selectedProduct.basePrice * 100).toFixed(1)}%
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="px-2 py-1 bg-neo-teal text-neo-cream font-bold text-[10px] border border-neo-navy uppercase">
                                                {selectedProduct.mode === 'MAX_PROFIT' ? 'Max Profit' : 'Min Loss'}
                                            </span>
                                            <span className="px-2 py-1 bg-neo-navy text-neo-cream font-bold text-[10px] border border-neo-navy uppercase">
                                                {selectedProduct.maxRounds} Rounds
                                            </span>
                                            <span className="px-2 py-1 bg-neo-orange/20 text-neo-navy font-bold text-[10px] border border-neo-navy uppercase">
                                                {selectedProduct.category}
                                            </span>
                                        </div>
                                        <div className="mt-2 pt-2 border-t-2 border-neo-navy/10 flex items-center justify-between text-xs font-bold text-neo-teal">
                                            <span className="flex items-center gap-1.5">
                                                <TrendingDown className="w-4 h-4 text-neo-orange animate-pulse" />
                                                Market Price Bubbles
                                            </span>
                                            <span className="bg-neo-navy text-neo-cream text-[10px] font-black px-2 py-0.5 border border-neo-navy uppercase">
                                                Active Beside Chat
                                            </span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ── Manual Entry Fields ── */}
                        {!isDbMode && (
                            <>
                                {/* Product Name */}
                                <div>
                                    <label className="text-xs font-bold text-neo-navy/60 mb-2 block uppercase tracking-widest">Product Name</label>
                                    <div className="flex items-center border-3 border-neo-navy bg-white">
                                        <span className="px-3 py-2.5 bg-neo-navy text-neo-cream font-bold">
                                            <Package className="w-5 h-5" />
                                        </span>
                                        <input
                                            type="text"
                                            value={config.productName || ''}
                                            onChange={(e) => setConfig({ ...config, productName: e.target.value })}
                                            placeholder="e.g. Logitech MX Master 3S, Sony WH-1000XM5..."
                                            className="flex-1 px-3 py-2.5 bg-transparent text-neo-navy font-bold text-base focus:outline-none"
                                        />
                                    </div>
                                    <p className="text-[11px] font-semibold text-neo-teal mt-1">
                                        TradeMind will scrape live competitor prices from Amazon and Flipkart for this product.
                                    </p>
                                </div>

                                {/* Mode Toggle */}
                                <div>
                                    <label className="text-xs font-bold text-neo-navy/60 mb-2 block uppercase tracking-widest">Strategy Mode</label>
                                    <div className="grid grid-cols-2 gap-3">
                                        <button
                                            onClick={() => setConfig({ ...config, mode: 'MAX_PROFIT' })}
                                            className={"px-4 py-3 border-3 border-neo-navy font-bold text-sm transition-all flex items-center justify-center gap-2 " + (config.mode === 'MAX_PROFIT' ? 'bg-neo-teal text-neo-cream shadow-neo' : 'bg-white text-neo-navy hover:bg-neo-navy/5')}
                                        >
                                            <Zap className="w-4 h-4" />
                                            MAX PROFIT
                                        </button>
                                        <button
                                            onClick={() => setConfig({ ...config, mode: 'MIN_LOSS' })}
                                            className={"px-4 py-3 border-3 border-neo-navy font-bold text-sm transition-all flex items-center justify-center gap-2 " + (config.mode === 'MIN_LOSS' ? 'bg-neo-teal text-neo-cream shadow-neo' : 'bg-white text-neo-navy hover:bg-neo-navy/5')}
                                        >
                                            <Shield className="w-4 h-4" />
                                            MIN LOSS
                                        </button>
                                    </div>
                                </div>

                                {/* Max Rounds */}
                                <div>
                                    <label className="text-xs font-bold text-neo-navy/60 mb-2 block uppercase tracking-widest">Max Rounds</label>
                                    <div className="flex items-center gap-3">
                                        <button
                                            onClick={() => setConfig({ ...config, maxRounds: Math.max(1, config.maxRounds - 1) })}
                                            className="w-11 h-11 border-3 border-neo-navy bg-white flex items-center justify-center hover:bg-neo-navy/5"
                                        >
                                            <Minus className="w-4 h-4" />
                                        </button>
                                        <div className="flex-1 px-4 py-2.5 border-3 border-neo-navy bg-neo-teal text-neo-cream text-center font-bold text-xl shadow-neo">
                                            {config.maxRounds}
                                        </div>
                                        <button
                                            onClick={() => setConfig({ ...config, maxRounds: Math.min(20, config.maxRounds + 1) })}
                                            className="w-11 h-11 border-3 border-neo-navy bg-white flex items-center justify-center hover:bg-neo-navy/5"
                                        >
                                            <Plus className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>

                                {/* Quantity */}
                                <div>
                                    <label className="text-xs font-bold text-neo-navy/60 mb-2 block uppercase tracking-widest">Quantity</label>
                                    <div className="flex items-center gap-3">
                                        <button
                                            onClick={() => setConfig({ ...config, quantity: Math.max(1, config.quantity - 1) })}
                                            className="w-11 h-11 border-3 border-neo-navy bg-white flex items-center justify-center hover:bg-neo-navy/5"
                                        >
                                            <Minus className="w-4 h-4" />
                                        </button>
                                        <div className="flex-1 px-4 py-2.5 border-3 border-neo-navy bg-neo-teal text-neo-cream text-center font-bold text-xl shadow-neo">
                                            {config.quantity}
                                        </div>
                                        <button
                                            onClick={() => setConfig({ ...config, quantity: Math.min(1000, config.quantity + 1) })}
                                            className="w-11 h-11 border-3 border-neo-navy bg-white flex items-center justify-center hover:bg-neo-navy/5"
                                        >
                                            <Plus className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>

                                {/* Base Price */}
                                <div>
                                    <label className="text-xs font-bold text-neo-navy/60 mb-2 block uppercase tracking-widest">Base Price (Selling Price)</label>
                                    <div className="flex items-center border-3 border-neo-navy overflow-hidden">
                                        <span className="px-3 py-2.5 bg-neo-navy text-neo-cream font-bold text-lg">₹</span>
                                        <input
                                            type="number"
                                            value={config.basePrice}
                                            onChange={(e) => setConfig({ ...config, basePrice: parseFloat(e.target.value) || 0 })}
                                            className="flex-1 px-3 py-2.5 bg-white text-neo-navy font-bold text-lg focus:outline-none config-input"
                                            min="1"
                                            step="1"
                                        />
                                    </div>
                                </div>

                                {/* Cost Price */}
                                <div>
                                    <label className="text-xs font-bold text-neo-navy/60 mb-2 block uppercase tracking-widest">Actual Cost Price</label>
                                    <div className="flex items-center border-3 border-neo-navy overflow-hidden">
                                        <span className="px-3 py-2.5 bg-neo-navy text-neo-cream font-bold text-lg">₹</span>
                                        <input
                                            type="number"
                                            value={config.costPrice}
                                            onChange={(e) => setConfig({ ...config, costPrice: parseFloat(e.target.value) || 0 })}
                                            className="flex-1 px-3 py-2.5 bg-white text-neo-navy font-bold text-lg focus:outline-none config-input"
                                            min="1"
                                            step="1"
                                        />
                                    </div>
                                </div>

                                {config.costPrice >= config.basePrice && (
                                    <p className="text-neo-maroon text-sm font-bold flex items-center gap-1">
                                        <AlertCircle className="w-4 h-4" /> Cost price must be less than base price
                                    </p>
                                )}
                            </>
                        )}

                        {backendHealthy === false && (
                            <div className="bg-neo-maroon/10 border-2 border-neo-maroon p-3 text-sm text-neo-maroon font-bold flex items-center gap-2">
                                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                                Backend not available. Start the server first.
                            </div>
                        )}
                        {backendHealthy === null && (
                            <div className="flex items-center gap-2 text-neo-navy/50 text-sm">
                                <Loader2 className="w-4 h-4 animate-spin" /> Checking backend...
                            </div>
                        )}

                        <button
                            onClick={startNegotiation}
                            disabled={loading || !canStart}
                            className={"w-full py-4 border-3 border-neo-navy font-bold text-lg flex items-center justify-center gap-2 transition-all " + (loading || !canStart ? 'bg-neo-navy/20 text-neo-navy/40 cursor-not-allowed' : 'bg-neo-orange text-neo-navy shadow-neo hover:shadow-none hover:translate-x-[3px] hover:translate-y-[3px]')}
                        >
                            {loading ? (
                                <><Loader2 className="w-5 h-5 animate-spin" /> Scraping Live Market & Starting...</>
                            ) : (
                                <><TrendingUp className="w-5 h-5" /> Start Negotiation</>
                            )}
                        </button>

                        {isDbMode && !selectedProduct && products.length === 0 && !productsLoading && (
                            <p className="text-neo-navy/50 text-xs text-center font-bold">
                                No products in your catalog yet. Add products in the <a href="/products" className="text-neo-teal underline hover:text-neo-orange">Products</a> section or switch to Manual Entry.
                            </p>
                        )}

                        {error && <p className="text-neo-maroon text-sm text-center font-bold">{error}</p>}
                    </div>
                </div>
            </div>
        );
    }

    //  CHAT SCREEN 
    return (
        <div className="min-h-screen bg-neo-cream flex flex-col">
            <header className="bg-neo-navy text-neo-cream border-b-4 border-neo-navy p-4">
                <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 shrink-0 whitespace-nowrap">
                        <div className="w-10 h-10 bg-neo-orange flex items-center justify-center border-2 border-neo-cream">
                            <TrendingUp className="w-6 h-6 text-neo-navy" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold font-heading">Peitho</h1>
                            <p className="text-sm text-neo-cream/70">AI Negotiation Engine</p>
                        </div>
                    </div>
                    <div className="hidden sm:flex flex-wrap items-center justify-end gap-2 min-w-0">
                        {selectedProduct && (
                            <span 
                                className="bg-neo-orange px-3 py-1 border-2 border-neo-cream font-bold text-xs text-neo-navy max-w-[200px] sm:max-w-[260px] md:max-w-[320px] truncate block"
                                title={selectedProduct.name}
                            >
                                {selectedProduct.name}
                            </span>
                        )}
                        <span className="bg-neo-teal px-3 py-1 border-2 border-neo-cream font-bold text-xs whitespace-nowrap">
                            {config.mode === 'MAX_PROFIT' ? 'MAX PROFIT' : 'MIN LOSS'}
                        </span>
                        <span className="bg-neo-teal px-3 py-1 border-2 border-neo-cream font-bold text-xs whitespace-nowrap">
                            {config.maxRounds} Rounds
                        </span>
                        <span className="bg-neo-teal px-3 py-1 border-2 border-neo-cream font-bold text-xs whitespace-nowrap">
                            Base {formatMoney(config.basePrice, productCurrency)}
                        </span>
                        <span className="bg-neo-teal px-3 py-1 border-2 border-neo-cream font-bold text-xs whitespace-nowrap">
                            Cost {formatMoney(config.costPrice, productCurrency)}
                        </span>
                        {/* Voice Call Button in Header */}
                        {sessionId && !negotiationEnded && (
                            <button
                                onClick={() => setShowVoiceCall(true)}
                                className="flex items-center gap-1.5 bg-neo-orange px-3 py-1 border-2 border-neo-cream font-bold text-xs text-neo-navy hover:bg-neo-orange/80 transition-all shrink-0"
                                title="Start voice negotiation"
                            >
                                <PhoneCall className="w-3.5 h-3.5" />
                                CALL
                            </button>
                        )}
                    </div>
                </div>
            </header>

            {error && (
                <div className="bg-neo-maroon text-neo-cream border-b-2 border-neo-navy p-3">
                    <div className="max-w-4xl mx-auto flex items-center gap-2 text-sm">
                        <AlertCircle className="w-4 h-4 flex-shrink-0" />
                        <p>{error}</p>
                        <button onClick={() => setError(null)} className="ml-auto underline text-xs">Dismiss</button>
                    </div>
                </div>
            )}

            <div className="flex-1 overflow-y-auto p-4 max-w-4xl mx-auto w-full">
                <div className="space-y-4">
                    {messages.length === 0 ? (
                        <div className="text-center py-12">
                            <TrendingUp className="w-12 h-12 text-neo-teal/30 mx-auto mb-4" />
                            <h3 className="text-lg font-bold text-neo-navy mb-2">Start Negotiating</h3>
                            <p className="text-neo-navy/60">Say hello, ask about the product, or make a price offer!</p>
                        </div>
                    ) : (
                        messages.map((msg) => (
                            <div
                                key={msg.id}
                                className={"flex " + (msg.sender === 'user' ? 'justify-end' : 'justify-start')}
                            >
                                <div className={"chat-message-" + msg.sender + " flex flex-col"}>
                                    <p className="text-sm whitespace-pre-line">{msg.text}</p>

                                    {/* Callback prompt — Yes/No buttons */}
                                    {msg.meta?.isCallbackPrompt && callbackPhase === 'asking' && (
                                        <div className="flex gap-3 mt-3">
                                            <button
                                                onClick={handleCallbackYes}
                                                className="flex items-center gap-2 px-5 py-2.5 bg-neo-orange text-neo-navy border-2 border-neo-navy font-bold text-sm shadow-neo hover:shadow-none hover:translate-x-[2px] hover:translate-y-[2px] transition-all"
                                            >
                                                <Phone className="w-4 h-4" />
                                                Yes, Schedule a Call
                                            </button>
                                            <button
                                                onClick={handleCallbackNo}
                                                className="flex items-center gap-2 px-5 py-2.5 bg-white text-neo-navy border-2 border-neo-navy font-bold text-sm hover:bg-neo-navy/5 transition-all"
                                            >
                                                No, Thank You
                                            </button>
                                        </div>
                                    )}

                                    {/* Callback saved confirmation badge */}
                                    {msg.meta?.callbackSaved && (
                                        <div className="flex items-center gap-2 mt-2 px-3 py-1.5 bg-green-600/20 border border-green-500 rounded text-xs font-bold text-green-200">
                                            <CheckCircle className="w-3.5 h-3.5" />
                                            Callback request saved
                                        </div>
                                    )}

                                    <div className="flex items-center justify-between mt-1 gap-3">
                                        <span className="text-xs opacity-70">
                                            {msg.timestamp.toLocaleTimeString()}
                                        </span>
                                        {msg.meta?.round && (
                                            <span className="text-xs opacity-70">
                                                Round {msg.meta.round} • {msg.meta.roundsRemaining} left
                                            </span>
                                        )}
                                        {msg.meta?.offeredPrice && (
                                            <span className="text-xs font-bold opacity-90">
                                                {formatMoney(msg.meta.offeredPrice, productCurrency)}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                    {loading && (
                        <div className="flex justify-start">
                            <div className="chat-message-bot">
                                <div className="flex items-center gap-2">
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    <span>Thinking...</span>
                                </div>
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>
            </div>

            {negotiationEnded && callbackPhase === 'submitted' && (
                <div className="bg-neo-navy text-neo-cream p-4 border-t-4 border-neo-orange">
                    <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
                        <p className="font-bold font-heading">Negotiation Complete</p>
                        <button
                            onClick={resetToSetup}
                            className="neo-button bg-neo-orange text-neo-navy px-5 py-2 font-bold flex items-center gap-2 text-sm"
                        >
                            <RotateCcw className="w-4 h-4" /> New Negotiation
                        </button>
                    </div>
                </div>
            )}

            {/* Phone Number Popup Modal */}
            {showPhonePopup && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowPhonePopup(false)}>
                    <div
                        className="w-full max-w-md bg-neo-cream border-4 border-neo-navy shadow-neo p-0 animate-popup"
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Popup Header */}
                        <div className="bg-neo-navy text-neo-cream p-4 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 bg-neo-orange flex items-center justify-center border-2 border-neo-cream">
                                    <Phone className="w-5 h-5 text-neo-navy" />
                                </div>
                                <div>
                                    <h3 className="font-bold font-heading text-lg">Schedule a Call</h3>
                                    <p className="text-xs text-neo-cream/70">We'll reach out at your convenience</p>
                                </div>
                            </div>
                            <button
                                onClick={() => { setShowPhonePopup(false); setCallbackPhase('asking'); }}
                                className="w-8 h-8 flex items-center justify-center hover:bg-white/10 transition-colors"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Popup Body */}
                        <div className="p-6 space-y-4">
                            <p className="text-sm text-neo-navy/80">
                                Please enter your phone number below. Our team will contact you to discuss the details further.
                            </p>

                            <div>
                                <label className="text-xs font-bold text-neo-navy/60 mb-2 block uppercase tracking-widest">
                                    Phone Number
                                </label>
                                <div className="flex items-center border-3 border-neo-navy overflow-hidden">
                                    <span className="px-3 py-3 bg-neo-navy text-neo-cream font-bold text-lg">
                                        <Phone className="w-5 h-5" />
                                    </span>
                                    <input
                                        type="tel"
                                        value={phoneNumber}
                                        onChange={e => { setPhoneNumber(e.target.value); setPhoneError(''); }}
                                        placeholder="+1 (555) 123-4567"
                                        className="flex-1 px-4 py-3 bg-white text-neo-navy font-bold text-lg focus:outline-none"
                                        autoFocus
                                        onKeyDown={e => { if (e.key === 'Enter') handlePhoneSubmit(); }}
                                    />
                                </div>
                                {phoneError && (
                                    <p className="text-neo-maroon text-xs font-bold mt-2 flex items-center gap-1">
                                        <AlertCircle className="w-3.5 h-3.5" /> {phoneError}
                                    </p>
                                )}
                            </div>

                            <div className="flex gap-3 pt-2">
                                <button
                                    onClick={handlePhoneSubmit}
                                    disabled={callbackSaving || !phoneNumber.trim()}
                                    className={"flex-1 py-3 border-3 border-neo-navy font-bold text-sm flex items-center justify-center gap-2 transition-all " + (callbackSaving || !phoneNumber.trim() ? 'bg-neo-navy/20 text-neo-navy/40 cursor-not-allowed' : 'bg-neo-orange text-neo-navy shadow-neo hover:shadow-none hover:translate-x-[2px] hover:translate-y-[2px]')}
                                >
                                    {callbackSaving ? (
                                        <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>
                                    ) : (
                                        <><CheckCircle className="w-4 h-4" /> Submit</>
                                    )}
                                </button>
                                <button
                                    onClick={() => { setShowPhonePopup(false); setCallbackPhase('asking'); }}
                                    className="px-5 py-3 border-3 border-neo-navy bg-white text-neo-navy font-bold text-sm hover:bg-neo-navy/5 transition-all"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Voice Call Overlay */}
            {showVoiceCall && sessionId && (
                <VoiceCall
                    sessionId={sessionId}
                    config={config}
                    selectedProduct={selectedProduct}
                    onClose={() => setShowVoiceCall(false)}
                    onMessage={(msg) => setMessages(prev => [...prev, msg])}
                />
            )}

            {!negotiationEnded && (
                <footer className="bg-neo-cream border-t-4 border-neo-navy p-4">
                    <form onSubmit={handleSendMessage} className="max-w-4xl mx-auto relative">
                        {/* Market Dock positioned at bottom-full end-0 mb-4 */}
                        <React.Suspense fallback={null}>
                            <MarketDock 
                                productId={selectedProduct ? String(selectedProduct.id) : 'TRADE-001'}
                                productName={selectedProduct ? selectedProduct.name : (config.productName || 'Wireless Earbuds')}
                                currency={productCurrency}
                                ourPrice={config.basePrice}
                                autoExpandSignal={autoExpandSignal} 
                            />
                        </React.Suspense>
                        <div className="flex gap-3">
                            <input
                                type="text"
                                value={inputValue}
                                onChange={(e) => setInputValue(e.target.value)}
                                placeholder={'Type anything — "hello", "why so expensive?", "I offer ₹70"...'}
                                className="flex-1 px-4 py-3 border-3 border-neo-navy bg-white text-neo-navy placeholder-neo-navy/50 focus:outline-none font-body"
                                disabled={loading || !sessionId}
                            />
                            {/* Voice Call Button in Footer */}
                            <button
                                type="button"
                                onClick={() => setShowVoiceCall(true)}
                                disabled={loading || !sessionId}
                                className={"neo-button px-4 py-3 font-bold flex items-center gap-2 " + (loading || !sessionId ? 'bg-neo-navy/30 opacity-50 cursor-not-allowed' : 'bg-neo-teal text-neo-cream hover:bg-neo-teal/90 border-3 border-neo-navy')}
                                title="Start voice call"
                            >
                                <PhoneCall className="w-5 h-5" />
                            </button>
                            <button
                                type="submit"
                                disabled={loading || !sessionId || !inputValue.trim()}
                                className={"neo-button px-6 py-3 font-bold flex items-center gap-2 " + (loading || !sessionId || !inputValue.trim() ? 'bg-neo-navy/30 opacity-50 cursor-not-allowed' : 'bg-neo-orange text-neo-navy hover:bg-neo-orange/90')}
                            >
                                <Send className="w-5 h-5" />
                                Send
                            </button>
                        </div>
                    </form>
                </footer>
            )}
        </div>
    );
}
