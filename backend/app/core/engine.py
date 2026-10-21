"""
Negotiation Engine - Orchestration Layer

This is the main entry point that coordinates:
1. Context Analysis Agent
2. Pricing Strategy Agent
3. Conversation Agent

Responsibilities:
- Session lifecycle
- Agent coordination
- State persistence
- Termination conditions
"""
from decimal import Decimal
from uuid import UUID
from typing import Optional, Tuple
from datetime import datetime, timezone
import random

from ..models import (
    ProductData,
    InventoryContext,
    StrategicControls,
    CreateSessionRequest,
    CreateSessionResponse,
    BuyerOffer,
    ChatMessage,
    ChatResponse,
    NegotiationTurnRequest,
    NegotiationTurnResponse,
    PricingDecision,
    NegotiationStatus,
    OfferDecision,
    SessionSummary,
    NegotiationAnalytics,
)
from ..agents import (
    ContextAnalysisAgent,
    PricingStrategyAgent,
    PricingState,
    ConversationAgent,
    ConversationContext,
)
from ..infrastructure.llm.openai_client import get_llm_client
from ..infrastructure.llm import prompt_templates as llm_prompts
from .session import SessionManager, NegotiationSession, get_session_manager

import json
import re
import structlog

logger = structlog.get_logger(__name__)

# ── Strong vs. soft accept patterns (for confirmation flow) ──────
STRONG_ACCEPT_RE = re.compile(
    r'^\s*(?:'
    r'ok\s*deal|deal|i\s*accept|agreed|let\'?s?\s*do\s*it|'
    r'i\'?ll?\s*take\s*it|we\s*have\s*a\s*deal|'
    r'done\s*deal|sold|yes\s*deal|accepted|alright\s*deal|'
    r'i\s*agree|ok\s*i?\s*agree|wrap\s*it\s*up|'
    r'let\'?s?\s*close|i\'?ll?\s*go\s*with\s*that|'
    r'that\'?s?\s*a\s*deal|it\'?s?\s*a\s*deal|'
    r'i\s*accept\s*your\s*offer|done|let\'?s?\s*finalize'
    r')\s*[.!]?\s*$',
    re.IGNORECASE,
)

SOFT_ACCEPT_RE = re.compile(
    r'^\s*(?:'
    r'ok|okay|fine|sure|alright|yes|yep|yeah|yea|hmm|'
    r'sounds?\s*good|that\s*works|works\s*for\s*me|'
    r'fair\s*enough|good|great|perfect|right|cool|nice'
    r')\s*[.!]?\s*$',
    re.IGNORECASE,
)

_CONFIRM_MARKER = "Say 'deal' or 'I accept' to close."

_QUANTITY_WORD_RE = re.compile(
    r"\b(\d{1,6})\s*(?:units?|pcs?|pieces?|items?)\b",
    re.IGNORECASE,
)

_QUANTITY_INTENT_RE = re.compile(
    r"\b(?:quantity|qty)\s*(?:is|=|:)?\s*(\d{1,6})\b",
    re.IGNORECASE,
)

_EXPLICIT_PRICE_RE = re.compile(
    r"(?:[$₹]\s*(\d+(?:\.\d{1,2})?)|"
    r"\b(?:offer|offering|pay|price|budget|bid)\s*(?:is|of|=|:)?\s*[$₹]?\s*(\d+(?:\.\d{1,2})?))",
    re.IGNORECASE,
)

# Bug A: Quantity-context detection — if ANY of these patterns match,
# the message is about quantity, NOT price.
QUANTITY_SENTENCE_RE = re.compile(
    r'\b(want|need|get|make|change|update|have|give\s*me|send)\s+\d+\s*(units?|pieces?|items?|pcs?|of\s+them)?\b',
    re.IGNORECASE
)

# Patch 6: "NUMBER for N units" — bare leading number is a TOTAL price
# when followed by "for" + a quantity phrase. Narrow on purpose: only
# matches when the number is at the START of the message, so it can't
# misfire on unrelated mid-sentence numbers.
_QTY_CONTEXT_TOTAL_RE = re.compile(
    r'^\s*[$₹]?\s*(\d+(?:\.\d{1,2})?)\s+for\b',
    re.IGNORECASE,
)

# Bug E: Negative response patterns — route to "invite new offer"
NEGATIVE_RE = re.compile(
    r'^\s*(?:no+pe?|nah|not\s+interested|that\'?s?\s+too\s+(?:high|much|expensive)|'
    r'can\'?t\s+do\s+that|no\s+way|not\s+happening|too\s+expensive|'
    r'that\s+(?:doesn\'?t|won\'?t)\s+work|no\s+deal|not\s+at\s+that\s+price)\s*[.!]?\s*$',
    re.IGNORECASE
)

BARE_NO_RE = re.compile(r'^\s*no[.!]?\s*$', re.IGNORECASE)

def _is_pending_confirmation(state) -> bool:
    """Check if the last seller message was a confirmation prompt."""
    if not state or not state.chat_history:
        return False
    for msg in reversed(state.chat_history):
        if msg.get("role") == "Seller":
            return _CONFIRM_MARKER in msg.get("text", "")
    return False


_FULL_PRICE_CONFIRM_MARKER = "You're offering the full asking price."


def _is_pending_full_price_confirmation(state) -> bool:
    """Check if the last seller message was a full-price confirmation prompt."""
    if not state or not state.chat_history:
        return False
    for msg in reversed(state.chat_history):
        if msg.get("role") == "Seller":
            return _FULL_PRICE_CONFIRM_MARKER in msg.get("text", "")
    return False


class NegotiationEngine:
    """
    Main orchestration layer for the negotiation system.

    This class:
    - Coordinates all agents
    - Manages session state
    - Enforces termination conditions
    - Produces auditable outputs
    """

    def __init__(self, session_manager: Optional[SessionManager] = None):
        self.session_manager = session_manager or get_session_manager()

        # Initialize agents
        self.context_agent = ContextAnalysisAgent()
        self.pricing_agent = PricingStrategyAgent()
        self.conversation_agent = ConversationAgent()
        self.llm = get_llm_client()

    # ==========================================================================
    # Public API
    # ==========================================================================

    def create_session(
        self,
        request: CreateSessionRequest,
        client_ip: Optional[str] = None,
    ) -> CreateSessionResponse:
        """
        Create a new negotiation session.

        This:
        1. Validates all inputs
        2. Computes strategic posture
        3. Generates initial offer
        4. Creates session state
        """
        # Step 1: Analyze context to get strategic posture
        posture = self.context_agent.analyze(
            product=request.product,
            inventory=request.inventory,
            strategy=request.strategy,
        )

        # Step 2: Compute initial offer
        initial_offer = self.pricing_agent.compute_initial_offer(
            product=request.product,
            inventory=request.inventory,
            posture=posture,
            strategy=request.strategy,
        )

        # Step 3: Create session
        session = self.session_manager.create_session(
            product=request.product,
            inventory=request.inventory,
            strategy=request.strategy,
            posture=posture,
            initial_offer=initial_offer,
            buyer_id=request.buyer_id,
            client_ip=client_ip,
        )

        # Step 4: Generate initial message
        conv_context = ConversationContext(
            round_number=0,
            max_rounds=request.strategy.max_rounds,
            mode=request.strategy.mode,
            product_name=request.product.product_name,
            quantity=request.inventory.requested_quantity,
            buyer_offered=None,
            our_offer=initial_offer,
        )
        message = self.conversation_agent.generate_initial_message(
            offer=initial_offer,
            context=conv_context,
        )

        return CreateSessionResponse(
            session_id=session.session_id,
            initial_offer=initial_offer,
            message=message,
            max_rounds=request.strategy.max_rounds,
            mode=request.strategy.mode,
            created_at=session.created_at,
        )

    def process_turn(
        self,
        session_id: UUID,
        buyer_offer: BuyerOffer,
    ) -> NegotiationTurnResponse:
        """
        Process a single negotiation turn.

        This:
        1. Validates session state
        2. Evaluates buyer offer
        3. Makes pricing decision
        4. Updates session state
        5. Generates response
        """
        # Step 1: Get session
        session = self.session_manager.get_session(session_id)
        if session is None:
            raise ValueError(
                f"Session {session_id} not found or expired. "
                "Please start a new negotiation session."
            )

        if session.status != NegotiationStatus.ACTIVE:
            raise ValueError(
                f"Session {session_id} is no longer active (status: {session.status.value}). "
                "Please start a new negotiation session."
            )

        # Step 2: Check termination conditions
        if self._should_terminate(session):
            return self._terminate_session(session, NegotiationStatus.REJECTED)

        # Step 3: Increment round
        session.pricing_state.current_round += 1
        session.pricing_state.buyer_history.append(buyer_offer.offered_price)

        # Step 4: Evaluate offer
        decision = self.pricing_agent.evaluate_offer(
            buyer_offer=buyer_offer,
            product=session.product,
            inventory=session.inventory,
            strategy=session.strategy,
            posture=session.posture,
            state=session.pricing_state,
        )

        # Step 5: Update state based on decision
        self._update_state(session, decision, buyer_offer)

        # Step 5.5: Sync engine max_rounds back to orchestration.
        #   The engine may extend max_rounds (e.g. post-redemption
        #   protection or quantity change).  Keep the orchestration
        #   in sync so _should_terminate, _determine_status, and
        #   rounds_remaining all respect the extension.
        eng = session.pricing_state.engine_state
        if eng and eng.max_rounds > session.strategy.max_rounds:
            session.strategy.max_rounds = eng.max_rounds

        # Step 6: Generate response via verbalize (Bug 4 fix)
        #   Use pricing_agent.verbalize() instead of conversation_agent
        #   so the response tone matches the reasoning tag.
        eng = session.pricing_state.engine_state
        if eng and eng._last_result is not None:
            # Sync chat_history into engine state for variety (Bug 6)
            eng._chat_history_cache = session.pricing_state.chat_history
            message = self.pricing_agent.verbalize(eng._last_result, eng)
        else:
            # Bug F: Diagnostic logging when engine result unavailable
            logger.warning(
                "verbalize_fallback_no_last_result",
                has_engine_state=eng is not None,
                round=session.pricing_state.current_round,
                decision=decision.decision.value if decision else "NONE",
            )
            # Fallback: use conversation_agent if engine result unavailable
            conv_context = ConversationContext(
                round_number=session.pricing_state.current_round,
                max_rounds=session.strategy.max_rounds,
                mode=session.strategy.mode,
                product_name=session.product.product_name,
                quantity=session.inventory.requested_quantity,
                buyer_offered=buyer_offer.offered_price,
                our_offer=decision.counter_offer_price,
            )
            message = self.conversation_agent.generate_response(
                decision=decision,
                context=conv_context,
                floor_price=session.posture.reservation_price,
            )

        # Step 7: Determine final status
        status = self._determine_status(session, decision)
        can_continue = status == NegotiationStatus.ACTIVE

        # Step 8: Close session if needed
        if not can_continue:
            final_price = decision.accepted_price if decision.decision == OfferDecision.ACCEPT else None
            total_profit = decision.total_profit if decision.decision == OfferDecision.ACCEPT else None
            self.session_manager.close_session(
                session.session_id, status, final_price, total_profit
            )
        else:
            self.session_manager.update_session(session)

        return NegotiationTurnResponse(
            session_id=session.session_id,
            round_number=session.pricing_state.current_round,
            status=status,
            pricing=decision,
            message=message,
            can_continue=can_continue,
            rounds_remaining=max(0, session.strategy.max_rounds - session.pricing_state.current_round),
            timestamp=datetime.now(timezone.utc),
        )

    def end_session(
        self,
        session_id: UUID,
        reason: str = "buyer_walked",
    ) -> SessionSummary:
        """
        End a negotiation session early.

        Use this when buyer walks away or for manual termination.
        """
        session = self.session_manager.get_session(session_id)
        if session is None:
            raise ValueError(f"Session {session_id} not found")

        status = NegotiationStatus.BUYER_WALKED
        self.session_manager.close_session(session_id, status)

        return self.session_manager.get_session_summary(session_id)

    def process_chat(
        self,
        session_id: UUID,
        chat_message: ChatMessage,
    ) -> ChatResponse:
        """
        Process a free-text chat message from the buyer.

        Uses LLM to understand the message:
        - If it contains a price offer -> route to process_turn()
        - If buyer changes quantity -> update session & engine state, recalc prices
        - If it's just conversation -> reply in character
        """
        # Step 1: Get session
        session = self.session_manager.get_session(session_id)
        if session is None:
            raise ValueError(f"Session {session_id} not found or expired")

        if session.status != NegotiationStatus.ACTIVE:
            raise ValueError(f"Session {session_id} is not active: {session.status}")

        # Step 1b: Validate message (prevent abuse / accidental huge payloads)
        MAX_MSG_LENGTH = 2000
        msg_text = chat_message.message or ""
        if len(msg_text) > MAX_MSG_LENGTH:
            return ChatResponse(
                session_id=session_id,
                message="Your message is a bit too long! Please keep it under 2000 characters.",
                has_price_offer=False,
            )
        if not msg_text.strip():
            return ChatResponse(
                session_id=session_id,
                message=f"I didn't catch that — could you tell me what price you had in mind for {session.product.product_name}?",
                has_price_offer=False,
            )

        # Step 2: Build negotiation history for context
        state = session.pricing_state
        history_parts = []
        for i, (our, buyer) in enumerate(zip(
            state.offers_history if state else [],
            state.buyer_history if state else []
        )):
            history_parts.append(f"R{i+1}: Seller=₹{our}, Buyer=₹{buyer}")
        if state and len(state.offers_history) > len(state.buyer_history):
            history_parts.append(f"Current seller offer: ₹{state.offers_history[-1]}")
        history_str = "; ".join(history_parts) if history_parts else "Opening round — no offers exchanged yet"

        current_offer = str(state.current_offer) if state else str(session.initial_offer)

        # ── Bug B: Clear zombie pending-confirmation state ──────────
        #   If the buyer's new message is NOT an acceptance phrase but
        #   the last seller message was a confirmation prompt, the buyer
        #   ignored or rejected the confirmation.  Clear the stale
        #   confirmation context so it doesn't bleed into future turns.
        msg_stripped_early = chat_message.message.strip()
        if _is_pending_confirmation(state):
            is_accept_phrase = (
                bool(STRONG_ACCEPT_RE.match(msg_stripped_early))
                or bool(SOFT_ACCEPT_RE.match(msg_stripped_early))
            )
            if not is_accept_phrase:
                logger.info(
                    "zombie_confirmation_cleared",
                    message_preview=msg_stripped_early[:50],
                )

        # Step 3: Use LLM to understand buyer's message
        if self.llm.enabled:
            try:
                extracted = self._understand_chat(chat_message.message, session, current_offer, history_str)
                if extracted is not None:
                    has_price, unit_price, total_price, reply, has_qty_change, new_qty, accepts_deal = extracted
                    # Safety Override: Pure numeric messages are always prices, never quantities.
                    msg_stripped = chat_message.message.strip()
                    bare_num_match = re.match(r'^\s*[$]?\s*(\d+(?:,\d{3})*(?:\.\d{1,2})?)\s*[$]?\s*$', msg_stripped)
                    if bare_num_match:
                        try:
                            val = float(bare_num_match.group(1).replace(',', ''))
                            if val > 0:
                                has_qty_change = False
                                new_qty = None
                                has_price = True
                                accepts_deal = False
                                reply = None
                                if unit_price is None and total_price is None:
                                    qty = session.inventory.requested_quantity
                                    base_p = float(session.product.base_price)
                                    if qty > 1 and val > base_p * 1.2:
                                        total_price = val
                                        unit_price = None
                                    else:
                                        unit_price = val
                                        total_price = None
                        except ValueError:
                            pass

                    fallback_qty = self._extract_quantity_fallback(chat_message.message)
                    fallback_price = self._extract_explicit_price_fallback(chat_message.message)
                    extracted_prices = [
                        price for price in (unit_price, total_price)
                        if price is not None
                    ]
                    qty_was_used_as_price = any(
                        abs(float(price) - float(fallback_qty)) <= 0.01
                        for price in extracted_prices
                    ) if fallback_qty is not None else False
                    if (
                        fallback_qty is not None
                        and fallback_price is None
                        and (not has_price or qty_was_used_as_price)
                    ):
                        has_qty_change = True
                        new_qty = fallback_qty
                        has_price = False
                        unit_price = None
                        total_price = None
                        accepts_deal = False

                    # ── Buyer accepts the current counter ─────────
                    if accepts_deal and not has_price:
                        msg_stripped = chat_message.message.strip()
                        is_strong = bool(STRONG_ACCEPT_RE.match(msg_stripped))
                        is_soft = bool(SOFT_ACCEPT_RE.match(msg_stripped))
                        pending = _is_pending_confirmation(state)

                        if is_strong or pending or (not is_soft):
                            # Strong accept, pending-confirm reply, or LLM-
                            # detected acceptance that isn't a soft phrase
                            # → route through engine for direct closure.
                            if _is_pending_full_price_confirmation(state):
                                # Buyer confirmed they want full price
                                last_counter = float(session.product.base_price)
                            else:
                                last_counter = float(current_offer)
                                eng = state.engine_state
                                if eng and eng.counter_history:
                                    last_counter = eng.counter_history[-1]

                            state.chat_history.append({"role": "Buyer", "text": chat_message.message})

                            buyer_offer = BuyerOffer(
                                offered_price=Decimal(str(last_counter)),
                                message=chat_message.message,
                                offered_quantity=None,
                            )
                            turn_response = self.process_turn(session_id, buyer_offer)

                            state.chat_history.append({"role": "Seller", "text": turn_response.message})

                            return ChatResponse(
                                session_id=session_id,
                                message=turn_response.message,
                                has_price_offer=True,
                                extracted_price=Decimal(str(last_counter)),
                                round_number=turn_response.round_number,
                                status=turn_response.status,
                                pricing=turn_response.pricing,
                                can_continue=turn_response.can_continue,
                                rounds_remaining=turn_response.rounds_remaining,
                            )
                        else:
                            # Soft accept ("ok", "fine", "sure", …)
                            # → ask buyer to explicitly confirm.
                            last_counter = float(current_offer)
                            eng = state.engine_state
                            if eng and eng.counter_history:
                                last_counter = eng.counter_history[-1]
                            qty = session.inventory.requested_quantity
                            total = round(last_counter * qty, 2)

                            confirm_msg = (
                                f"Just to confirm \u2014 you'd like to finalize at "
                                f"₹{last_counter:,.2f} per unit for {qty} unit(s), "
                                f"totaling ₹{total:,.2f}? "
                                f"{_CONFIRM_MARKER}"
                            )
                            state.chat_history.append({"role": "Buyer", "text": chat_message.message})
                            state.chat_history.append({"role": "Seller", "text": confirm_msg})
                            return ChatResponse(
                                session_id=session_id,
                                message=confirm_msg,
                                has_price_offer=False,
                            )

                    # ── Disambiguation: qty UP + price likely means TOTAL ──
                    #   When a buyer says "2 units for $15000" or "$15000
                    #   for both", the LLM often extracts $15000 as a
                    #   per-unit price.  But no rational buyer who's been
                    #   fighting to REDUCE the per-unit price would
                    #   simultaneously increase quantity AND pay the same
                    #   per-unit rate (doubling total spend).  If treating
                    #   the number as per-unit makes total spend jump far
                    #   beyond the buyer's prior offers, reinterpret it
                    #   as a total price.
                    if (has_qty_change and new_qty and new_qty > 1
                            and has_price
                            and unit_price is not None and unit_price > 0
                            and (total_price is None or total_price <= 0)):
                        old_qty = session.inventory.requested_quantity
                        if new_qty > old_qty:
                            eng_s = state.engine_state
                            buyer_max_offer = 0.0
                            if eng_s and eng_s.offer_history:
                                buyer_max_offer = max(eng_s.offer_history)
                            elif state and state.buyer_history:
                                buyer_max_offer = float(max(state.buyer_history))
                            # If per-unit interpretation makes total spend
                            # exceed 1.5× the buyer's best prior per-unit
                            # offer × old_qty, it's almost certainly a total.
                            implied_total = unit_price * new_qty
                            prior_total = buyer_max_offer * old_qty if buyer_max_offer > 0 else 0
                            if prior_total > 0 and implied_total > prior_total * 1.5:
                                logger.info(
                                    "qty_price_disambiguation",
                                    unit_price=unit_price,
                                    new_qty=new_qty,
                                    implied_total=implied_total,
                                    prior_total=prior_total,
                                    action="reinterpret_as_total",
                                )
                                total_price = unit_price
                                unit_price = None

                    if (
                        has_qty_change and new_qty is not None
                        and new_qty > session.inventory.available_quantity
                    ):
                        return self._quantity_exceeded_response(session_id, session, chat_message, new_qty)

                    # Handle quantity change (with or without a price offer)
                    if has_qty_change and new_qty is not None and new_qty > 0:
                        self._apply_quantity_change(session, new_qty)

                    if has_price and (
                        (unit_price is not None and unit_price > 0)
                        or (total_price is not None and total_price > 0)
                    ):
                        # Resolve effective per-unit price
                        qty = session.inventory.requested_quantity
                        if unit_price is not None and unit_price > 0:
                            effective_price = unit_price
                        elif total_price is not None and total_price > 0 and qty > 0:
                            effective_price = round(total_price / qty, 2)
                        else:
                            effective_price = None

                        if effective_price is not None and effective_price > 0:
                            # ── Sanity: cap at base price ──────────────
                            #   No rational buyer offers above the asking price.
                            #   If extracted price > base, it's almost certainly
                            #   a mistype or LLM parsing error. Clamp to base.
                            base = float(session.product.base_price)
                            was_clamped = effective_price > base
                            if was_clamped:
                                effective_price = base

                            # ── Full-price confirmation ────────────────
                            #   If the raw offer exceeded base (was clamped),
                            #   the buyer likely mistyped.  Ask them to
                            #   confirm before locking in full price.
                            if was_clamped:
                                qty = session.inventory.requested_quantity
                                total = round(base * qty, 2)
                                confirm_msg = (
                                    f"{_FULL_PRICE_CONFIRM_MARKER} "
                                    f"That's ₹{base:,.2f} per unit for {qty} unit(s), "
                                    f"totaling ₹{total:,.2f}. "
                                    f"Would you like to proceed at full price, or make a different offer? "
                                    f"{_CONFIRM_MARKER}"
                                )
                                state.chat_history.append({"role": "Buyer", "text": chat_message.message})
                                state.chat_history.append({"role": "Seller", "text": confirm_msg})
                                return ChatResponse(
                                    session_id=session_id,
                                    message=confirm_msg,
                                    has_price_offer=False,
                                )

                            # Store buyer message in history
                            state.chat_history.append({"role": "Buyer", "text": chat_message.message})

                            # Route to pricing engine
                            buyer_offer = BuyerOffer(
                                offered_price=Decimal(str(effective_price)),
                                message=chat_message.message,
                                offered_quantity=new_qty if has_qty_change and new_qty else None,
                            )
                            turn_response = self.process_turn(session_id, buyer_offer)

                            # Store seller response in history
                            state.chat_history.append({"role": "Seller", "text": turn_response.message})

                            return ChatResponse(
                                session_id=session_id,
                                message=turn_response.message,
                                has_price_offer=True,
                                extracted_price=Decimal(str(effective_price)),
                                round_number=turn_response.round_number,
                                status=turn_response.status,
                                pricing=turn_response.pricing,
                                can_continue=turn_response.can_continue,
                                rounds_remaining=turn_response.rounds_remaining,
                            )
                    elif has_qty_change and new_qty is not None and new_qty > 0:
                        return self._quantity_update_response(session_id, session, chat_message, new_qty)
                    else:
                        # Pure conversation — prefer the LLM's in-band reply;
                        # if it's empty, generate a dedicated conversational
                        # reply (Patch 5) instead of a generic nudge.
                        reply_text = reply or self._generate_conversational_reply(
                            chat_message.message, session
                        ) or "Could you please make a specific price offer?"
                        state.chat_history.append({"role": "Buyer", "text": chat_message.message})
                        state.chat_history.append({"role": "Seller", "text": reply_text})
                        return ChatResponse(
                            session_id=session_id,
                            message=reply_text,
                            has_price_offer=False,
                        )
            except Exception as e:
                logger.error("chat_understanding_error", error=str(e))

        # Fallback: try simple regex extraction

        # ── Fallback acceptance detection (strong/soft split) ─────
        msg_stripped = chat_message.message.strip()
        is_strong_fb = bool(STRONG_ACCEPT_RE.match(msg_stripped))
        is_soft_fb = bool(SOFT_ACCEPT_RE.match(msg_stripped))
        pending_fb = _is_pending_confirmation(state)

        if is_strong_fb or (is_soft_fb and pending_fb):
            # Direct acceptance (strong phrase, or soft after confirmation)
            if _is_pending_full_price_confirmation(state):
                # Buyer confirmed they want full price
                last_counter = float(session.product.base_price)
            else:
                last_counter = float(current_offer)
                eng = state.engine_state
                if eng and eng.counter_history:
                    last_counter = eng.counter_history[-1]

            state.chat_history.append({"role": "Buyer", "text": chat_message.message})
            buyer_offer = BuyerOffer(
                offered_price=Decimal(str(last_counter)),
                message=chat_message.message,
            )
            turn_response = self.process_turn(session_id, buyer_offer)
            state.chat_history.append({"role": "Seller", "text": turn_response.message})
            return ChatResponse(
                session_id=session_id,
                message=turn_response.message,
                has_price_offer=True,
                extracted_price=Decimal(str(last_counter)),
                round_number=turn_response.round_number,
                status=turn_response.status,
                pricing=turn_response.pricing,
                can_continue=turn_response.can_continue,
                rounds_remaining=turn_response.rounds_remaining,
            )
        elif is_soft_fb and not pending_fb:
            # Soft accept without prior confirmation → ask buyer to confirm
            last_counter = float(current_offer)
            eng = state.engine_state
            if eng and eng.counter_history:
                last_counter = eng.counter_history[-1]
            qty = session.inventory.requested_quantity
            total = round(last_counter * qty, 2)
            confirm_msg = (
                f"Just to confirm \u2014 you'd like to finalize at "
                f"₹{last_counter:,.2f} per unit for {qty} unit(s), "
                f"totaling ₹{total:,.2f}? "
                f"{_CONFIRM_MARKER}"
            )
            state.chat_history.append({"role": "Buyer", "text": chat_message.message})
            state.chat_history.append({"role": "Seller", "text": confirm_msg})
            return ChatResponse(
                session_id=session_id,
                message=confirm_msg,
                has_price_offer=False,
            )

        # ── Bug E: Negative response routing ──────────────────────
        #   "no", "nope", "too expensive" etc. should invite a new
        #   price offer, not fall through to generic reply or
        #   accidentally match a number regex.
        msg_stripped_fb = chat_message.message.strip()
        if NEGATIVE_RE.match(msg_stripped_fb) or BARE_NO_RE.match(msg_stripped_fb):
            eng = state.engine_state
            last_counter = float(current_offer)
            if eng and eng.counter_history:
                last_counter = eng.counter_history[-1]
            reject_reply = (
                f"I understand that doesn't work for you. "
                f"Our current offer is ₹{last_counter:,.2f} per unit. "
                f"What price would you have in mind?"
            )
            state.chat_history.append({"role": "Buyer", "text": chat_message.message})
            state.chat_history.append({"role": "Seller", "text": reject_reply})
            return ChatResponse(
                session_id=session_id,
                message=reject_reply,
                has_price_offer=False,
            )

        fallback_qty = self._extract_quantity_fallback(chat_message.message)
        fallback_price = self._extract_explicit_price_fallback(chat_message.message)

        # Safety Override: Pure numeric messages are always prices, never quantities.
        msg_stripped_fb = chat_message.message.strip()
        bare_num_match_fb = re.match(r'^\s*[$]?\s*(\d+(?:,\d{3})*(?:\.\d{1,2})?)\s*[$]?\s*$', msg_stripped_fb)
        if bare_num_match_fb:
            try:
                val = float(bare_num_match_fb.group(1).replace(',', ''))
                if val > 0:
                    fallback_qty = None
                    qty = session.inventory.requested_quantity
                    base_p = float(session.product.base_price)
                    if qty > 1 and val > base_p * 1.2:
                        fallback_price = val / qty
                    else:
                        fallback_price = val
            except ValueError:
                pass

        if fallback_qty is not None:
            if fallback_qty > session.inventory.available_quantity:
                return self._quantity_exceeded_response(session_id, session, chat_message, fallback_qty)

            self._apply_quantity_change(session, fallback_qty)

            if fallback_price is None:
                # Patch 6: "4000 for 5 units" — bare leading number before
                # "for" is a TOTAL price for the stated quantity, not a
                # per-unit price. Convert to per-unit before passing on.
                qty_ctx_match = _QTY_CONTEXT_TOTAL_RE.match(chat_message.message.strip())
                if qty_ctx_match:
                    try:
                        total_candidate = float(qty_ctx_match.group(1))
                        if total_candidate > 0 and fallback_qty > 0:
                            fallback_price = total_candidate / fallback_qty
                    except ValueError:
                        pass

            if fallback_price is None:
                return self._quantity_update_response(session_id, session, chat_message, fallback_qty)

            state.chat_history.append({"role": "Buyer", "text": chat_message.message})
            buyer_offer = BuyerOffer(
                offered_price=Decimal(str(fallback_price)),
                message=chat_message.message,
                offered_quantity=fallback_qty,
            )
            turn_response = self.process_turn(session_id, buyer_offer)
            state.chat_history.append({"role": "Seller", "text": turn_response.message})
            return ChatResponse(
                session_id=session_id,
                message=turn_response.message,
                has_price_offer=True,
                extracted_price=Decimal(str(fallback_price)),
                round_number=turn_response.round_number,
                status=turn_response.status,
                pricing=turn_response.pricing,
                can_continue=turn_response.can_continue,
                rounds_remaining=turn_response.rounds_remaining,
            )

        if fallback_price is not None:
            price = fallback_price
            base = float(session.product.base_price)
            if price > base:
                qty = session.inventory.requested_quantity
                total = round(base * qty, 2)
                confirm_msg = (
                    f"{_FULL_PRICE_CONFIRM_MARKER} "
                    f"That's ₹{base:,.2f} per unit for {qty} unit(s), "
                    f"totaling ₹{total:,.2f}. "
                    f"Would you like to proceed at full price, or make a different offer? "
                    f"{_CONFIRM_MARKER}"
                )
                state.chat_history.append({"role": "Buyer", "text": chat_message.message})
                state.chat_history.append({"role": "Seller", "text": confirm_msg})
                return ChatResponse(
                    session_id=session_id,
                    message=confirm_msg,
                    has_price_offer=False,
                )
            buyer_offer = BuyerOffer(
                offered_price=Decimal(str(price)),
                message=chat_message.message,
            )
            state.chat_history.append({"role": "Buyer", "text": chat_message.message})
            turn_response = self.process_turn(session_id, buyer_offer)
            state.chat_history.append({"role": "Seller", "text": turn_response.message})
            return ChatResponse(
                session_id=session_id,
                message=turn_response.message,
                has_price_offer=True,
                extracted_price=Decimal(str(price)),
                round_number=turn_response.round_number,
                status=turn_response.status,
                pricing=turn_response.pricing,
                can_continue=turn_response.can_continue,
                rounds_remaining=turn_response.rounds_remaining,
            )

        # ── Bug A: Guard bare regex with quantity-context check ────
        #   "I want 3 units" should NOT extract "3" as a price offer.
        is_quantity_context = bool(QUANTITY_SENTENCE_RE.search(chat_message.message))
        match = re.search(r'[$₹]?\s?(\d+(?:\.\d{1,2})?)', chat_message.message)
        if match and not is_quantity_context:
            price = float(match.group(1))
            if price > 0:
                # ── Full-price guard (fallback path) ───────────
                base = float(session.product.base_price)
                if price > base:
                    qty = session.inventory.requested_quantity
                    total = round(base * qty, 2)
                    confirm_msg = (
                        f"{_FULL_PRICE_CONFIRM_MARKER} "
                        f"That's ₹{base:,.2f} per unit for {qty} unit(s), "
                        f"totaling ₹{total:,.2f}. "
                        f"Would you like to proceed at full price, or make a different offer? "
                        f"{_CONFIRM_MARKER}"
                    )
                    state.chat_history.append({"role": "Buyer", "text": chat_message.message})
                    state.chat_history.append({"role": "Seller", "text": confirm_msg})
                    return ChatResponse(
                        session_id=session_id,
                        message=confirm_msg,
                        has_price_offer=False,
                    )
                buyer_offer = BuyerOffer(
                    offered_price=Decimal(str(price)),
                    message=chat_message.message,
                )
                state.chat_history.append({"role": "Buyer", "text": chat_message.message})
                turn_response = self.process_turn(session_id, buyer_offer)
                state.chat_history.append({"role": "Seller", "text": turn_response.message})
                return ChatResponse(
                    session_id=session_id,
                    message=turn_response.message,
                    has_price_offer=True,
                    extracted_price=Decimal(str(price)),
                    round_number=turn_response.round_number,
                    status=turn_response.status,
                    pricing=turn_response.pricing,
                    can_continue=turn_response.can_continue,
                    rounds_remaining=turn_response.rounds_remaining,
                )

        # Bug H: No price found and LLM failed — contextual generic reply
        #   Track the conversation and keep visible state in sync.
        eng = state.engine_state
        last_counter = float(current_offer)
        if eng and eng.counter_history:
            last_counter = eng.counter_history[-1]
        qty = session.inventory.requested_quantity
        total = round(last_counter * qty, 2)
        
        # ── Patch 5: Try a natural conversational reply first ──────
        #   For genuinely off-topic messages (weather, jokes, "I don't
        #   have an offer", etc.) this gives a human, in-character
        #   response instead of the static "Thank you for your
        #   interest..." template. Falls through to the templates
        #   below only if the LLM is disabled or the call fails.
        msg_lower_p5 = chat_message.message.strip().lower()
        _state_kw_check = [
            "how many", "quantity", "how much", "current offer",
            "what's the offer", "last offer", "for how many",
        ]
        if not any(kw in msg_lower_p5 for kw in _state_kw_check):
            conv_reply = self._generate_conversational_reply(chat_message.message, session)
            if conv_reply:
                state.chat_history.append({"role": "Buyer", "text": chat_message.message})
                state.chat_history.append({"role": "Seller", "text": conv_reply})
                return ChatResponse(
                    session_id=session_id,
                    message=conv_reply,
                    has_price_offer=False,
                )

        # ── Patch 3 Bug D: Session-state questions ─────────────────
        #   Answer qty/offer/history questions directly from state.
        msg_lower = chat_message.message.strip().lower()
        state_question_keywords = [
            "how many", "quantity", "how much", "current offer",
            "what's the offer", "last offer", "for how many",
        ]
        is_state_question = any(kw in msg_lower for kw in state_question_keywords)

        if is_state_question:
            if qty > 1:
                generic_reply = (
                    f"We're currently at {qty} unit(s) at "
                    f"₹{last_counter:,.2f}/unit (₹{total:,.2f} total). "
                    f"Would you like to adjust the quantity or make a price offer?"
                )
            else:
                generic_reply = (
                    f"We're currently at {qty} unit at "
                    f"₹{last_counter:,.2f}/unit. "
                    f"Would you like to adjust the quantity or make a price offer?"
                )
        elif qty > 1:
            generic_reply = (
                f"Thank you for your interest in {session.product.product_name}! "
                f"Our current offer is ₹{last_counter:,.2f} per unit "
                f"(₹{total:,.2f} for {qty} units). "
                f"Feel free to make a specific price offer."
            )
        else:
            generic_reply = (
                f"Thank you for your interest in {session.product.product_name}! "
                f"Our current offer is ₹{last_counter:,.2f} per unit. "
                f"Feel free to make a specific price offer."
            )
        state.chat_history.append({"role": "Buyer", "text": chat_message.message})
        state.chat_history.append({"role": "Seller", "text": generic_reply})
        return ChatResponse(
            session_id=session_id,
            message=generic_reply,
            has_price_offer=False,
        )

    def _extract_quantity_fallback(self, message: str) -> Optional[int]:
        """Deterministic fallback for quantity-only chat when LLM is disabled."""
        for pattern in (_QUANTITY_WORD_RE, _QUANTITY_INTENT_RE):
            match = pattern.search(message)
            if match:
                try:
                    qty = int(match.group(1))
                    return qty if qty > 0 else None
                except (TypeError, ValueError):
                    return None
        return None

    def _extract_explicit_price_fallback(self, message: str) -> Optional[float]:
        """Extract explicit prices without treating quantity counts as offers."""
        match = _EXPLICIT_PRICE_RE.search(message)
        if not match:
            return None

        value = match.group(1) or match.group(2)
        try:
            price = float(value)
            return price if price > 0 else None
        except (TypeError, ValueError):
            return None

    def _quantity_offer_price(
        self,
        session: NegotiationSession,
        new_qty: int,
    ) -> float:
        """Return the visible per-unit offer after a quantity change."""
        state = session.pricing_state
        eng = state.engine_state if state else None
        if eng:
            per_unit = eng.bulk_target_price
            if eng.counter_history:
                per_unit = min(eng.counter_history[-1], per_unit)
        else:
            from ..agents.negotiation_engine import compute_bulk_target_price
            mode = session.strategy.mode.value if session.strategy else "MAX_PROFIT"
            per_unit = compute_bulk_target_price(
                float(session.product.base_price), new_qty, mode,
            )
        return round(float(per_unit), 2)

    def _quantity_update_response(
        self,
        session_id: UUID,
        session: NegotiationSession,
        chat_message: ChatMessage,
        new_qty: int,
    ) -> ChatResponse:
        """Acknowledge a pure quantity change and keep visible state in sync."""
        state = session.pricing_state
        per_unit = self._quantity_offer_price(session, new_qty)
        current_offer = Decimal(str(per_unit))
        state.current_offer = current_offer
        if state.offers_history and not state.buyer_history:
            state.offers_history[-1] = current_offer
        elif not state.offers_history:
            state.offers_history.append(current_offer)

        qty_msg = (
            f"Updated to {new_qty} unit(s). "
            f"Our current offer is ₹{per_unit:.2f} per unit "
            f"(₹{per_unit * new_qty:.2f} total for {new_qty} units). "
            f"What price would you like to offer?"
        )
        state.chat_history.append({"role": "Buyer", "text": chat_message.message})
        state.chat_history.append({"role": "Seller", "text": qty_msg})
        self.session_manager.update_session(session)
        return ChatResponse(
            session_id=session_id,
            message=qty_msg,
            has_price_offer=False,
        )

    def _quantity_exceeded_response(
        self,
        session_id: UUID,
        session: NegotiationSession,
        chat_message: ChatMessage,
        requested_qty: int,
    ) -> ChatResponse:
        """Reject quantity changes that exceed available inventory."""
        state = session.pricing_state
        msg = (
            f"We only have {session.inventory.available_quantity} unit(s) available, "
            f"so I can't update the order to {requested_qty} units. "
            f"Please choose {session.inventory.available_quantity} unit(s) or fewer."
        )
        state.chat_history.append({"role": "Buyer", "text": chat_message.message})
        state.chat_history.append({"role": "Seller", "text": msg})
        self.session_manager.update_session(session)
        return ChatResponse(
            session_id=session_id,
            message=msg,
            has_price_offer=False,
        )

    def _apply_quantity_change(
        self,
        session: NegotiationSession,
        new_qty: int,
    ) -> None:
        """
        Update session and engine state when buyer changes quantity mid-chat.

        Recalculates dynamic floor, concession budget, and scarcity
        based on the new quantity.
        """
        from ..agents.negotiation_engine import (
            _compute_dynamic_floor,
            _apply_psim,
            compute_bulk_target_price,
            TUNING,
        )

        # Update session inventory
        state = session.pricing_state
        if not hasattr(state, "quantity_contexts"):
            state.quantity_contexts = {}

        eng = state.engine_state
        old_qty = session.inventory.requested_quantity

        if new_qty != old_qty and eng is not None:
            # 1. Save current context for old_qty
            import copy
            state.quantity_contexts[old_qty] = {
                "current_round": state.current_round,
                "current_offer": state.current_offer,
                "buyer_last_offer": state.buyer_last_offer,
                "concession_used": state.concession_used,
                "offers_history": list(state.offers_history),
                "buyer_history": list(state.buyer_history),
                "engine_state": copy.deepcopy(eng),
            }

            # 2. Check if we have a saved context for new_qty
            if new_qty in state.quantity_contexts:
                # Restore saved context
                ctx = state.quantity_contexts[new_qty]
                state.current_round = ctx["current_round"]
                state.current_offer = ctx["current_offer"]
                state.buyer_last_offer = ctx["buyer_last_offer"]
                state.concession_used = ctx["concession_used"]
                state.offers_history = list(ctx["offers_history"])
                state.buyer_history = list(ctx["buyer_history"])
                state.engine_state = copy.deepcopy(ctx["engine_state"])
                
                # Update requested quantity
                session.inventory.requested_quantity = new_qty
                if state.engine_state:
                    state.engine_state.quantity = new_qty
                    session.strategy.max_rounds = state.engine_state.max_rounds
                
                logger.info(
                    "quantity_context_restored",
                    new_qty=new_qty,
                    old_qty=old_qty,
                    restored_round=state.current_round,
                    restored_offer=state.current_offer,
                )
                return

        session.inventory.requested_quantity = new_qty

        # Update PRANE-X engine state
        eng = session.pricing_state.engine_state
        if eng is None:
            return

        old_qty = eng.quantity
        eng.quantity = new_qty

        # Recalculate floor (bulk discount changes with quantity)
        eng.dynamic_floor = _compute_dynamic_floor(eng)
        eng.dynamic_floor = _apply_psim(eng)

        # Recalculate scarcity lock
        T = TUNING
        eng.scarcity_locked = (
            (eng.available_inventory - new_qty) < T["scarcity_stock_threshold"]
        )
        if eng.scarcity_locked:
            eng.dynamic_floor = round(
                min(eng.dynamic_floor * (1 + T["scarcity_floor_lift"]), eng.base_price),
                2,
            )

        # Recalculate bulk target price for new quantity
        eng.bulk_target_price = max(
            compute_bulk_target_price(eng.base_price, new_qty, eng.mode),
            eng.dynamic_floor,
        )

        # ── Quantity change: reset counter progress ────────────
        #   The deal fundamentally changed: old counters don't reflect
        #   the correct bulk discount for the new quantity.
        #   On decrease: old bulk-discounted counters are too low.
        #   On increase: old counters lack the new volume discount.
        #   Either way, clear and let concession restart from the
        #   correct bulk_target_price.
        if new_qty != old_qty:
            # Always clear firmness state — the firmness was based on
            # old-qty behaviour and doesn't apply after a qty change.
            eng.firmness_level = 0
            eng.consecutive_stagnant = 0
            eng.retrograde_count = 0

            # Always clear counter and offer history on quantity
            # change (Bug 7 fix) — the deal fundamentally changed.
            eng.counter_history.clear()
            eng.offer_history.clear()
            rounds_remaining = max(eng.max_rounds - eng.current_round, 2)
            eng.max_rounds = rounds_remaining
            eng.current_round = 0

        # Recalculate concession budget for new quantity
        new_total_budget = max((eng.base_price - eng.dynamic_floor) * new_qty, 0.0)

        # Full budget reset on any quantity change
        if new_qty != old_qty:
            ratio_used = 0.0
        elif eng.total_concession_budget > 0:
            ratio_used = 1.0 - (eng.remaining_concession_budget / eng.total_concession_budget)
        else:
            ratio_used = 0.0

        eng.total_concession_budget = new_total_budget
        eng.remaining_concession_budget = max(new_total_budget * (1.0 - ratio_used), 0.0)

        logger.info(
            "quantity_changed",
            old_qty=old_qty,
            new_qty=new_qty,
            new_floor=eng.dynamic_floor,
            new_budget=eng.total_concession_budget,
        )

    def _understand_chat(
        self,
        buyer_message: str,
        session: NegotiationSession,
        current_offer: str,
        history_str: str,
    ) -> Optional[tuple]:
        """
        Use LLM to understand buyer's free-text message.

        Returns: (has_price, unit_price, total_price, reply, has_qty_change, extracted_qty)
        unit_price and total_price are mutually exclusive; at most one is set.
        """
        state = session.pricing_state

        # Build recent conversation messages for context
        msg_parts = []
        for msg in (state.chat_history or [])[-8:]:  # last 8 messages (4 exchanges)
            role = msg.get("role", "")
            text = msg.get("text", "")
            msg_parts.append(f"  {role}: {text}")
        conversation_messages = "\n".join(msg_parts) if msg_parts else ""

        prompt = llm_prompts.build_chat_understanding_prompt(
            buyer_message=buyer_message,
            product_name=session.product.product_name,
            base_price=str(session.product.base_price),
            our_last_offer=current_offer,
            current_round=state.current_round if state else 0,
            max_rounds=session.strategy.max_rounds,
            mode=session.strategy.mode.value,
            negotiation_history=history_str,
            current_quantity=session.inventory.requested_quantity,
            conversation_messages=conversation_messages,
        )

        result = self.llm.generate_sync(
            system_prompt=llm_prompts.CHAT_UNDERSTANDING_SYSTEM_PROMPT,
            user_prompt=prompt,
            temperature=0.3,
        )

        if not result.success:
            logger.warning(
                "chat_understanding_llm_failed",
                error=result.error,
                llm_enabled=self.llm.enabled,
                model=self.llm.model,
            )
            return None

        try:
            content = result.content.strip()
            if content.startswith("```"):
                content = content.split("\n", 1)[1] if "\n" in content else content[3:]
                if content.endswith("```"):
                    content = content[:-3]
                content = content.strip()

            data = json.loads(content)
            has_price = data.get("has_price", False)
            accepts_deal = bool(data.get("accepts_deal", False))

            # Regex fallback: if LLM missed acceptance but message matches
            if not accepts_deal and not has_price:
                _msg = buyer_message.strip()
                if STRONG_ACCEPT_RE.match(_msg) or SOFT_ACCEPT_RE.match(_msg):
                    accepts_deal = True

            # Parse unit / total price (new schema)
            unit_price = data.get("extracted_unit_price")
            total_price = data.get("extracted_total_price")

            # Backward compat: if old-style `extracted_price` is present and
            # neither new field was set, treat it as unit price.
            if unit_price is None and total_price is None:
                legacy = data.get("extracted_price")
                if legacy is not None:
                    unit_price = legacy

            reply = data.get("reply", "")
            has_qty_change = data.get("has_quantity_change", False)
            extracted_qty = data.get("extracted_quantity")

            # Validate quantity
            if extracted_qty is not None:
                try:
                    extracted_qty = int(extracted_qty)
                    if extracted_qty <= 0:
                        extracted_qty = None
                        has_qty_change = False
                except (ValueError, TypeError):
                    extracted_qty = None
                    has_qty_change = False

            return (has_price, unit_price, total_price, reply, has_qty_change, extracted_qty, accepts_deal)
        except (json.JSONDecodeError, ValueError) as e:
            logger.warning("chat_understanding_parse_error", error=str(e))
            return None
    
    def _generate_conversational_reply(
        self,
        buyer_message: str,
        session: NegotiationSession,
    ) -> Optional[str]:
        """
        Generate a natural, in-character reply for off-topic / small-talk
        messages (no price, no quantity change, no accept/reject signal).

        This is intentionally separate from _understand_chat:
        - Returns plain text, not JSON — far less likely to fail parsing.
        - All price figures are computed HERE from session state and passed
          to the LLM as fixed strings. The LLM cannot invent numbers because
          none are left for it to invent — it can only repeat what's given.

        Returns None if the LLM is disabled or the call fails — caller should
        fall back to a deterministic template in that case.
        """
        if not self.llm.enabled:
            return None

        state = session.pricing_state
        eng = state.engine_state if state else None

        last_counter = float(eng.counter_history[-1]) if eng and eng.counter_history else float(session.initial_offer)
        qty = session.inventory.requested_quantity
        total = round(last_counter * qty, 2)
        rounds_remaining = (
            session.strategy.max_rounds - eng.current_round
            if eng else session.strategy.max_rounds
        )

        msg_parts = []
        for msg in (state.chat_history or [])[-6:]:
            role = msg.get("role", "")
            text = msg.get("text", "")
            msg_parts.append(f"  {role}: {text}")
        conversation_messages = "\n".join(msg_parts) if msg_parts else ""

        prompt = llm_prompts.build_conversational_reply_prompt(
            buyer_message=buyer_message,
            product_name=session.product.product_name,
            current_unit_price=f"{last_counter:,.2f}",
            current_total_price=f"{total:,.2f}",
            quantity=qty,
            rounds_remaining=max(rounds_remaining, 0),
            conversation_messages=conversation_messages,
        )

        try:
            result = self.llm.generate_sync(
                system_prompt=llm_prompts.CONVERSATIONAL_REPLY_SYSTEM_PROMPT,
                user_prompt=prompt,
                temperature=0.8,
            )
            if result.success and len(result.content.strip()) > 5:
                return result.content.strip()
            logger.warning(
                "conversational_reply_no_content",
                success=result.success,
                error=result.error,
            )
        except Exception as e:
            logger.warning("conversational_reply_error", error=str(e))

        return None

    def get_session(self, session_id: UUID) -> Optional[SessionSummary]:
        """Get session summary by ID."""
        return self.session_manager.get_session_summary(session_id)

    def get_analytics(self, session_id: UUID) -> Optional[NegotiationAnalytics]:
        """Get detailed analytics for a closed session."""
        session = self.session_manager.get_session(session_id)
        if session is None:
            return None

        state = session.pricing_state

        # Calculate concession (guard against zero initial offer)
        if session.initial_offer and session.initial_offer > 0:
            total_concession = session.initial_offer - (session.final_price or session.initial_offer)
            concession_pct = (total_concession / session.initial_offer * 100)
        else:
            total_concession = Decimal("0")
            concession_pct = Decimal("0")

        # Calculate profit (guard against zero final price)
        gross_profit = None
        profit_margin = None
        if session.final_price and session.final_price > 0:
            gross_profit = session.final_price - session.product.cost_price
            profit_margin = (gross_profit / session.final_price * 100)

        # Calculate efficiency (guard against zero max rounds)
        rounds_used = state.current_round if state else 0
        max_rounds = session.strategy.max_rounds
        if max_rounds > 0:
            efficiency = Decimal(str(1 - (rounds_used / max_rounds)))
        else:
            efficiency = Decimal("0")

        # Count constraint violations
        violations = len([v for v in state.buyer_history
                         if v < session.posture.walk_away_price]) if state else 0

        buyer_first = state.buyer_history[0] if state and state.buyer_history else Decimal("0")

        return NegotiationAnalytics(
            session_id=session.session_id,
            outcome=session.status,
            starting_price=session.initial_offer,
            final_price=session.final_price,
            buyer_first_offer=buyer_first,
            total_concession_given=total_concession,
            concession_percentage=concession_pct,
            rounds_used=rounds_used,
            rounds_available=session.strategy.max_rounds,
            efficiency_score=max(Decimal("0"), efficiency),
            gross_profit=gross_profit,
            profit_margin=profit_margin,
            mode_used=session.strategy.mode,
            constraint_violations_attempted=violations,
            walk_away_triggered=session.status == NegotiationStatus.REJECTED,
        )

    # ==========================================================================
    # Private Methods
    # ==========================================================================

    def _should_terminate(self, session: NegotiationSession) -> bool:
        """Check if session should terminate."""
        state = session.pricing_state

        # Use engine's max_rounds when available (may be extended by
        # redemption or quantity-change protection).
        effective_max = session.strategy.max_rounds
        eng = state.engine_state if state else None
        if eng and eng.max_rounds > effective_max:
            effective_max = eng.max_rounds

        # Max rounds reached
        if state.current_round >= effective_max:
            return True

        return False

    def _terminate_session(
        self,
        session: NegotiationSession,
        status: NegotiationStatus,
    ) -> NegotiationTurnResponse:
        """Terminate session and return final response.

        Called when _should_terminate fires (before the engine
        processes the round).  Uses REJECTED — the negotiation
        ran out of rounds without a deal.
        """
        # Override EXPIRED to REJECTED — "no deal after all rounds"
        # is a rejection, not a passive timeout.
        if status == NegotiationStatus.EXPIRED:
            status = NegotiationStatus.REJECTED
        self.session_manager.close_session(session.session_id, status)

        conv_context = ConversationContext(
            round_number=session.pricing_state.current_round,
            max_rounds=session.strategy.max_rounds,
            mode=session.strategy.mode,
            product_name=session.product.product_name,
            quantity=session.inventory.requested_quantity,
            buyer_offered=None,
            our_offer=None,
        )

        message = self.conversation_agent.generate_session_expired(conv_context)

        # Create a minimal decision for the response
        final_decision = PricingDecision(
            decision=OfferDecision.REJECT,
            margin_percentage=Decimal("0"),
            profit_per_unit=Decimal("0"),
            total_profit=Decimal("0"),
            within_constraints=True,
            remaining_concession_budget=Decimal("0"),
            concession_percentage_used=Decimal("100"),
        )

        return NegotiationTurnResponse(
            session_id=session.session_id,
            round_number=session.pricing_state.current_round,
            status=status,
            pricing=final_decision,
            message=message,
            can_continue=False,
            rounds_remaining=0,
            timestamp=datetime.now(timezone.utc),
        )

    def _update_state(
        self,
        session: NegotiationSession,
        decision: PricingDecision,
        buyer_offer: BuyerOffer,
    ) -> None:
        """Update session state based on decision."""
        state = session.pricing_state

        # Update buyer's last offer
        state.buyer_last_offer = buyer_offer.offered_price

        # Update concession used
        if decision.concession_made > 0:
            state.concession_used += decision.concession_made

        # Update our offer if countering
        if decision.decision == OfferDecision.COUNTER and decision.counter_offer_price:
            state.current_offer = decision.counter_offer_price
            state.offers_history.append(decision.counter_offer_price)

    def _determine_status(
        self,
        session: NegotiationSession,
        decision: PricingDecision,
    ) -> NegotiationStatus:
        """Determine session status based on decision."""
        if decision.decision == OfferDecision.ACCEPT:
            return NegotiationStatus.ACCEPTED

        if decision.decision == OfferDecision.REJECT:
            return NegotiationStatus.REJECTED

        # Check if this was the last round — "no deal" = REJECTED,
        # not EXPIRED.  EXPIRED is reserved for TTL timeout.
        effective_max = session.strategy.max_rounds
        eng = session.pricing_state.engine_state if session.pricing_state else None
        if eng and eng.max_rounds > effective_max:
            effective_max = eng.max_rounds
        if session.pricing_state.current_round >= effective_max:
            return NegotiationStatus.REJECTED

        return NegotiationStatus.ACTIVE


# Global engine instance
_engine: Optional[NegotiationEngine] = None


def get_engine() -> NegotiationEngine:
    """Get or create global negotiation engine."""
    global _engine
    if _engine is None:
        _engine = NegotiationEngine()
    return _engine
