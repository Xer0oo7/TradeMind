# Peitho Live Assistant — Real-Time WebSocket Protocol Specification

This document specifies the bidirectional WebSocket communication protocol between the Peitho frontend copilot and the TradeMind backend server at `/api/v1/peitho/ws/{session_id}`.

---

## 1. Connection & Lifecycle

- **Endpoint**: `/api/v1/peitho/ws/{session_id}`
- **Handshake**: Initiated by client after initializing a session via `POST /api/v1/peitho/start`.
- **Audio Format**: Mono PCM 16kHz, 16-bit little-endian, Base64-encoded, streamed in ~100ms chunks (3,200 bytes).

---

## 2. Inbound Messages (Client → Server)

### 2.1 Audio Chunk Stream (`audio`)
Streams raw voice audio from either the seller microphone or the buyer Google Meet browser tab.
```json
{
  "type": "audio",
  "channel": "SELLER", // "SELLER" (or "MIC") | "BUYER" (or "TAB")
  "data": "<base64_encoded_pcm16_16khz>"
}
```

### 2.2 Typed Transcript Line (`transcript_line`)
Direct textual injection for testing, manual synchronization, or zero-mic environments.
```json
{
  "type": "transcript_line",
  "channel": "BUYER", // "BUYER" | "SELLER"
  "text": "Could you do $400 for 2 units?",
  "is_final": true    // boolean: true for committed utterance, false for partial
}
```

### 2.3 Ping Keepalive (`ping`)
Synchronizes connection state and prevents reverse-proxy idle disconnects.
```json
{
  "type": "ping"
}
```

### 2.4 End Call (`end_call`)
Signals clean session termination by the human sales representative.
```json
{
  "type": "end_call"
}
```

---

## 3. Outbound Messages (Server → Client)

### 3.1 Initial Ready Ack (`ready`)
Sent immediately upon successful WebSocket handshake.
```json
{
  "type": "ready",
  "session_id": "36c3cb37-8081-40be-8976-7ee7cba3d438",
  "product_name": "High-Performance Cloud Compute Cluster",
  "base_price": 500.0,
  "current_counter": 500.0,
  "stt_provider": "ElevenLabsSTTAdapter",
  "language": "en",
  "message": "Connected to Peitho copilot. Audio capture active."
}
```

### 3.2 Dual-Channel Status (`state`)
Broadcasts channel state and connection health.
```json
{
  "type": "state",
  "stt_provider": "elevenlabs",
  "seller_status": "live",
  "seller_reason": "Connected to ElevenLabs Scribe",
  "buyer_status": "live",
  "buyer_reason": "Connected to ElevenLabs Scribe"
}
```

### 3.3 Partial Transcript (`partial_transcript`)
Real-time interim transcription hypothesis for live speech visualization.
```json
{
  "type": "partial_transcript",
  "channel": "BUYER", // "BUYER" | "SELLER"
  "text": "Can you offer"
}
```

### 3.4 Final Transcript (`final_transcript`)
VAD-committed speech segment. Subject to VAD merge guard (unpunctuated rapid fragments merged).
```json
{
  "type": "final_transcript",
  "id": "c869c025-a136-4767-8fd2-901b089c97b8",
  "channel": "BUYER",
  "text": "Can you offer 450 dollars?",
  "timestamp": 1728475200.123,
  "is_merged": false // true if combined with immediately preceding unpunctuated fragment
}
```

### 3.5 Stage 1 Immediate Advisory (`advisory`)
**Ultra-low-latency strategic recommendation (< 10ms from commit)**. Evaluates PRANE-X engine rules and produces instant deterministic template replies so the rep is never left waiting for an LLM.
```json
{
  "type": "advisory",
  "recommendation_id": "d981240a-5b12-4f81-9b7e-908b1a37c891",
  "source": "template",
  "timing": {
    "t0": 1728475199423.0,
    "t2": 1728475200123.0,
    "t5": 1728475200127.2,
    "t0_to_t2_ms": 700.0,
    "t2_to_t5_ms": 4.2
  },
  "data": {
    "action": "COUNTER",
    "counter_price": 475.0,
    "walk_away": false,
    "reasoning": "COMPROMISE_STEP (EXPLORATION Phase)",
    "extracted_buyer_offer": 450.0,
    "extracted_buyer_intent": "offer",
    "extracted_quantity": 1,
    "suggested_replies": [
      "I can meet you partway at $475.00 per unit if we can confirm the order today.",
      "How about we split the difference at $475.00? That keeps it workable on our end."
    ],
    "metrics": {
      "bbi": 42.5,
      "p_high_wtp": 0.65,
      "surplus_share": 0.58,
      "buyer_concession_velocity": 0.0,
      "consecutive_stagnant": 0,
      "firmness_level": 1,
      "current_round": 1,
      "max_rounds": 6
    },
    "timestamp": 1728475200.127
  }
}
```

### 3.6 Stage 2 Asynchronous AI Upgrade (`recommendation_update`)
**Additive Event**. Pushed concurrently when OpenRouter / Gemini tactical generation completes. Upgrades spoken replies seamlessly without causing price card flicker.
```json
{
  "type": "recommendation_update",
  "recommendation_id": "d981240a-5b12-4f81-9b7e-908b1a37c891",
  "source": "ai",
  "suggested_replies": [
    "I appreciate that number, but for this tier the best I can do is $475 today.",
    "If we lock in the shipment this afternoon, I can meet you at $475 per cluster."
  ],
  "timing": {
    "t0": 1728475199423.0,
    "t2": 1728475200123.0,
    "t5": 1728475200127.2,
    "t7": 1728475200895.0,
    "t2_to_t7_ms": 772.0,
    "t0_to_t7_ms": 1472.0
  }
}
```

### 3.7 Seller Quote Synchronized (`seller_update`)
Emitted when the human rep verbalizes an explicit counter-offer, keeping PRANE-X master state in exact lockstep.
```json
{
  "type": "seller_update",
  "detected_price": 475.0,
  "current_counter": 475.0,
  "round": 1
}
```

### 3.8 Pong Keepalive (`pong`)
```json
{
  "type": "pong",
  "ts": 1728475201.554
}
```

### 3.9 Call Ended (`call_ended`)
```json
{
  "type": "call_ended",
  "session_id": "36c3cb37-8081-40be-8976-7ee7cba3d438"
}
```

### 3.10 Error Notification (`error`)
```json
{
  "type": "error",
  "message": "Session not found or expired"
}
```
