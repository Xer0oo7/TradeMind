# Peitho Live Assistant for Google Meet — Architecture & Guide

Peitho is a real-time negotiation copilot for human sales representatives on live calls (e.g. Google Meet).

Peitho listens to dual-channel conversation audio:
1. **SELLER Channel**: Rep's microphone via `navigator.mediaDevices.getUserMedia()`.
2. **BUYER Channel**: Live Google Meet meeting audio captured from the Meet tab via `navigator.mediaDevices.getDisplayMedia()`.

Each buyer statement is evaluated by the **PRANE-X negotiation engine in advisory mode**, generating strategic recommendations (Counter, Accept, Final Offer, Walk Away) and 1-click tactical spoken replies in real time. **Nothing is ever sent to the buyer**; the human representative remains in full control.

---

## 1. Architecture Overview

```
 [Google Meet Tab]        [Rep Microphone]
         │                        │
         ▼ (getDisplayMedia)      ▼ (getUserMedia)
   Tab Audio (BUYER)        Mic Audio (SELLER)
         │                        │
         └────────────┬───────────┘
                      │ Downsampled to PCM16 16kHz
                      ▼
         [WebSocket /api/v1/peitho/ws/{session_id}]
                      │
                      ▼
            STT Adapter Layer
         ┌──────────────────────────────┐
         │ • ElevenLabs Scribe Realtime │
         │   (Auto-detects xi-api-key)  │
         │ • Typed / Fallback Adapter   │
         │   (Always active/no-key mode)│
         └────────────┬─────────────────┘
                      │
       ┌──────────────┴──────────────┐
       ▼                             ▼
SELLER Utterance              BUYER Utterance
       │                             │
       ▼                             ▼
AdvisoryEngine.apply_seller_line()  AdvisoryEngine.advise()
  (Mirrors quote in master state)     (Deep-copies master state)
                                     │
                                     ▼
                              process_round(cloned_state, buyer_offer)
                                     │
                                     ▼
                              Discard Cloned State (Master Untouched)
                                     │
                                     ▼
                              Tactical Spoken Reply Generator
                               (OpenRouter Async / Templates)
                                     │
                                     ▼
                       [Outbound WebSocket Events]
                         • Advisory Recommendation
                         • 1-Click Spoken Replies
                         • PRANE-X Telemetry (BBI, WTP, Budget)
```

---

## 2. Speech-to-Text (STT) Providers

### ElevenLabs Scribe Realtime (`backend/app/peitho/stt/elevenlabs.py`)
- **Protocol**: Real-time bidirectional WebSocket over `wss://api.elevenlabs.io/v1/speech-to-text/realtime`
- **Audio Format**: Mono PCM 16kHz, 16-bit
- **Model**: `scribe_v2_realtime`
- **Zero-Key Graceful Fallback**: If `ELEVENLABS_API_KEY` is not set or empty, the system automatically uses the **TypedSTTAdapter** so that development, testing, and manual live inputs work seamlessly without crashes.

#### Adding ElevenLabs Credentials Later
When you obtain your ElevenLabs API key:
1. Open `.env` (or set environment variables):
   ```env
   PEITHO_STT_PROVIDER=elevenlabs
   ELEVENLABS_API_KEY=your_elevenlabs_api_key_here
   ELEVENLABS_STT_MODEL=scribe_v2_realtime
   ELEVENLABS_LANGUAGE=en
   ```
2. Restart the backend. Peitho will immediately connect to ElevenLabs Scribe Realtime on both channels.

### Typed / Manual Fallback Adapter (`backend/app/peitho/stt/typed.py`)
- Always available out of the box with zero external dependencies.
- Accepts direct spoken or typed text utterances from either the SELLER or BUYER channel.
- Perfect for running tests, dry-runs, or typing live quotes while on a call.

---

## 3. How to Use on a Live Google Meet Call

1. **Open Google Meet**:
   - Start or join your Google Meet video call in a Chrome browser tab.
2. **Open Peitho Live**:
   - Navigate to `/peitho` in TradeMind (available via top navigation: **"Peitho Live"**).
3. **Configure Product & Margins**:
   - Set product name, base price, cost price, minimum floor, mode (`MAX_PROFIT` or `MIN_LOSS`), and quantity.
4. **Click "Start Peitho Live"**:
   - Allow microphone permissions for your voice.
   - When the Chrome screen-sharing dialog appears:
     - Click the **"Chrome Tab"** tab.
     - Select your **Google Meet tab**.
     - **Important:** Ensure the checkbox **"Also share tab audio"** at the bottom-left of the dialog is checked!
5. **During the Call**:
   - As the buyer speaks, their words appear in teal under the live feed.
   - PRANE-X calculates the optimal counter-offer and displays it in the side panel.
   - Read or copy the suggested tactical reply to respond naturally and protect your margin.

---

## 4. API Endpoints

### REST Endpoints
- `POST /api/v1/peitho/start`: Initializes a session, validates constraints, and generates session ID.
- `GET /api/v1/peitho/health`: Reports STT status, ElevenLabs configuration state, and active sessions.
- `GET /api/v1/peitho/sessions`: Lists active sessions.
- `GET /api/v1/peitho/sessions/{session_id}`: Retrieves state and transcript history for a session.
- `DELETE /api/v1/peitho/sessions/{session_id}`: Terminates and cleans up session.

### WebSocket Endpoint
`ws://localhost:8000/api/v1/peitho/ws/{session_id}`

#### Client → Server Messages:
- `{ "type": "audio", "channel": "SELLER"|"BUYER", "data": "<base64 PCM16>" }`
- `{ "type": "transcript_line", "channel": "SELLER"|"BUYER", "text": "...", "is_final": true }`
- `{ "type": "ping" }`
- `{ "type": "end_call" }`

#### Server → Client Messages:
- `{ "type": "ready", "session_id": "...", "product_name": "...", "stt_provider": "...", "language": "..." }`
- `{ "type": "state", "seller_status": "...", "buyer_status": "..." }`
- `{ "type": "partial_transcript", "channel": "SELLER"|"BUYER", "text": "..." }`
- `{ "type": "final_transcript", "channel": "SELLER"|"BUYER", "text": "...", "timestamp": float, "is_merged": bool }`
- `{ "type": "advisory", "recommendation_id": "...", "source": "template", "timing": {...}, "data": { "action": "COUNTER"|"ACCEPT"|"FINAL_OFFER"|"REJECT", "counter_price": float, "reasoning": str, "suggested_replies": [...], "metrics": {...} } }`
- `{ "type": "recommendation_update", "recommendation_id": "...", "source": "ai", "suggested_replies": [...], "timing": {...} }`
- `{ "type": "seller_update", "detected_price": float, "current_counter": float, "round": int }`
- `{ "type": "call_ended" }`

For full protocol details, see [PEITHO_PROTOCOL.md](PEITHO_PROTOCOL.md).
