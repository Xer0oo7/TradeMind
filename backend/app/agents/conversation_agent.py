"""
Conversation Agent

Purpose: Convert pricing decisions into natural language.
This agent NEVER makes numeric decisions - only explains them.

Rules:
- Never invent numbers
- Never contradict pricing agent
- Only explain, justify, or soften decisions
- Uses LLM (OpenRouter) for natural language when available
- Falls back to templates if LLM fails or is not configured
- ALL LLM output is validated before returning
"""
import random
from decimal import Decimal
from typing import Optional
from dataclasses import dataclass
import structlog

from ..models import (
    OfferDecision,
    NegotiationMode,
    NegotiationStatus,
    PricingDecision,
)
from ..infrastructure.llm.openai_client import get_llm_client, OpenRouterClient
from ..services.llm_validator import get_validator, LLMValidator
from ..infrastructure.llm import prompt_templates as llm_prompts

logger = structlog.get_logger(__name__)


@dataclass
class ConversationContext:
    """Context needed to generate conversation."""
    round_number: int
    max_rounds: int
    mode: NegotiationMode
    product_name: str
    quantity: int
    buyer_offered: Optional[Decimal]
    our_offer: Optional[Decimal]


class ConversationAgent:
    """
    Generates natural language responses for negotiation turns.
    
    Architecture:
    1. Try LLM (OpenRouter) for natural, context-aware responses
    2. Validate LLM output against pricing decision
    3. If validation fails OR LLM unavailable → fall back to templates
    
    The LLM NEVER decides prices. It only communicates them.
    """
    
    def __init__(
        self,
        llm_client: Optional[OpenRouterClient] = None,
        validator: Optional[LLMValidator] = None,
    ):
        self.llm = llm_client or get_llm_client()
        self.validator = validator or get_validator()
    
    # ==========================================================================
    # Template Collections (Fallback)
    # ==========================================================================
    
    INITIAL_OFFER_TEMPLATES = {
        NegotiationMode.MAX_PROFIT: [
            "Hey! Thanks for checking out {product}. For {quantity} unit(s), I can do ₹{offer} per unit — that's a solid price for what you're getting.",
            "Great to connect! {product} at ₹{offer} each for {quantity} unit(s) — I think you'll love the value here.",
        ],
        NegotiationMode.MIN_LOSS: [
            "Hey there! I'd love to get {product} to you. For {quantity} unit(s), I'm starting at ₹{offer} each — let's talk!",
            "Thanks for your interest! I'm motivated to make this work. {quantity} unit(s) of {product} at ₹{offer} each — what do you think?",
        ],
    }
    
    ACCEPT_TEMPLATES = [
        "Done deal! ₹{price} per unit for {quantity} unit(s) — I'm happy with that. Pleasure doing business!",
        "We've got a deal at ₹{price} per unit! Great negotiating — I think this works out well for both of us.",
        "Love it! ₹{price} per unit for {quantity} unit(s). Let's make it official!",
    ]
    
    COUNTER_TEMPLATES = {
        NegotiationMode.MAX_PROFIT: {
            "early": [
                "I hear you at ₹{buyer_offer}, but I need to be at ₹{our_offer} per unit. The quality on this one really backs up that price.",
                "Thanks for the offer! ₹{buyer_offer} is a bit low for me though — how about ₹{our_offer}? I think that's fair.",
                "I get where you're coming from with ₹{buyer_offer}. Let me meet you closer — ₹{our_offer} per unit work for you?",
            ],
            "mid": [
                "We're making progress! I've come down to ₹{our_offer} per unit — that's a real move on my end.",
                "Alright, I can do ₹{our_offer}. That's me meeting you halfway. What do you say?",
            ],
            "late": [
                "Look, ₹{our_offer} per unit is truly my best price. I can't stretch further than this.",
                "I really want to close this deal — ₹{our_offer} is as far as I can go. Let's shake on it!",
            ],
        },
        NegotiationMode.MIN_LOSS: {
            "early": [
                "I hear your ₹{buyer_offer}. Let me come to you a bit — how's ₹{our_offer} per unit?",
                "I want to make this work! ₹{our_offer} per unit — that's me being flexible for you.",
            ],
            "mid": [
                "Alright, I'm at ₹{our_offer} now — that's a big move. Let's get this done!",
                "I've come down to ₹{our_offer} per unit. We're really close — let's lock it in.",
            ],
            "late": [
                "Final offer time: ₹{our_offer} per unit. I really can't go lower, but I hope we can make this work.",
                "₹{our_offer} per unit — that's my absolute bottom. Take it and let's celebrate!",
            ],
        },
    }
    
    REJECT_TEMPLATES = [
        "I really wanted to make this work, but I can't go that low. No hard feelings — hope we can work together in the future!",
        "Unfortunately the numbers just don't work at that price. It was great chatting with you though!",
        "I wish I could go lower, but I've hit my limit. Thanks for your time — you know where to find me if you change your mind!",
    ]
    
    CONSTRAINT_VIOLATION_TEMPLATES = [
        "That offer is below what I can consider. You'll need to come up significantly for us to move forward.",
        "I appreciate the offer, but ₹{buyer_offer} doesn't meet our requirements. We'd need a much stronger offer.",
        "That's outside our acceptable range. Please reconsider and come back with a more competitive number.",
    ]
    
    SESSION_EXPIRED_TEMPLATES = [
        "We've reached the end of our negotiation window without agreement.",
        "Our negotiation has concluded without a deal. Thank you for your time.",
    ]
    
    # ==========================================================================
    # Public Methods — LLM-first with template fallback
    # ==========================================================================
    
    def generate_initial_message(
        self,
        offer: Decimal,
        context: ConversationContext,
    ) -> str:
        """Generate the opening offer message."""
        # Try LLM first
        if self.llm.enabled:
            llm_result = self.llm.generate_sync(
                system_prompt=llm_prompts.SYSTEM_PROMPT,
                user_prompt=llm_prompts.build_initial_offer_prompt(
                    product_name=context.product_name,
                    quantity=context.quantity,
                    offer_price=self._format_price(offer),
                    mode=context.mode.value,
                ),
                temperature=0.7,
            )
            
            if llm_result.success:
                # Build a minimal decision for validation
                from ..models import PricingDecision, OfferDecision
                mock_decision = PricingDecision(
                    decision=OfferDecision.COUNTER,
                    counter_offer_price=offer,
                    margin_percentage=Decimal("0"),
                    profit_per_unit=Decimal("0"),
                    total_profit=Decimal("0"),
                    within_constraints=True,
                    remaining_concession_budget=Decimal("0"),
                    concession_percentage_used=Decimal("0"),
                )
                
                validation = self.validator.validate(
                    llm_output=llm_result.content,
                    decision=mock_decision,
                    expected_price=offer,
                )
                
                if validation.is_valid:
                    logger.info("llm_used", action="initial_offer", model=llm_result.model)
                    return validation.cleaned_content
                else:
                    logger.warning(
                        "llm_validation_failed",
                        action="initial_offer",
                        violations=validation.violations,
                    )
        
        # Fallback to template
        logger.info("template_fallback", action="initial_offer")
        return self._template_initial(offer, context)
    
    def generate_response(
        self,
        decision: PricingDecision,
        context: ConversationContext,
        floor_price: Optional[Decimal] = None,
    ) -> str:
        """Generate response message based on pricing decision."""
        # Try LLM first
        if self.llm.enabled:
            llm_message = self._try_llm_response(decision, context, floor_price)
            if llm_message is not None:
                return llm_message
        
        # Fallback to templates
        logger.info("template_fallback", action=decision.decision.value)
        return self._template_response(decision, context, floor_price)
    
    def generate_session_expired(self, context: ConversationContext) -> str:
        """Generate message for expired session."""
        if self.llm.enabled:
            llm_result = self.llm.generate_sync(
                system_prompt=llm_prompts.SYSTEM_PROMPT,
                user_prompt=llm_prompts.build_session_expired_prompt(
                    product_name=context.product_name,
                    round_number=context.round_number,
                    max_rounds=context.max_rounds,
                ),
                temperature=0.7,
            )
            if llm_result.success and len(llm_result.content) > 10:
                logger.info("llm_used", action="session_expired", model=llm_result.model)
                return llm_result.content
        
        return self.SESSION_EXPIRED_TEMPLATES[0]
    
    def generate_buyer_walked(self, context: ConversationContext) -> str:
        """Generate message when buyer ends negotiation."""
        return "I understand. Thank you for your time. Feel free to reach out if you reconsider."
    
    # ==========================================================================
    # LLM Response Generation (with validation)
    # ==========================================================================
    
    def _try_llm_response(
        self,
        decision: PricingDecision,
        context: ConversationContext,
        floor_price: Optional[Decimal],
    ) -> Optional[str]:
        """
        Try to generate an LLM response with validation.
        Returns None if LLM fails or validation fails.
        """
        try:
            if decision.decision == OfferDecision.ACCEPT:
                prompt = llm_prompts.build_accept_prompt(
                    product_name=context.product_name,
                    quantity=context.quantity,
                    accepted_price=self._format_price(decision.accepted_price),
                    round_number=context.round_number,
                    max_rounds=context.max_rounds,
                )
                expected_price = decision.accepted_price
                
            elif decision.decision == OfferDecision.REJECT:
                prompt = llm_prompts.build_reject_prompt(
                    product_name=context.product_name,
                    quantity=context.quantity,
                    buyer_offered=self._format_price(context.buyer_offered),
                    round_number=context.round_number,
                    max_rounds=context.max_rounds,
                )
                expected_price = None
                
            elif decision.decision == OfferDecision.COUNTER:
                prompt = llm_prompts.build_counter_prompt(
                    product_name=context.product_name,
                    quantity=context.quantity,
                    buyer_offered=self._format_price(context.buyer_offered),
                    our_counter=self._format_price(decision.counter_offer_price),
                    round_number=context.round_number,
                    max_rounds=context.max_rounds,
                    mode=context.mode.value,
                    concession_pct_used=self._format_price(decision.concession_percentage_used),
                    is_constraint_violation=not decision.within_constraints,
                )
                expected_price = decision.counter_offer_price
            else:
                return None
            
            # Call LLM
            llm_result = self.llm.generate_sync(
                system_prompt=llm_prompts.SYSTEM_PROMPT,
                user_prompt=prompt,
                temperature=0.7,
            )
            
            if not llm_result.success:
                logger.warning("llm_failed", action=decision.decision.value, error=llm_result.error)
                return None
            
            # Validate
            validation = self.validator.validate(
                llm_output=llm_result.content,
                decision=decision,
                expected_price=expected_price,
                buyer_offered=context.buyer_offered,
            )
            
            if validation.is_valid:
                logger.info(
                    "llm_used",
                    action=decision.decision.value,
                    model=llm_result.model,
                    tokens=llm_result.tokens_used,
                )
                return validation.cleaned_content
            else:
                logger.warning(
                    "llm_validation_failed",
                    action=decision.decision.value,
                    violations=validation.violations,
                    content_preview=llm_result.content[:100],
                )
                return None
        
        except Exception as e:
            logger.error("llm_response_error", error=str(e))
            return None
    
    # ==========================================================================
    # Template Fallback Methods
    # ==========================================================================
    
    def _template_initial(self, offer: Decimal, context: ConversationContext) -> str:
        """Template fallback for initial offer."""
        templates = self.INITIAL_OFFER_TEMPLATES[context.mode]
        template = random.choice(templates)
        return template.format(
            product=context.product_name,
            quantity=context.quantity,
            offer=self._format_price(offer),
        )
    
    def _template_response(
        self,
        decision: PricingDecision,
        context: ConversationContext,
        floor_price: Optional[Decimal] = None,
    ) -> str:
        """Template fallback for turn responses."""
        if decision.decision == OfferDecision.ACCEPT:
            return self._generate_accept(decision, context)
        elif decision.decision == OfferDecision.REJECT:
            return self._generate_reject(decision, context)
        elif decision.decision == OfferDecision.COUNTER:
            if not decision.within_constraints:
                return self._generate_constraint_violation(
                    decision, context, floor_price
                )
            return self._generate_counter(decision, context)
        return "Let me review that offer."
    
    def _generate_accept(
        self,
        decision: PricingDecision,
        context: ConversationContext,
    ) -> str:
        """Generate acceptance message."""
        template = self.ACCEPT_TEMPLATES[0]
        msg = template.format(
            price=self._format_price(decision.accepted_price),
            quantity=context.quantity,
        )
        # Append total when multi-unit
        if context.quantity > 1 and decision.accepted_price is not None:
            total = decision.accepted_price * context.quantity
            msg = msg.rstrip('.') + f" (${self._format_price(total)} total)."
        return msg
    
    def _generate_reject(
        self,
        decision: PricingDecision,
        context: ConversationContext,
    ) -> str:
        """Generate rejection message."""
        return random.choice(self.REJECT_TEMPLATES)
    
    def _generate_counter(
        self,
        decision: PricingDecision,
        context: ConversationContext,
    ) -> str:
        """Generate counter-offer message."""
        phase = self._get_phase(context.round_number, context.max_rounds)
        templates = self.COUNTER_TEMPLATES[context.mode][phase]
        template = random.choice(templates)
        
        msg = template.format(
            buyer_offer=self._format_price(context.buyer_offered),
            our_offer=self._format_price(decision.counter_offer_price),
            quantity=context.quantity,
            product=context.product_name,
        )
        # Append total when multi-unit
        if context.quantity > 1 and decision.counter_offer_price is not None:
            total = decision.counter_offer_price * context.quantity
            msg += f" That's ${self._format_price(total)} total for {context.quantity} units."
        return msg
    
    def _generate_constraint_violation(
        self,
        decision: PricingDecision,
        context: ConversationContext,
        floor_price: Optional[Decimal],
    ) -> str:
        """Generate response for constraint violation — NEVER reveal floor price."""
        template = random.choice(self.CONSTRAINT_VIOLATION_TEMPLATES)
        
        return template.format(
            buyer_offer=self._format_price(context.buyer_offered),
            product=context.product_name,
        )
    
    def _get_phase(self, current_round: int, max_rounds: int) -> str:
        """Determine negotiation phase."""
        progress = current_round / max_rounds
        
        if progress <= 0.33:
            return "early"
        elif progress <= 0.66:
            return "mid"
        else:
            return "late"
    
    def _format_price(self, price: Optional[Decimal]) -> str:
        """Format price for display."""
        if price is None:
            return "N/A"
        return f"{price:.2f}"
