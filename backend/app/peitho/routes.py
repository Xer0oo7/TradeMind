"""
Peitho Live Assistant Routes — REST endpoints and dual-channel WebSocket copilot.

Receives audio or text streams from Seller Mic and Buyer Google Meet tab,
computes PRANE-X advisory recommendations, and feeds live suggestions to the seller.
"""
import asyncio
import base64
import json
import time
from typing import Optional
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException, Query, status
from fastapi.responses import JSONResponse
import structlog

from ..core.config import get_settings
from .schemas import (
    PeithoSessionConfig,
    TranscriptLine,
    ChannelType,
    AdvisoryResult,
    AdvisoryMetrics,
)
from .session_store import peitho_store
from .advisory import AdvisoryEngine
from .suggestions import generate_tactical_replies
from .stt import get_stt_adapter, TypedSTTAdapter

logger = structlog.get_logger(__name__)
settings = get_settings()

peitho_router = APIRouter(prefix="/api/v1/peitho", tags=["Peitho Live Assistant"])


@peitho_router.post("/start")
async def start_peitho_session(config: PeithoSessionConfig):
    """
    Initialize a new live negotiation session for Peitho.
    Returns session_id to be used in the WebSocket connection.
    """
    session = peitho_store.create_session(config)
    initial_counter = (
        session.master_state.counter_history[-1]
        if session.master_state.counter_history
        else config.base_price
    )
    return {
        "session_id": session.session_id,
        "product_name": config.product_name,
        "base_price": config.base_price,
        "cost_price": config.cost_price,
        "min_floor": config.min_floor,
        "mode": config.mode,
        "max_rounds": config.max_rounds,
        "initial_counter": initial_counter,
        "stt_provider": config.stt_provider or settings.peitho_stt_provider,
        "message": "Peitho session initialized successfully.",
    }


@peitho_router.get("/health")
async def peitho_health():
    """Check Peitho health and STT provider status."""
    has_elevenlabs = bool(settings.elevenlabs_api_key)
    active_sessions = peitho_store.list_active_sessions()
    return {
        "status": "online",
        "stt_provider": settings.peitho_stt_provider,
        "elevenlabs_configured": has_elevenlabs,
        "elevenlabs_model": settings.elevenlabs_stt_model,
        "active_sessions_count": len(active_sessions),
    }


@peitho_router.get("/sessions")
async def list_sessions():
    """List all currently active Peitho sessions."""
    return peitho_store.list_active_sessions()


@peitho_router.get("/sessions/{session_id}")
async def get_session(session_id: str):
    """Retrieve details for a specific session."""
    session = peitho_store.get_session(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found or expired",
        )
    return {
        "session_id": session.session_id,
        "product_name": session.config.product_name,
        "is_active": session.is_active,
        "current_round": session.master_state.current_round,
        "max_rounds": session.config.max_rounds,
        "counter_history": session.master_state.counter_history,
        "transcript_count": len(session.transcript_history),
        "last_advisory": session.last_advisory,
    }


@peitho_router.delete("/sessions/{session_id}")
async def delete_session(session_id: str):
    """End and delete a session."""
    deleted = peitho_store.delete_session(session_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found",
        )
    return {"message": "Session closed successfully"}


@peitho_router.websocket("/ws/{session_id}")
async def peitho_websocket(
    websocket: WebSocket,
    session_id: str,
    token: Optional[str] = Query(default=None),
):
    """
    Dual-channel real-time WebSocket for live Meet call copilot.
    
    Streams:
    - Inbound: Seller Mic audio / Buyer Google Meet audio (or typed transcript lines)
    - Outbound: Partial & final transcripts, deterministic advisory updates, and tactical responses
    """
    session = peitho_store.get_session(session_id)
    if not session:
        await websocket.accept()
        await websocket.send_json({
            "type": "error",
            "message": "Peitho session not found or expired. Please create a session first.",
        })
        await websocket.close(code=4004, reason="Session not found")
        return

    await websocket.accept()
    logger.info("peitho_ws_connected", session_id=session_id)

    # State tracking for channels and provider
    channel_states = {
        "provider": (session.config.stt_provider or settings.peitho_stt_provider or "typed").lower(),
        "seller_status": "connecting",
        "seller_reason": "Initializing seller audio channel...",
        "buyer_status": "connecting",
        "buyer_reason": "Initializing buyer audio channel...",
    }

    ws_lock = asyncio.Lock()

    async def safe_send(payload: dict):
        async with ws_lock:
            try:
                await websocket.send_json(payload)
            except Exception as e:
                logger.debug("peitho_ws_send_failed", error_type=type(e).__name__)

    async def broadcast_state():
        await safe_send({
            "type": "state",
            "stt_provider": channel_states["provider"],
            "seller_status": channel_states["seller_status"],
            "seller_reason": channel_states["seller_reason"],
            "buyer_status": channel_states["buyer_status"],
            "buyer_reason": channel_states["buyer_reason"],
        })

    def on_seller_status(status: str, reason: str = ""):
        channel_states["seller_status"] = status
        channel_states["seller_reason"] = reason or f"Seller channel is {status}"
        asyncio.create_task(broadcast_state())

    def on_buyer_status(status: str, reason: str = ""):
        channel_states["buyer_status"] = status
        channel_states["buyer_reason"] = reason or f"Buyer channel is {status}"
        asyncio.create_task(broadcast_state())

    # Instantiate initial STT adapters
    stt_choice = channel_states["provider"]
    seller_stt = get_stt_adapter(provider=stt_choice, channel="SELLER", on_status_change=on_seller_status)
    buyer_stt = get_stt_adapter(provider=stt_choice, channel="BUYER", on_status_change=on_buyer_status)

    # Send initial connection acknowledgment
    await websocket.send_json({
        "type": "ready",
        "session_id": session_id,
        "product_name": session.config.product_name,
        "base_price": session.config.base_price,
        "current_counter": (
            session.master_state.counter_history[-1]
            if session.master_state.counter_history
            else session.config.base_price
        ),
        "stt_provider": seller_stt.__class__.__name__,
        "message": "Connected to Peitho copilot. Audio capture active.",
    })

    # Task done callback logging exception type only
    def task_done_logger(t: asyncio.Task) -> None:
        if not t.cancelled():
            exc = t.exception()
            if exc:
                logger.error("peitho_async_task_error", error_type=type(exc).__name__)

    # ── Register SELLER STT Callbacks ──
    async def on_seller_partial(text: str):
        await safe_send({
            "type": "partial_transcript",
            "channel": ChannelType.SELLER.value,
            "text": text,
        })

    async def on_seller_final(text: str):
        line = TranscriptLine(
            channel=ChannelType.SELLER,
            text=text,
            is_partial=False,
            timestamp=time.time(),
        )
        session.transcript_history.append(line)

        await safe_send({
            "type": "final_transcript",
            "id": line.id,
            "channel": ChannelType.SELLER.value,
            "text": text,
            "timestamp": line.timestamp,
        })

        detected_price = AdvisoryEngine.apply_seller_line(session.master_state, text)
        if detected_price is not None:
            await safe_send({
                "type": "seller_update",
                "detected_price": detected_price,
                "current_counter": session.master_state.counter_history[-1],
                "round": session.master_state.current_round,
            })

    # ── Register BUYER STT Callbacks ──
    async def on_buyer_partial(text: str):
        await safe_send({
            "type": "partial_transcript",
            "channel": ChannelType.BUYER.value,
            "text": text,
        })

    async def process_buyer_final(text: str, line_id: str, timestamp: float):
        """Async worker evaluating advisory engine and pushing tactical replies."""
        try:
            engine_result, extraction = AdvisoryEngine.advise(
                session.master_state,
                buyer_text=text,
            )

            suggestions = await generate_tactical_replies(
                engine_result=engine_result,
                buyer_text=text,
                state=session.master_state,
            )

            decision_raw = str(getattr(engine_result, "decision", "counter")).lower()
            if decision_raw == "accept":
                action_str = "ACCEPT"
            elif decision_raw in ("reject", "session_terminated"):
                action_str = "REJECT"
            elif decision_raw == "final_offer":
                action_str = "FINAL_OFFER"
            else:
                action_str = "COUNTER"

            counter_val = float(
                getattr(engine_result, "counter_unit_price", None)
                if getattr(engine_result, "counter_unit_price", None) is not None
                else (
                    session.master_state.counter_history[-1]
                    if session.master_state.counter_history
                    else session.config.base_price
                )
            )

            is_walk_away = bool(getattr(engine_result, "session_terminated", False))
            reasoning_tag = getattr(engine_result, "reasoning_tag", None)
            tag_name = reasoning_tag.value if hasattr(reasoning_tag, "value") else str(reasoning_tag or "STRATEGIC_ADVISORY")
            phase_obj = getattr(engine_result, "phase", None)
            phase_name = phase_obj.value if hasattr(phase_obj, "value") else str(phase_obj or "EXPLORATION")
            reasoning_str = f"{tag_name} ({phase_name} Phase)"

            buyer_offers = session.master_state.offer_history
            velocity = 0.0
            if len(buyer_offers) >= 2:
                velocity = round(buyer_offers[-1] - buyer_offers[-2], 2)

            budget_denom = max(1.0, getattr(session.master_state, "total_concession_budget", 1.0))
            rem_budget = getattr(session.master_state, "remaining_concession_budget", 0.0)

            metrics = AdvisoryMetrics(
                bbi=round(getattr(engine_result, "bbi", session.master_state.bbi), 1),
                p_high_wtp=round(getattr(engine_result, "p_high_wtp", session.master_state.p_high_wtp), 2),
                surplus_share=round(max(0.0, min(1.0, rem_budget / budget_denom)), 2),
                buyer_concession_velocity=velocity,
                consecutive_stagnant=session.master_state.consecutive_stagnant,
                firmness_level=session.master_state.firmness_level,
                current_round=session.master_state.current_round,
                max_rounds=session.config.max_rounds,
            )

            advisory = AdvisoryResult(
                action=action_str,
                counter_price=counter_val,
                walk_away=is_walk_away,
                reasoning=reasoning_str,
                extracted_buyer_offer=extraction.get("unit_price_offered"),
                extracted_buyer_intent=extraction.get("intent"),
                extracted_quantity=extraction.get("quantity"),
                suggested_replies=suggestions,
                metrics=metrics,
                timestamp=time.time(),
            )

            session.last_advisory = advisory

            await safe_send({
                "type": "advisory",
                "data": advisory.model_dump(),
            })
        except Exception as e:
            logger.error("buyer_advisory_eval_failed", error_type=type(e).__name__)

    async def on_buyer_final(text: str):
        line = TranscriptLine(
            channel=ChannelType.BUYER,
            text=text,
            is_partial=False,
            timestamp=time.time(),
        )
        session.transcript_history.append(line)

        await safe_send({
            "type": "final_transcript",
            "id": line.id,
            "channel": ChannelType.BUYER.value,
            "text": text,
            "timestamp": line.timestamp,
        })

        # Non-blocking advisory execution
        task = asyncio.create_task(process_buyer_final(text, line.id, line.timestamp))
        task.add_done_callback(task_done_logger)

    def bind_adapters(s_adapter, b_adapter):
        s_adapter.on_partial(on_seller_partial)
        s_adapter.on_final(on_seller_final)
        b_adapter.on_partial(on_buyer_partial)
        b_adapter.on_final(on_buyer_final)

    bind_adapters(seller_stt, buyer_stt)

    # Start STT adapters
    await seller_stt.start()
    await buyer_stt.start()

    # Fallback check: if elevenlabs failed to activate, fall back to Sarvam, then Typed
    if channel_states["provider"] == "elevenlabs" and (not seller_stt.is_active or not buyer_stt.is_active):
        if settings.sarvam_api_key:
            logger.warning("elevenlabs_failed_falling_back_to_sarvam")
            channel_states["provider"] = "sarvam"
            try:
                await seller_stt.close()
                await buyer_stt.close()
            except Exception:
                pass
            seller_stt = get_stt_adapter(provider="sarvam", channel="SELLER", on_status_change=on_seller_status)
            buyer_stt = get_stt_adapter(provider="sarvam", channel="BUYER", on_status_change=on_buyer_status)
            bind_adapters(seller_stt, buyer_stt)
            await seller_stt.start()
            await buyer_stt.start()
        else:
            logger.warning("elevenlabs_failed_falling_back_to_typed")
            channel_states["provider"] = "typed"
            channel_states["seller_status"] = "live"
            channel_states["seller_reason"] = "Typed input fallback active"
            channel_states["buyer_status"] = "live"
            channel_states["buyer_reason"] = "Typed input fallback active"

    await broadcast_state()

    try:
        while True:
            raw_text = await websocket.receive_text()
            try:
                msg = json.loads(raw_text)
            except Exception:
                continue

            msg_type = msg.get("type")

            if msg_type == "audio":
                # Audio chunk from seller mic or buyer tab
                ch = str(msg.get("channel", "BUYER")).strip().upper()
                is_seller = ch in ("SELLER", "MIC")
                b64_data = msg.get("data", "")
                if b64_data:
                    try:
                        pcm_bytes = base64.b64decode(b64_data)
                        if is_seller:
                            await seller_stt.send_audio(pcm_bytes)
                        else:
                            await buyer_stt.send_audio(pcm_bytes)
                    except Exception as e:
                        logger.error("audio_decode_error", error_type=type(e).__name__)

            elif msg_type == "transcript_line":
                # Direct typed text injection (fallback or testing mode)
                ch = str(msg.get("channel", "BUYER")).strip().upper()
                is_seller = ch in ("SELLER", "MIC")
                text_content = msg.get("text", "")
                is_final = msg.get("is_final", True)

                target_adapter = seller_stt if is_seller else buyer_stt
                if isinstance(target_adapter, TypedSTTAdapter):
                    await target_adapter.send_text(text_content, is_final=is_final)
                else:
                    if is_seller:
                        if is_final:
                            await on_seller_final(text_content)
                        else:
                            await on_seller_partial(text_content)
                    else:
                        if is_final:
                            await on_buyer_final(text_content)
                        else:
                            await on_buyer_partial(text_content)

            elif msg_type == "ping":
                await safe_send({
                    "type": "pong",
                    "ts": time.time(),
                })

            elif msg_type == "end_call":
                logger.info("peitho_call_ended_by_user", session_id=session_id)
                await safe_send({
                    "type": "call_ended",
                    "session_id": session_id,
                })
                break

    except WebSocketDisconnect:
        logger.info("peitho_ws_disconnected", session_id=session_id)
    except Exception as e:
        logger.error("peitho_ws_unhandled_error", error_type=type(e).__name__, session_id=session_id)
    finally:
        try:
            await seller_stt.close()
            await buyer_stt.close()
        except Exception:
            pass

