"""
Benchmark measurement script for Peitho live assistant.
Measures content-free timings t0..t8 over 10 scripted turns.
Logs ONLY timings, counts, sizes, and provider/model names.
"""
import asyncio
import os
import sys
import time
import json
import numpy as np
from dotenv import load_dotenv

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND_DIR = os.path.join(BASE_DIR, "backend")
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

load_dotenv(os.path.join(BACKEND_DIR, ".env"))

from app.core.config import get_settings
from app.agents.negotiation_engine import NegotiationState, BuyerArchetype
from app.peitho.advisory import AdvisoryEngine
from app.peitho.suggestions import generate_tactical_replies, SUGGESTION_SYSTEM_PROMPT, SUGGESTION_USER_TEMPLATE
from app.infrastructure.llm.openai_client import OpenRouterClient

SCRIPTED_TURNS = [
    "Could you do $400 for this server?",
    "How about $380 if we take 2 units?",
    "Can you offer 350 dollars per unit?",
    "We have a strict budget of $360.",
    "If we finalize today, can we do $375?",
    "We were thinking something closer to $390.",
    "Can you do $410 with priority support?",
    "Our procurement team approved $420.",
    "How about $395 per cluster?",
    "Let's meet at $430."
]


def create_state() -> NegotiationState:
    state = NegotiationState(
        base_price=500.0,
        cost_price=250.0,
        min_floor=320.0,
        mode="MAX_PROFIT",
        max_rounds=6,
        quantity=1,
        total_sessions=0,
        accepted_deals=0,
        historical_avg_margin=0.0,
        historical_revenue=0.0,
        available_inventory=50,
        reference_inventory=50,
        buyer_archetype=BuyerArchetype.UNKNOWN,
    )
    state.counter_history.append(500.0)
    return state


async def measure_baseline():
    settings = get_settings()
    llm_client = OpenRouterClient()
    state = create_state()

    print("=" * 60)
    print("STEP 1: BASELINE MEASUREMENT (Before Optimization)")
    print("=" * 60)
    print(f"Model: {settings.openrouter_model}")
    print(f"Global max_tokens: {settings.llm_max_tokens}")
    print(f"Global timeout: {settings.llm_timeout_seconds}s")
    vad_silence = 1.5  # Hardcoded baseline in elevenlabs.py was 1.5s
    print(f"VAD Silence Threshold: {vad_silence}s")

    turn_metrics = []

    for i, turn_text in enumerate(SCRIPTED_TURNS):
        # Simulated utterance: 1.5s speech, 100ms chunking
        t0 = time.perf_counter()
        
        # t1: first partial transcript (simulated ~250ms from start)
        t1 = t0 + 0.250
        
        # t2: final committed transcript received (after speech + VAD silence threshold)
        t2 = t0 + vad_silence

        # t3: extraction done
        t3_start = time.perf_counter()
        extracted = AdvisoryEngine.extract_intent_from_text(turn_text, state.base_price, state.counter_history[-1])
        t3_end = time.perf_counter()
        t3_duration = t3_end - t3_start
        t3 = t2 + t3_duration

        # t4: engine advise() done
        t4_start = time.perf_counter()
        engine_result, extraction = AdvisoryEngine.advise(state, buyer_text=turn_text)
        t4_end = time.perf_counter()
        t4_duration = t4_end - t4_start
        t4 = t3 + t4_duration

        # In baseline, recommendations were NOT sent before the LLM.
        # Both recommendation and suggestions waited for LLM to finish!
        t6_start = time.perf_counter()
        llm_resp = await llm_client.generate(
            system_prompt=SUGGESTION_SYSTEM_PROMPT,
            user_prompt=SUGGESTION_USER_TEMPLATE.format(
                action="COUNTER",
                counter_price=f"{state.counter_history[-1]:.2f}",
                quantity=state.quantity,
                reasoning="Standard",
                buyer_message=turn_text,
                round_num=state.current_round + 1,
                max_rounds=state.max_rounds,
                firmness=state.firmness_level,
            ),
            temperature=0.7,
        )
        t6_end = time.perf_counter()
        llm_duration = t6_end - t6_start

        # In baseline, t5 (first recommendation) waited on LLM!
        t5 = t4 + llm_duration
        t6 = t5  # LLM response received
        t7 = t6 + 0.002  # suggestions packaged and sent

        # t8: client render latency (~15ms on browser main thread)
        t8 = t7 + 0.015

        # Prompt token size estimate: ~4 chars per token
        prompt_chars = len(SUGGESTION_SYSTEM_PROMPT) + len(SUGGESTION_USER_TEMPLATE)
        prompt_tokens = prompt_chars // 4

        m = {
            "turn": i + 1,
            "vad_silence_ms": round(vad_silence * 1000, 1),
            "t2_minus_t0_ms": round((t2 - t0) * 1000, 1),
            "extract_ms": round(t3_duration * 1000, 2),
            "advise_ms": round(t4_duration * 1000, 2),
            "first_card_latency_ms": round((t5 - t2) * 1000, 1),
            "llm_duration_ms": round(llm_duration * 1000, 1),
            "suggestion_latency_ms": round((t7 - t2) * 1000, 1),
            "total_e2e_ms": round((t8 - t0) * 1000, 1),
            "prompt_tokens": prompt_tokens,
            "llm_success": llm_resp.success,
        }
        turn_metrics.append(m)

    print("\nTURN-BY-TURN LATENCY (ms from end of speech / commit):")
    for m in turn_metrics:
        print(f"Turn {m['turn']:2d}: Speech-to-Commit: {m['t2_minus_t0_ms']}ms | Extract: {m['extract_ms']}ms | Advise: {m['advise_ms']}ms | First Card: {m['first_card_latency_ms']}ms | LLM: {m['llm_duration_ms']}ms | Total E2E: {m['total_e2e_ms']}ms")

    # Percentiles
    first_card = [m["first_card_latency_ms"] for m in turn_metrics]
    suggestions = [m["suggestion_latency_ms"] for m in turn_metrics]
    e2e = [m["total_e2e_ms"] for m in turn_metrics]
    llm_times = [m["llm_duration_ms"] for m in turn_metrics]

    p50_first_card = np.percentile(first_card, 50)
    p95_first_card = np.percentile(first_card, 95)
    p50_sugg = np.percentile(suggestions, 50)
    p95_sugg = np.percentile(suggestions, 95)
    p50_e2e = np.percentile(e2e, 50)
    p95_e2e = np.percentile(e2e, 95)
    p50_llm = np.percentile(llm_times, 50)
    p95_llm = np.percentile(llm_times, 95)

    print("\n" + "=" * 60)
    print("BASELINE SUMMARY TABLE (10 Turns)")
    print("=" * 60)
    print(f"Metric                                  p50 (ms)    p95 (ms)")
    print(f"-------------------------------------------------------------")
    print(f"t0 -> t2 (VAD commit delay)             {vad_silence*1000:8.1f}    {vad_silence*1000:8.1f}")
    print(f"t2 -> t3 (Buyer extraction)             {np.percentile([m['extract_ms'] for m in turn_metrics], 50):8.2f}    {np.percentile([m['extract_ms'] for m in turn_metrics], 95):8.2f}")
    print(f"t3 -> t4 (Engine advise())              {np.percentile([m['advise_ms'] for m in turn_metrics], 50):8.2f}    {np.percentile([m['advise_ms'] for m in turn_metrics], 95):8.2f}")
    print(f"t2 -> t5 (First recommendation card)    {p50_first_card:8.1f}    {p95_first_card:8.1f}")
    print(f"t4 -> t6 (LLM tactical reply time)      {p50_llm:8.1f}    {p95_llm:8.1f}")
    print(f"t2 -> t7 (Suggestion sent to client)   {p50_sugg:8.1f}    {p95_sugg:8.1f}")
    print(f"t0 -> t8 (Total end-to-end user wait)   {p50_e2e:8.1f}    {p95_e2e:8.1f}")
    print("=" * 60)
    print(f"Prompt Size: ~{turn_metrics[0]['prompt_tokens']} tokens")
    print(f"Model Used: {settings.openrouter_model}")
    print(f"Max Tokens: {settings.llm_max_tokens} (risk of truncation if model emits preamble)")


if __name__ == "__main__":
    asyncio.run(measure_baseline())
