"""
Peitho Tactical Response Generator — Generates natural suggested replies for human sellers.

Uses async OpenRouterClient (never sync) with fast template fallback when LLM is unavailable.
"""
import json
from typing import List, Optional
import structlog

from ..agents.negotiation_engine import EngineResult, NegotiationState
from ..infrastructure.llm.openai_client import OpenRouterClient

logger = structlog.get_logger(__name__)

SUGGESTION_SYSTEM_PROMPT = """You are an elite live negotiation coach whispering tactical response options to a human seller who is speaking to a buyer on Google Meet.
The pricing engine has already calculated the strategic decision and exact counter price.
Give the seller 2 distinct, punchy, conversational spoken responses they can read out loud right now.

RULES:
1. Output ONLY a valid JSON list of 2 strings: ["response 1", "response 2"].
2. Natural, conversational, and confident spoken tone. No corporate buzzwords.
3. Concise (1-2 sentences max per response).
4. Strictly honor the engine's action and counter price.
   - COUNTER: State counter price naturally with strong value justification.
   - ACCEPT: Gracefully close deal at the agreed price.
   - REJECT / WALK_AWAY: Firmly and politely decline without burning relationship.
5. Return ONLY the JSON array, no markdown or reasoning."""

SUGGESTION_USER_TEMPLATE = """FACTS:
- Action: {action}
- Counter: ${counter_price} (Qty: {quantity})
- Strategy: {reasoning}
- Buyer: \"\"\"{buyer_message}\"\"\"
- Round: {round_num}/{max_rounds}
- Firmness: {firmness}/3

Replies:"""


class PeithoIntelClient(OpenRouterClient):
    """Specialized OpenRouter client tailored for Peitho live tactical copilot."""
    def __init__(self):
        super().__init__()
        from ..core.config import get_settings
        settings = get_settings()
        self.model = settings.peitho_intel_model or self.model
        self.max_tokens = settings.peitho_intel_max_tokens
        self.timeout = settings.peitho_intel_timeout_seconds


def _get_template_replies(
    action: str,
    counter_price: float,
    quantity: int,
    firmness: int,
) -> List[str]:
    """Fast, deterministic fallback suggestions when LLM is offline or unconfigured."""
    if action == "ACCEPT":
        return [
            f"That sounds fair to me. Let's lock in ${counter_price:.2f} for {quantity} units.",
            f"We have a deal at ${counter_price:.2f}. I'll prepare the invoice right away.",
        ]
    elif action == "WALK_AWAY" or action == "REJECT":
        return [
            f"I really appreciate your time, but at that number the margins don't work for us. Our best standing price is ${counter_price:.2f}.",
            f"I understand your constraints, but I can't go below ${counter_price:.2f}. Let me know if that works for you down the road.",
        ]
    else:  # COUNTER
        if firmness >= 2:
            return [
                f"Given the quality and current stock, ${counter_price:.2f} is really our bottom line for {quantity} units.",
                f"I've sharpened my pencil as much as I can — I can do ${counter_price:.2f}, but that is my final position.",
            ]
        elif firmness == 1:
            return [
                f"I can meet you partway at ${counter_price:.2f} per unit if we can confirm the order today.",
                f"How about we split the difference at ${counter_price:.2f}? That keeps it workable on our end.",
            ]
        else:
            return [
                f"I can work with you on price. How does ${counter_price:.2f} per unit sound for {quantity} units?",
                f"I can do ${counter_price:.2f} if we can get the paperwork finalized this week.",
            ]


async def generate_tactical_replies(
    engine_result: EngineResult,
    buyer_text: str,
    state: NegotiationState,
    llm_client: Optional[OpenRouterClient] = None,
) -> List[str]:
    """
    Generate 1-2 suggested spoken responses for the seller.
    Always provides fallback replies if LLM is disabled or errors.
    """
    counter_val = float(
        getattr(engine_result, "counter_unit_price", None)
        if getattr(engine_result, "counter_unit_price", None) is not None
        else state.base_price
    )
    decision_raw = str(getattr(engine_result, "decision", "counter")).upper()
    if decision_raw in ("ACCEPT", "REJECT", "FINAL_OFFER"):
        action_val = decision_raw
    else:
        action_val = "COUNTER"

    # 1. Fallback baseline
    fallback_replies = _get_template_replies(
        action=action_val,
        counter_price=counter_val,
        quantity=state.quantity,
        firmness=state.firmness_level,
    )

    client = llm_client or PeithoIntelClient()
    if not client.enabled:
        return fallback_replies

    reasoning_tag = getattr(engine_result, "reasoning_tag", None)
    tag_str = reasoning_tag.value if hasattr(reasoning_tag, "value") else str(reasoning_tag or "Standard pricing strategy")

    prompt = SUGGESTION_USER_TEMPLATE.format(
        action=action_val,
        counter_price=f"{counter_val:.2f}",
        quantity=state.quantity,
        reasoning=tag_str,
        buyer_message=buyer_text,
        round_num=state.current_round + 1,
        max_rounds=state.max_rounds,
        firmness=state.firmness_level,
    )

    try:
        response = await client.generate(
            system_prompt=SUGGESTION_SYSTEM_PROMPT,
            user_prompt=prompt,
            temperature=0.7,
        )

        if response.success and response.content:
            raw = response.content.strip()
            # Clean markdown codeblocks if model returned them
            if raw.startswith("```"):
                lines = raw.splitlines()
                raw = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
            parsed = json.loads(raw)
            if isinstance(parsed, list) and len(parsed) > 0:
                cleaned = [str(item).strip() for item in parsed if str(item).strip()]
                if cleaned:
                    return cleaned[:2]
    except Exception as e:
        logger.warning("tactical_suggestion_generation_failed", error=str(e))

    return fallback_replies
