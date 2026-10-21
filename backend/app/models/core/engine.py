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
from datetime import datetime

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
from ...infrastructure.llm.openai_client import get_llm_client
from ...infrastructure.llm import prompt_templates as llm_prompts
from .session import SessionManager, NegotiationSession, get_session_manager

import json
import structlog

logger = structlog.get_logger(__name__)


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
            raise ValueError(f"Session {session_id} not found or expired")
        
        if session.status != NegotiationStatus.ACTIVE:
            raise ValueError(f"Session {session_id} is not active: {session.status}")
        
        # Step 2: Check termination conditions
        if self._should_terminate(session):
            return self._terminate_session(session, NegotiationStatus.EXPIRED)
        
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
        
        # Step 6: Generate response message
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
            timestamp=datetime.utcnow(),
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
        - If it contains a price offer → route to process_turn()
        - If it's just conversation → reply in character
        """
        # Step 1: Get session
        session = self.session_manager.get_session(session_id)
        if session is None:
            raise ValueError(f"Session {session_id} not found or expired")
        
        if session.status != NegotiationStatus.ACTIVE:
            raise ValueError(f"Session {session_id} is not active: {session.status}")
        
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
        
        # Step 3: Use LLM to understand buyer's message
        if self.llm.enabled:
            try:
                extracted = self._understand_chat(chat_message.message, session, current_offer, history_str)
                if extracted is not None:
                    has_price, price, reply = extracted
                    
                    if has_price and price is not None and price > 0:
                        # Route to pricing engine
                        buyer_offer = BuyerOffer(
                            offered_price=Decimal(str(price)),
                            message=chat_message.message,
                        )
                        turn_response = self.process_turn(session_id, buyer_offer)
                        
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
                    else:
                        # Pure conversation — return LLM reply
                        return ChatResponse(
                            session_id=session_id,
                            message=reply or f"I'd love to find a great deal for you on {session.product.product_name}! What price were you thinking?",
                            has_price_offer=False,
                        )
            except Exception as e:
                logger.error("chat_understanding_error", error=str(e))
        
        # Fallback: try regex extraction (only explicit price patterns, not random numbers)
        import re
        # Match: ₹50, $50, 50 rupees, "I offer 50", etc.
        price_match = re.search(
            r'(?:[$₹]\s*)(\d+(?:\.\d{1,2})?)'
            r'|(?:offer|pay|bid|price|budget|give|do)\s+(?:[$₹]\s*)?(\d+(?:\.\d{1,2})?)'
            r'|(\d+(?:\.\d{1,2})?)\s*(?:rupees?|rs\.?|inr|dollars?|bucks?|per\s+unit)',
            chat_message.message,
            re.IGNORECASE,
        )
        if price_match:
            price_str = price_match.group(1) or price_match.group(2) or price_match.group(3)
            price = float(price_str) if price_str else 0
            if price > 0:
                buyer_offer = BuyerOffer(
                    offered_price=Decimal(str(price)),
                    message=chat_message.message,
                )
                turn_response = self.process_turn(session_id, buyer_offer)
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
        
        # No price found and LLM failed — varied engaging fallback
        import random
        fallback_messages = [
            f"I'm really excited to talk to you about {session.product.product_name}! It's one of our best sellers. At ${current_offer} per unit, you're getting incredible value — what price were you thinking?",
            f"Great question! {session.product.product_name} has been flying off the shelves lately. I'd love to work out a deal with you — go ahead and throw out a number!",
            f"You know what, {session.product.product_name} is genuinely one of the best products we carry. The quality really speaks for itself at ${current_offer}. What's your budget looking like?",
            f"I hear you! Let me tell you, customers who've bought {session.product.product_name} keep coming back for more. The value at ${current_offer} is hard to beat — but I'm open to discussing. What did you have in mind?",
            f"Absolutely, let's find a deal that works for both of us! {session.product.product_name} at ${current_offer} is already competitive, but go ahead — give me your best offer and let's see what we can do.",
            f"That's what I love about negotiating {session.product.product_name} — everyone wants it because the quality is outstanding. We're at ${current_offer} right now. What price would make you pull the trigger?",
        ]
        return ChatResponse(
            session_id=session_id,
            message=random.choice(fallback_messages),
            has_price_offer=False,
        )
    
    def _understand_chat(
        self,
        buyer_message: str,
        session: NegotiationSession,
        current_offer: str,
        history_str: str,
    ) -> Optional[tuple]:
        """Use LLM to understand buyer's free-text message."""
        prompt = llm_prompts.build_chat_understanding_prompt(
            buyer_message=buyer_message,
            product_name=session.product.product_name,
            base_price=str(session.product.base_price),
            our_last_offer=current_offer,
            current_round=session.pricing_state.current_round if session.pricing_state else 0,
            max_rounds=session.strategy.max_rounds,
            mode=session.strategy.mode.value,
            negotiation_history=history_str,
        )
        
        result = self.llm.generate_sync(
            system_prompt=llm_prompts.CHAT_UNDERSTANDING_SYSTEM_PROMPT,
            user_prompt=prompt,
            temperature=0.4,
        )
        
        if not result.success:
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
            extracted_price = data.get("extracted_price")
            reply = data.get("reply", "")
            
            return (has_price, extracted_price, reply)
        except (json.JSONDecodeError, ValueError) as e:
            logger.warning("chat_understanding_parse_error", error=str(e))
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
        
        # Calculate concession
        total_concession = session.initial_offer - (session.final_price or session.initial_offer)
        concession_pct = (total_concession / session.initial_offer * 100
                        if session.initial_offer > 0 else Decimal("0"))
        
        # Calculate profit
        gross_profit = None
        profit_margin = None
        if session.final_price:
            gross_profit = session.final_price - session.product.cost_price
            if session.final_price > 0:
                profit_margin = (gross_profit / session.final_price * 100)
        
        # Calculate efficiency
        rounds_used = state.current_round if state else 0
        efficiency = Decimal(str(1 - (rounds_used / session.strategy.max_rounds)))
        
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
        
        # Max rounds reached
        if state.current_round >= session.strategy.max_rounds:
            return True
        
        return False
    
    def _terminate_session(
        self,
        session: NegotiationSession,
        status: NegotiationStatus,
    ) -> NegotiationTurnResponse:
        """Terminate session and return final response."""
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
            timestamp=datetime.utcnow(),
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
        
        # Check if this was the last round
        if session.pricing_state.current_round >= session.strategy.max_rounds:
            return NegotiationStatus.EXPIRED
        
        return NegotiationStatus.ACTIVE


# Global engine instance
_engine: Optional[NegotiationEngine] = None


def get_engine() -> NegotiationEngine:
    """Get or create global negotiation engine."""
    global _engine
    if _engine is None:
        _engine = NegotiationEngine()
    return _engine
