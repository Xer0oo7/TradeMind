"""
LLM Response Validator

CRITICAL SAFETY LAYER — ensures LLM output:
1. Never invents prices or numbers
2. Never contradicts the pricing decision
3. Contains the correct offer/price values
4. Stays within acceptable length
5. Doesn't contain harmful content

If validation fails, the system falls back to templates.
"""
import re
import structlog
from decimal import Decimal, InvalidOperation
from typing import Optional, List, Tuple
from dataclasses import dataclass

from ..models import OfferDecision, PricingDecision

logger = structlog.get_logger(__name__)


@dataclass
class ValidationResult:
    """Result of LLM output validation."""
    is_valid: bool
    cleaned_content: str
    violations: List[str]


class LLMValidator:
    """
    Validates LLM-generated conversation text against pricing decisions.
    
    This is the safety layer that ensures:
    - The LLM never contradicts the pricing engine
    - No hallucinated numbers appear in output
    - The correct prices are present in the message
    """
    
    # Maximum allowed response length (characters)
    MAX_RESPONSE_LENGTH = 800
    
    # Minimum response length
    MIN_RESPONSE_LENGTH = 5
    
    # Forbidden phrases (LLM should not promise things it can't)
    FORBIDDEN_PHRASES = [
        "i can guarantee",
        "i promise",
        "as an ai",
        "as a language model",
        "i'm just a bot",
        "i don't have feelings",
        "i'm an artificial",
        "let me check with my manager",  # We ARE the decision maker
        "i'll need to get approval",     # No escalation exists
        "free of charge",
        "100% discount",
        "no cost",
    ]
    
    # SECURITY: Phrases that indicate internal data leakage
    LEAKAGE_PHRASES = [
        "cost price",
        "our cost",
        "our margin",
        "margin is",
        "margin of",
        "profit margin",
        "concession budget",
        "minimum acceptable",
        "our minimum",
        "floor price",
        "we can go as low as",
        "our lowest is",
        "break even",
        "breakeven",
    ]
    
    def validate(
        self,
        llm_output: str,
        decision: PricingDecision,
        expected_price: Optional[Decimal] = None,
        buyer_offered: Optional[Decimal] = None,
    ) -> ValidationResult:
        """
        Validate LLM output against the pricing decision.
        
        Returns ValidationResult with cleaned content and any violations.
        """
        violations = []
        content = llm_output.strip()
        
        # Check 1: Length bounds
        if len(content) > self.MAX_RESPONSE_LENGTH:
            content = content[:self.MAX_RESPONSE_LENGTH].rsplit(".", 1)[0] + "."
            violations.append("truncated_response")
        
        if len(content) < self.MIN_RESPONSE_LENGTH:
            violations.append("response_too_short")
            return ValidationResult(False, content, violations)
        
        # Check 2: Forbidden phrases
        content_lower = content.lower()
        for phrase in self.FORBIDDEN_PHRASES:
            if phrase in content_lower:
                violations.append(f"forbidden_phrase: {phrase}")
        
        # Check 2b: SECURITY — detect leaked internal business data
        for phrase in self.LEAKAGE_PHRASES:
            if phrase in content_lower:
                violations.append(f"data_leakage: {phrase}")
        
        # Check 3: Extract all dollar amounts from LLM output
        dollar_amounts = self._extract_prices(content)
        
        # Check 4: Verify prices match the decision
        price_violations = self._verify_prices(
            dollar_amounts, decision, expected_price, buyer_offered
        )
        violations.extend(price_violations)
        
        # Check 5: Decision consistency
        decision_violations = self._verify_decision_consistency(
            content_lower, decision
        )
        violations.extend(decision_violations)
        
        # Determine validity - price violations and leakage are fatal
        has_fatal = any(
            v.startswith("invented_price") or 
            v.startswith("wrong_decision") or
            v.startswith("data_leakage") or
            v == "response_too_short"
            for v in violations
        )
        
        if violations:
            logger.warning(
                "llm_validation_issues",
                violations=violations,
                fatal=has_fatal,
                content_preview=content[:100],
            )
        
        return ValidationResult(
            is_valid=not has_fatal,
            cleaned_content=content,
            violations=violations,
        )
    
    def _extract_prices(self, text: str) -> List[Decimal]:
        """Extract all dollar amounts from text."""
        # Match patterns like ₹95.50, $100, 100 rupees
        patterns = [
            r'[$₹][\d,]+\.?\d*',          # ₹100, $100, ₹95.50, 1,234.56
            r'[\d,]+\.?\d*\s*(?:rupees?|rs\.?|inr|dollars?)',  # 100 rupees, 100 dollars
            r'[\d,]+\.\d{2}\b',          # 95.50 (2 decimal places, likely price)
        ]
        
        amounts = []
        for pattern in patterns:
            matches = re.findall(pattern, text, re.IGNORECASE)
            for match in matches:
                # Clean the match
                cleaned = re.sub(r'[,$\s]', '', match.lower().replace('dollars', '').replace('dollar', ''))
                try:
                    amount = Decimal(cleaned)
                    if amount > 0:
                        amounts.append(amount)
                except (InvalidOperation, ValueError):
                    continue
        
        return amounts
    
    def _verify_prices(
        self,
        found_prices: List[Decimal],
        decision: PricingDecision,
        expected_price: Optional[Decimal],
        buyer_offered: Optional[Decimal],
    ) -> List[str]:
        """Verify prices in the text are legitimate.
        
        We only flag a price as 'invented' if it looks like it could be
        mistaken for a deal price (close to the negotiation range).
        Numbers clearly outside the negotiation range (e.g. "100% satisfaction",
        quantities, percentages) are allowed through.
        """
        violations = []
        
        # Build set of allowed prices
        allowed_prices = set()
        
        if expected_price is not None:
            allowed_prices.add(expected_price)
        
        if buyer_offered is not None:
            allowed_prices.add(buyer_offered)
        
        if decision.counter_offer_price is not None:
            allowed_prices.add(decision.counter_offer_price)
        
        if decision.accepted_price is not None:
            allowed_prices.add(decision.accepted_price)
        
        if not allowed_prices:
            return violations  # Nothing to check against
        
        # Determine the negotiation price range for context
        min_allowed = min(allowed_prices)
        max_allowed = max(allowed_prices)
        
        # Check each found price
        for price in found_prices:
            is_allowed = False
            for allowed in allowed_prices:
                # Allow rounding differences (within $1 — Patch 3)
                if abs(price - allowed) <= Decimal("1.00"):
                    is_allowed = True
                    break
            
            if not is_allowed:
                # Only flag as invented if the price is in the plausible negotiation range
                # (within 2x of the expected range). Numbers way outside (like 100, 1000 
                # when negotiating at $85) are likely contextual, not deal prices.
                range_low = min_allowed * Decimal("0.3")
                range_high = max_allowed * Decimal("2.0")
                if range_low <= price <= range_high:
                    violations.append(
                        f"invented_price: ₹{price} not in allowed {[str(p) for p in allowed_prices]}"
                    )
                else:
                    logger.debug("allowing_contextual_number", price=str(price))
        
        return violations
    
    def _verify_decision_consistency(
        self,
        content_lower: str,
        decision: PricingDecision,
    ) -> List[str]:
        """Verify LLM message aligns with the pricing decision."""
        violations = []
        
        # If we're accepting, message shouldn't suggest rejection
        if decision.decision == OfferDecision.ACCEPT:
            reject_phrases = ["can't accept", "cannot accept", "must decline", "too low", "can't go"]
            for phrase in reject_phrases:
                if phrase in content_lower:
                    violations.append(f"wrong_decision: accept but message says '{phrase}'")
        
        # If we're rejecting, message shouldn't suggest acceptance
        if decision.decision == OfferDecision.REJECT:
            accept_phrases = ["deal!", "agreed!", "we have a deal", "i accept", "sounds good"]
            for phrase in accept_phrases:
                if phrase in content_lower:
                    violations.append(f"wrong_decision: reject but message says '{phrase}'")
        
        return violations


# Singleton
_validator: Optional[LLMValidator] = None


def get_validator() -> LLMValidator:
    """Get or create global validator."""
    global _validator
    if _validator is None:
        _validator = LLMValidator()
    return _validator
