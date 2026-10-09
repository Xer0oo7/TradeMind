/**
 * usePeithoCall — React hook for dual-channel live negotiation copilot.
 *
 * Captures:
 * 1. SELLER Channel: Microphone via getUserMedia()
 * 2. BUYER Channel: Google Meet browser tab audio via getDisplayMedia()
 *
 * Downsamples audio to PCM16 16kHz mono and streams over WebSocket to the backend.
 * Receives live transcripts, PRANE-X engine recommendations, and tactical reply suggestions.
 */
import { useState, useRef, useCallback, useEffect } from 'react';

// URL helper
function getBackendUrls() {
  const envApi = import.meta.env.VITE_API_URL || import.meta.env.VITE_BACKEND_URL;
  if (envApi) {
    const http = envApi.replace(/\/+$/, '');
    const ws = http.replace(/^http/, 'ws');
    return { http, ws };
  }
  const proto = window.location.protocol;
  const host = window.location.hostname;
  return {
    http: `${proto}//${host}:8000`,
    ws: `${proto === 'https:' ? 'wss' : 'ws'}://${host}:8000`,
  };
}

const { http: API_BASE, ws: WS_BASE } = getBackendUrls();

/** Convert Int16Array PCM buffer to base64. */
function pcmToBase64(pcmData) {
  const uint8 = new Uint8Array(pcmData.buffer, pcmData.byteOffset, pcmData.byteLength);
  let binary = '';
  const len = uint8.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(uint8[i]);
  }
  return btoa(binary);
}

export function usePeithoCall() {
  const [status, setStatus] = useState('idle'); // idle | starting | active | ending | ended | error
  const [sessionId, setSessionId] = useState(null);
  const [error, setError] = useState(null);
  const [sttProvider, setSttProvider] = useState('ElevenLabs');

  const [language, setLanguage] = useState('en'); // 'en' | 'hi' | 'auto'

  // Per-channel live status indicators
  const [sellerStatus, setSellerStatus] = useState('connecting'); // connecting | live | error | inactive
  const [sellerReason, setSellerReason] = useState('Waiting for microphone...');
  const [buyerStatus, setBuyerStatus] = useState('connecting'); // connecting | live | error | inactive
  const [buyerReason, setBuyerReason] = useState('Waiting for Google Meet tab audio...');
  
  // Audio energies for visualizer
  const [sellerEnergy, setSellerEnergy] = useState(0);
  const [buyerEnergy, setBuyerEnergy] = useState(0);

  // Mute control
  const [isMicMuted, setIsMicMuted] = useState(false);
  const isMicMutedRef = useRef(false);

  // Transcripts & Engine Data
  const [transcripts, setTranscripts] = useState([]);
  const [partialSellerText, setPartialSellerText] = useState('');
  const [partialBuyerText, setPartialBuyerText] = useState('');
  const [advisory, setAdvisory] = useState(null);
  const [currentCounter, setCurrentCounter] = useState(null);
  const [currentRound, setCurrentRound] = useState(0);

  // Refs
  const wsRef = useRef(null);
  const audioContextRef = useRef(null);
  const sellerStreamRef = useRef(null);
  const buyerStreamRef = useRef(null);
  const sellerProcessorRef = useRef(null);
  const buyerProcessorRef = useRef(null);

  // Toggle mic mute
  const toggleMicMute = useCallback(() => {
    const nextState = !isMicMuted;
    setIsMicMuted(nextState);
    isMicMutedRef.current = nextState;
  }, [isMicMuted]);

  // Clean up all audio nodes and streams
  const cleanupAudio = useCallback(() => {
    if (sellerProcessorRef.current) {
      try { sellerProcessorRef.current.disconnect(); } catch (_) {}
      sellerProcessorRef.current = null;
    }
    if (buyerProcessorRef.current) {
      try { buyerProcessorRef.current.disconnect(); } catch (_) {}
      buyerProcessorRef.current = null;
    }
    if (sellerStreamRef.current) {
      sellerStreamRef.current.getTracks().forEach((track) => track.stop());
      sellerStreamRef.current = null;
    }
    if (buyerStreamRef.current) {
      buyerStreamRef.current.getTracks().forEach((track) => track.stop());
      buyerStreamRef.current = null;
    }
    if (audioContextRef.current) {
      try { audioContextRef.current.close(); } catch (_) {}
      audioContextRef.current = null;
    }
    setSellerEnergy(0);
    setBuyerEnergy(0);
  }, []);

  // Set up audio downsampler for a given stream and channel with keepalive
  const attachAudioStream = useCallback((audioCtx, stream, channel, onEnergy) => {
    const source = audioCtx.createMediaStreamSource(stream);
    const processor = audioCtx.createScriptProcessor(4096, 1, 1);
    let lastSendTs = Date.now();

    processor.onaudioprocess = (e) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      // Honor mic mute for seller
      if (channel === 'SELLER' && isMicMutedRef.current) {
        onEnergy(0);
        return;
      }

      const input = e.inputBuffer.getChannelData(0);

      // RMS and Peak calculation
      let sum = 0;
      let peak = 0;
      for (let i = 0; i < input.length; i++) {
        const absVal = Math.abs(input[i]);
        if (absVal > peak) peak = absVal;
        sum += input[i] * input[i];
      }
      const rms = Math.sqrt(sum / input.length);
      onEnergy(Math.min(1, rms * 12));

      const now = Date.now();
      const isQuiet = rms < 0.003;

      // Noise gate: only send quiet chunks if more than 1.5 seconds have elapsed (keepalive)
      if (isQuiet && (now - lastSendTs < 1500)) {
        return;
      }

      lastSendTs = now;

      // Downsample to 16kHz PCM16
      const ratio = audioCtx.sampleRate / 16000;
      const newLen = Math.round(input.length / ratio);
      const pcm = new Int16Array(newLen);
      for (let i = 0; i < newLen; i++) {
        const idx = Math.round(i * ratio);
        const s = isQuiet ? 0 : Math.max(-1, Math.min(1, input[idx] || 0));
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }

      const b64 = pcmToBase64(pcm);
      ws.send(JSON.stringify({
        type: 'audio',
        channel: channel,
        data: b64,
      }));
    };

    source.connect(processor);
    processor.connect(audioCtx.destination);
    return processor;
  }, []);

  // Handle incoming WebSocket messages
  const handleServerMessage = useCallback((msg) => {
    switch (msg.type) {
      case 'ready':
        if (msg.stt_provider) setSttProvider(msg.stt_provider);
        if (msg.current_counter) setCurrentCounter(msg.current_counter);
        break;

      case 'state':
        if (msg.stt_provider) setSttProvider(msg.stt_provider);
        if (msg.seller_status) setSellerStatus(msg.seller_status);
        if (msg.seller_reason) setSellerReason(msg.seller_reason);
        if (msg.buyer_status) setBuyerStatus(msg.buyer_status);
        if (msg.buyer_reason) setBuyerReason(msg.buyer_reason);
        break;

      case 'partial_transcript':
        if (msg.channel === 'SELLER') {
          setPartialSellerText(msg.text);
        } else {
          setPartialBuyerText(msg.text);
        }
        break;

      case 'final_transcript':
        if (msg.channel === 'SELLER') {
          setPartialSellerText('');
        } else {
          setPartialBuyerText('');
        }
        setTranscripts((prev) => {
          // If merged turn, update previous message bubble
          if (msg.is_merged && prev.length > 0 && prev[prev.length - 1].channel === msg.channel) {
            const updated = [...prev];
            updated[updated.length - 1] = {
              ...updated[updated.length - 1],
              text: msg.text,
              timestamp: msg.timestamp || Date.now() / 1000,
            };
            return updated;
          }
          return [
            ...prev,
            {
              id: msg.id || String(Date.now()),
              channel: msg.channel,
              text: msg.text,
              timestamp: msg.timestamp || Date.now() / 1000,
            },
          ];
        });
        break;

      case 'advisory':
        if (msg.data) {
          const advData = {
            ...msg.data,
            recommendation_id: msg.recommendation_id || msg.data.recommendation_id,
            source: msg.source || msg.data.source || 'template',
            timing: msg.timing || msg.data.timing,
          };
          setAdvisory(advData);
          if (advData.counter_price) {
            setCurrentCounter(advData.counter_price);
          }
          if (advData.metrics && advData.metrics.current_round !== undefined) {
            setCurrentRound(advData.metrics.current_round);
          }
        }
        break;

      case 'recommendation_update':
        setAdvisory((prev) => {
          if (!prev) return prev;
          // Order safety: discard update if recommendation_id doesn't match active card
          if (msg.recommendation_id && prev.recommendation_id && prev.recommendation_id !== msg.recommendation_id) {
            return prev;
          }
          return {
            ...prev,
            suggested_replies: msg.suggested_replies || prev.suggested_replies,
            source: msg.source || 'ai',
            timing: msg.timing || prev.timing,
          };
        });
        break;

      case 'seller_update':
        if (msg.current_counter) setCurrentCounter(msg.current_counter);
        if (msg.round !== undefined) setCurrentRound(msg.round);
        break;

      case 'call_ended':
        setStatus('ended');
        cleanupAudio();
        break;

      case 'error':
        setError(msg.message || 'Server error');
        break;

      default:
        break;
    }
  }, [cleanupAudio]);

  // Start Peitho Session
  const startCall = useCallback(async (sessionConfig, enableMeetAudio = true) => {
    try {
      setStatus('starting');
      setError(null);
      setTranscripts([]);
      setAdvisory(null);

      // 1. Initialize Peitho session via REST API
      const payload = { ...sessionConfig, language: sessionConfig.language || language };
      const res = await fetch(`${API_BASE}/api/v1/peitho/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error(`Failed to initialize session: ${res.statusText}`);
      }

      const initData = await res.json();
      const activeSessionId = initData.session_id;
      setSessionId(activeSessionId);
      setCurrentCounter(initData.initial_counter || sessionConfig.base_price);

      // 2. Capture Seller Microphone
      let sellerStream = null;
      try {
        sellerStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            sampleRate: 16000,
            channelCount: 1,
          },
        });
        sellerStreamRef.current = sellerStream;
        setSellerStatus('live');
        setSellerReason('Microphone active');
      } catch (err) {
        setSellerStatus('error');
        setSellerReason(`Mic error: ${err.message}`);
        throw new Error(`Microphone permission denied: ${err.message}`);
      }

      // 3. Capture Google Meet Tab Audio (via getDisplayMedia)
      let buyerStream = null;
      if (enableMeetAudio && navigator.mediaDevices.getDisplayMedia) {
        try {
          buyerStream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            },
          });
          buyerStreamRef.current = buyerStream;

          const audioTracks = buyerStream.getAudioTracks();
          if (audioTracks.length === 0) {
            setBuyerStatus('error');
            setBuyerReason("No audio track! Check 'Also share tab audio' in Chrome.");
            console.warn('User did not check "Share tab audio". Tab audio will not be captured.');
          } else {
            setBuyerStatus('live');
            setBuyerReason('Meet tab audio active');
          }
        } catch (err) {
          setBuyerStatus('error');
          setBuyerReason('Tab sharing cancelled or denied. Typed input available.');
          console.warn('Screen/tab audio capture cancelled or failed:', err);
        }
      } else {
        setBuyerStatus('inactive');
        setBuyerReason('Mic-only mode active. Use manual typed buyer input.');
      }

      // 4. Initialize AudioContext and Downsamplers
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }
      audioContextRef.current = audioCtx;

      // 5. Connect WebSocket
      const wsUrl = `${WS_BASE}/api/v1/peitho/ws/${activeSessionId}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = async () => {
        setStatus('active');
        if (audioCtx.state === 'suspended') {
          await audioCtx.resume();
        }

        // Attach seller mic downsampler
        if (sellerStreamRef.current) {
          sellerProcessorRef.current = attachAudioStream(
            audioCtx,
            sellerStreamRef.current,
            'SELLER',
            setSellerEnergy
          );
        }

        // Attach buyer tab audio downsampler
        if (buyerStreamRef.current && buyerStreamRef.current.getAudioTracks().length > 0) {
          buyerProcessorRef.current = attachAudioStream(
            audioCtx,
            buyerStreamRef.current,
            'BUYER',
            setBuyerEnergy
          );
        }
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          handleServerMessage(msg);
        } catch (e) {
          console.error('Failed to parse WS message:', e);
        }
      };

      ws.onerror = (e) => {
        console.error('Peitho WS error:', e);
        setError('Real-time connection error');
      };

      ws.onclose = () => {
        setStatus('ended');
        cleanupAudio();
      };

    } catch (err) {
      console.error('Failed to start Peitho call:', err);
      setError(err.message || 'Failed to start call');
      setStatus('error');
      cleanupAudio();
    }
  }, [attachAudioStream, cleanupAudio, handleServerMessage]);

  // Send typed transcript line (testing / fallback mode)
  const sendTypedLine = useCallback((channel, text) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setError('Cannot send: WebSocket is not open');
      return;
    }
    const cleanText = text.trim();
    if (!cleanText) return;

    ws.send(JSON.stringify({
      type: 'transcript_line',
      channel: channel,
      text: cleanText,
      is_final: true,
    }));
  }, []);

  // End Call
  const endCall = useCallback(() => {
    setStatus('ending');
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'end_call' }));
    }
    cleanupAudio();
    setStatus('ended');
  }, [cleanupAudio]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupAudio();
      if (wsRef.current) {
        try { wsRef.current.close(); } catch (_) {}
      }
    };
  }, [cleanupAudio]);

  return {
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
  };
}
