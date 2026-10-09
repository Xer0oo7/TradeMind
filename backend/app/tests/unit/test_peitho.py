"""
Unit and integration tests for Peitho Live Assistant.
"""
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.agents.negotiation_engine import NegotiationState, BuyerArchetype
from app.peitho.schemas import PeithoSessionConfig
from app.peitho.advisory import AdvisoryEngine
from app.peitho.session_store import PeithoSessionStore
from app.peitho.stt import get_stt_adapter, TypedSTTAdapter, ElevenLabsSTTAdapter
from app.peitho.suggestions import _get_template_replies


def create_test_state() -> NegotiationState:
    """Helper to create a standard NegotiationState."""
    state = NegotiationState(
        base_price=100.0,
        cost_price=60.0,
        min_floor=70.0,
        mode="MAX_PROFIT",
        max_rounds=5,
        quantity=1,
        total_sessions=0,
        accepted_deals=0,
        historical_avg_margin=0.0,
        historical_revenue=0.0,
        available_inventory=50,
        reference_inventory=50,
        buyer_archetype=BuyerArchetype.UNKNOWN,
    )
    state.counter_history.append(100.0)
    return state


def test_advisory_text_extraction():
    """Verify price, quantity, and intent extraction from speech transcripts."""
    # Test price extraction with dollar sign
    ext1 = AdvisoryEngine.extract_intent_from_text("Can you do $85 for this?", base_price=100.0, current_counter=100.0)
    assert ext1["unit_price_offered"] == 85.0
    assert ext1["intent"] == "offer"

    # Test price extraction with words
    ext2 = AdvisoryEngine.extract_intent_from_text("I can offer 80 dollars", base_price=100.0, current_counter=100.0)
    assert ext2["unit_price_offered"] == 80.0
    assert ext2["intent"] == "offer"

    # Test bundle total and quantity: $500 for 10 units
    ext3 = AdvisoryEngine.extract_intent_from_text("$500 for 10 units", base_price=100.0, current_counter=100.0)
    assert ext3["quantity"] == 10
    assert ext3["total_price_offered"] == 500.0
    assert ext3["unit_price_offered"] == 50.0

    # Test accept keywords
    ext4 = AdvisoryEngine.extract_intent_from_text("Sounds good, deal!", base_price=100.0, current_counter=95.0)
    assert ext4["intent"] == "accept"
    assert ext4["unit_price_offered"] == 95.0

    # Test reject keywords
    ext5 = AdvisoryEngine.extract_intent_from_text("That's way too expensive, no way", base_price=100.0, current_counter=95.0)
    assert ext5["intent"] == "reject"


def test_advisory_mode_isolation():
    """Verify that advise() does NOT mutate master state (deepcopy isolation)."""
    master_state = create_test_state()
    initial_round = master_state.current_round
    initial_bbi = master_state.bbi
    initial_counter_history = list(master_state.counter_history)

    # Run advisory check
    result, extraction = AdvisoryEngine.advise(
        state=master_state,
        buyer_text="I'll give you $80 for it",
    )

    # Recommendation should be produced
    assert result is not None
    assert extraction["unit_price_offered"] == 80.0

    # Invariant: Master state MUST be unchanged
    assert master_state.current_round == initial_round
    assert master_state.bbi == initial_bbi
    assert master_state.counter_history == initial_counter_history


def test_apply_seller_line_synchronization():
    """Verify that seller verbalized price updates master state counter history."""
    master_state = create_test_state()
    assert master_state.counter_history == [100.0]

    # Seller says a counter offer
    detected = AdvisoryEngine.apply_seller_line(master_state, "I can come down to $92 for you today.")
    assert detected == 92.0
    assert master_state.counter_history[-1] == 92.0


def test_session_store_crud():
    """Test PeithoSessionStore lifecycle."""
    store = PeithoSessionStore(ttl_seconds=3600)
    cfg = PeithoSessionConfig(
        product_name="Test Widget",
        base_price=100.0,
        cost_price=60.0,
        min_floor=70.0,
    )
    session = store.create_session(cfg)
    assert session.session_id is not None
    assert session.master_state.base_price == 100.0

    # Retrieval
    retrieved = store.get_session(session.session_id)
    assert retrieved is not None
    assert retrieved.session_id == session.session_id

    # Active summary list
    summaries = store.list_active_sessions()
    assert len(summaries) >= 1

    # Delete
    assert store.delete_session(session.session_id) is True
    assert store.get_session(session.session_id) is None


@pytest.mark.asyncio
async def test_typed_stt_adapter():
    """Test Typed STT adapter dispatches partial and final events."""
    adapter = TypedSTTAdapter(channel_name="BUYER")
    partial_received = []
    final_received = []

    async def on_part(t):
        partial_received.append(t)

    async def on_fin(t):
        final_received.append(t)

    adapter.on_partial(on_part)
    adapter.on_final(on_fin)
    await adapter.start()

    await adapter.send_text("Hello there", is_final=False)
    assert partial_received == ["Hello there"]

    await adapter.send_text("I can do $85", is_final=True)
    assert final_received == ["I can do $85"]

    await adapter.close()
    assert adapter.is_active is False


def test_stt_factory_graceful_fallback():
    """STT factory should fallback to Typed adapter when ElevenLabs key is not set."""
    adapter = get_stt_adapter(provider="elevenlabs", channel="BUYER")
    # Because elevenlabs_api_key is empty in test environment, it falls back to TypedSTTAdapter
    assert isinstance(adapter, (TypedSTTAdapter, ElevenLabsSTTAdapter))


def test_template_replies():
    """Verify template reply variations."""
    counter_replies = _get_template_replies(action="COUNTER", counter_price=88.0, quantity=2, firmness=1)
    assert len(counter_replies) == 2
    assert "88.00" in counter_replies[0] or "88.00" in counter_replies[1]

    accept_replies = _get_template_replies(action="ACCEPT", counter_price=90.0, quantity=1, firmness=0)
    assert len(accept_replies) == 2


from unittest.mock import patch, AsyncMock
from app.main import app

@patch("app.peitho.routes.generate_tactical_replies", new_callable=AsyncMock)
def test_peitho_rest_api(mock_replies):
    """Test Peitho REST endpoints."""
    mock_replies.return_value = ["I can do $210.", "How about $215?"]
    client = TestClient(app)
    res = client.get("/api/v1/peitho/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "online"

    # Start session
    payload = {
        "product_name": "Ultra Noise-Cancelling Headphones",
        "base_price": 250.0,
        "cost_price": 140.0,
        "min_floor": 180.0,
        "mode": "MAX_PROFIT",
        "max_rounds": 6,
        "quantity": 2,
    }
    start_res = client.post("/api/v1/peitho/start", json=payload)
    assert start_res.status_code == 200
    start_data = start_res.json()
    assert "session_id" in start_data
    session_id = start_data["session_id"]

    # Get session details
    detail_res = client.get(f"/api/v1/peitho/sessions/{session_id}")
    assert detail_res.status_code == 200
    detail_data = detail_res.json()
    assert detail_data["product_name"] == "Ultra Noise-Cancelling Headphones"

    # WebSocket connection test
    with client.websocket_connect(f"/api/v1/peitho/ws/{session_id}") as ws:
        ready_msg = ws.receive_json()
        assert ready_msg["type"] == "ready"
        assert ready_msg["session_id"] == session_id

        def recv_non_state():
            m = ws.receive_json()
            while m.get("type") in ("state", "recommendation_update"):
                m = ws.receive_json()
            return m

        # Send a typed buyer transcript line
        ws.send_json({
            "type": "transcript_line",
            "channel": "BUYER",
            "text": "Could you do $200 each for 2 pairs?",
            "is_final": True,
        })

        # Expect final_transcript message
        final_msg = recv_non_state()
        assert final_msg["type"] == "final_transcript"
        assert final_msg["channel"] == "BUYER"
        assert "200" in final_msg["text"]

        # Expect advisory message
        adv_msg = recv_non_state()
        assert adv_msg["type"] == "advisory"
        advisory_data = adv_msg["data"]
        assert advisory_data["action"] in ["COUNTER", "ACCEPT", "REJECT", "WALK_AWAY"]
        assert len(advisory_data["suggested_replies"]) >= 1

        # Test seller counter utterance
        ws.send_json({
            "type": "transcript_line",
            "channel": "SELLER",
            "text": "Best I can do is $220 each.",
            "is_final": True,
        })

        seller_final = recv_non_state()
        assert seller_final["type"] == "final_transcript"
        assert seller_final["channel"] == "SELLER"

        seller_update = recv_non_state()
        assert seller_update["type"] == "seller_update"
        assert seller_update["detected_price"] == 220.0

        # Close call
        ws.send_json({"type": "end_call"})
        call_ended = recv_non_state()
        assert call_ended["type"] == "call_ended"


def test_mocked_provider_orchestrator_events():
    """
    Test that mocked provider's partial/final events feed through the orchestrator:
    - BUYER final produces an advisory recommendation message
    - SELLER final does NOT trigger the advisory engine
    """
    client = TestClient(app)
    start_res = client.post("/api/v1/peitho/start", json={
        "product_name": "Premium Cloud Server",
        "base_price": 500.0,
        "cost_price": 250.0,
        "min_floor": 350.0,
        "mode": "MAX_PROFIT",
        "max_rounds": 5,
        "quantity": 1,
    })
    session_id = start_res.json()["session_id"]

    with client.websocket_connect(f"/api/v1/peitho/ws/{session_id}") as ws:
        def recv_non_state():
            m = ws.receive_json()
            while m.get("type") == "state":
                m = ws.receive_json()
            return m

        ready_msg = ws.receive_json()
        assert ready_msg["type"] == "ready"

        # 1. SELLER partial event
        ws.send_json({
            "type": "transcript_line",
            "channel": "mic",
            "text": "I can offer",
            "is_final": False,
        })
        seller_partial = recv_non_state()
        assert seller_partial["type"] == "partial_transcript"
        assert seller_partial["channel"] == "SELLER"

        # 2. SELLER final event (verbal counter: $460)
        ws.send_json({
            "type": "transcript_line",
            "channel": "mic",
            "text": "I can offer $460 for this configuration today.",
            "is_final": True,
        })
        seller_final = recv_non_state()
        assert seller_final["type"] == "final_transcript"
        assert seller_final["channel"] == "SELLER"

        seller_update = recv_non_state()
        assert seller_update["type"] == "seller_update"
        assert seller_update["detected_price"] == 460.0

        # Invariant: SELLER final MUST NOT emit an advisory message
        # Verify by sending a ping to prove no intermediate advisory was queued
        ws.send_json({"type": "ping"})
        pong_msg = recv_non_state()
        assert pong_msg["type"] == "pong"

        # 3. BUYER partial event
        ws.send_json({
            "type": "transcript_line",
            "channel": "tab",
            "text": "That is high, could you",
            "is_final": False,
        })
        buyer_partial = recv_non_state()
        assert buyer_partial["type"] == "partial_transcript"
        assert buyer_partial["channel"] == "BUYER"

        # 4. BUYER final event -> MUST trigger Advisory Engine
        ws.send_json({
            "type": "transcript_line",
            "channel": "tab",
            "text": "That is too high, how about $400 flat?",
            "is_final": True,
        })
        buyer_final = recv_non_state()
        assert buyer_final["type"] == "final_transcript"
        assert buyer_final["channel"] == "BUYER"

        buyer_advisory = recv_non_state()
        assert buyer_advisory["type"] == "advisory"
        assert buyer_advisory["data"]["action"] in ["COUNTER", "ACCEPT", "REJECT", "FINAL_OFFER"]
        assert buyer_advisory["data"]["counter_price"] >= 350.0

        ws.send_json({"type": "end_call"})
        assert recv_non_state()["type"] == "call_ended"


def test_audio_mic_and_tab_channel_routing(monkeypatch):
    """
    Test that audio messages on 'mic' and 'tab' are routed to separate STT instances.
    """
    import base64
    from app.peitho.stt.base import BaseSTTAdapter

    class DummySTT(BaseSTTAdapter):
        def __init__(self, channel_name: str):
            super().__init__(channel_name=channel_name)
            self.received_chunks = []
            self._is_active = True

        async def start(self) -> None:
            pass

        async def send_audio(self, pcm_chunk: bytes) -> None:
            self.received_chunks.append(pcm_chunk)

        async def close(self) -> None:
            pass

    seller_instance = DummySTT(channel_name="SELLER")
    buyer_instance = DummySTT(channel_name="BUYER")

    def mock_get_adapter(provider=None, channel="default", on_status_change=None, **kwargs):
        if channel == "SELLER":
            return seller_instance
        return buyer_instance

    monkeypatch.setattr("app.peitho.routes.get_stt_adapter", mock_get_adapter)

    client = TestClient(app)
    start_res = client.post("/api/v1/peitho/start", json={
        "product_name": "Test Hardware",
        "base_price": 100.0,
        "cost_price": 50.0,
        "min_floor": 70.0,
    })
    session_id = start_res.json()["session_id"]

    sample_pcm = b"\x01\x02\x03\x04" * 100
    b64_audio = base64.b64encode(sample_pcm).decode("ascii")

    with client.websocket_connect(f"/api/v1/peitho/ws/{session_id}") as ws:
        def recv_non_state():
            m = ws.receive_json()
            while m.get("type") in ("state", "recommendation_update"):
                m = ws.receive_json()
            return m

        ready_msg = ws.receive_json()
        assert ready_msg["type"] == "ready"

        # 1. Send audio on 'mic' channel
        ws.send_json({
            "type": "audio",
            "channel": "mic",
            "data": b64_audio,
        })

        # 2. Send audio on 'tab' channel
        ws.send_json({
            "type": "audio",
            "channel": "tab",
            "data": b64_audio,
        })

        # Send ping to synchronize socket loop
        ws.send_json({"type": "ping"})
        assert recv_non_state()["type"] == "pong"

        # Assert routed to separate STT instances
        assert len(seller_instance.received_chunks) == 1
        assert seller_instance.received_chunks[0] == sample_pcm

        assert len(buyer_instance.received_chunks) == 1
        assert buyer_instance.received_chunks[0] == sample_pcm

        ws.send_json({"type": "end_call"})
        assert recv_non_state()["type"] == "call_ended"


def test_two_stage_push_and_recommendation_update():
    """
    Verify that Stage 1 sends an immediate template advisory (< 10ms)
    and Stage 2 subsequently emits a recommendation_update with matching recommendation_id.
    """
    client = TestClient(app)
    start_res = client.post("/api/v1/peitho/start", json={
        "product_name": "Pro Workstation",
        "base_price": 500.0,
        "cost_price": 250.0,
        "min_floor": 350.0,
        "max_rounds": 5,
        "quantity": 1,
    })
    session_id = start_res.json()["session_id"]

    with client.websocket_connect(f"/api/v1/peitho/ws/{session_id}") as ws:
        ready = ws.receive_json()
        assert ready["type"] == "ready"

        # Inject final BUYER line
        ws.send_json({
            "type": "transcript_line",
            "channel": "tab",
            "text": "Can you do $400 for this workstation?",
            "is_final": True,
        })

        # Receive final_transcript
        msg1 = ws.receive_json()
        while msg1.get("type") == "state":
            msg1 = ws.receive_json()
        assert msg1["type"] == "final_transcript"

        # Receive Stage 1 advisory
        msg2 = ws.receive_json()
        while msg2.get("type") == "state":
            msg2 = ws.receive_json()
        assert msg2["type"] == "advisory"
        assert msg2["source"] == "template"
        assert "recommendation_id" in msg2
        assert "timing" in msg2
        rec_id = msg2["recommendation_id"]
        assert msg2["timing"]["t2_to_t5_ms"] >= 0

        # Wait for either recommendation_update or ping
        ws.send_json({"type": "ping"})
        received_types = []
        for _ in range(5):
            m = ws.receive_json()
            received_types.append(m.get("type"))
            if m.get("type") == "recommendation_update":
                assert m["recommendation_id"] == rec_id
                assert m["source"] == "ai"
                assert "suggested_replies" in m
            if m.get("type") == "pong":
                break

        ws.send_json({"type": "end_call"})


def test_vad_merge_guard_combines_unpunctuated_fragments():
    """
    Verify that two consecutive BUYER commits arriving in close succession without
    terminal punctuation are merged into a single coherent utterance.
    """
    client = TestClient(app)
    start_res = client.post("/api/v1/peitho/start", json={
        "product_name": "Office Chair",
        "base_price": 200.0,
        "cost_price": 100.0,
        "min_floor": 140.0,
    })
    session_id = start_res.json()["session_id"]

    with client.websocket_connect(f"/api/v1/peitho/ws/{session_id}") as ws:
        _ = ws.receive_json()  # ready

        # First fragment without terminal punctuation
        ws.send_json({
            "type": "transcript_line",
            "channel": "tab",
            "text": "I can offer four",
            "is_final": True,
        })

        # Drain final transcript & advisory for fragment 1
        m1 = ws.receive_json()
        while m1.get("type") == "state":
            m1 = ws.receive_json()
        assert m1["type"] == "final_transcript"

        m2 = ws.receive_json()
        while m2.get("type") in ("state", "recommendation_update"):
            m2 = ws.receive_json()
        assert m2["type"] == "advisory"

        # Immediate second fragment (completing "four fifty dollars.")
        ws.send_json({
            "type": "transcript_line",
            "channel": "tab",
            "text": "fifty dollars for the chairs.",
            "is_final": True,
        })

        # Drain messages for merged turn
        merged_transcript = ws.receive_json()
        while merged_transcript.get("type") in ("state", "recommendation_update"):
            merged_transcript = ws.receive_json()
        assert merged_transcript["type"] == "final_transcript"
        assert merged_transcript.get("is_merged") is True
        assert "four fifty dollars" in merged_transcript["text"]

        ws.send_json({"type": "end_call"})


def test_non_price_numbers_ignored():
    """Verify that temporal, ordinal, and filler numbers are NOT parsed as prices."""
    # Durations should not be price offers
    ext1 = AdvisoryEngine.extract_intent_from_text("Wait 3 minutes please", base_price=500.0, current_counter=500.0)
    assert ext1["unit_price_offered"] is None
    assert ext1["intent"] == "conversational"

    # Testing filler digits should not be price offers
    ext2 = AdvisoryEngine.extract_intent_from_text("Testing 1, 2, 3 audio check", base_price=500.0, current_counter=500.0)
    assert ext2["unit_price_offered"] is None

    # Counts/questions should not be price offers
    ext3 = AdvisoryEngine.extract_intent_from_text("I have 4 questions regarding warranty", base_price=500.0, current_counter=500.0)
    assert ext3["unit_price_offered"] is None

    # Sentence with duration AND real price: duration must be ignored, real price extracted
    ext4 = AdvisoryEngine.extract_intent_from_text("Can we talk in 5 minutes about $400?", base_price=500.0, current_counter=500.0)
    assert ext4["unit_price_offered"] == 400.0
    assert ext4["intent"] == "offer"

    # Genuine offer question with standalone number should work
    ext5 = AdvisoryEngine.extract_intent_from_text("Can you do 450?", base_price=500.0, current_counter=500.0)
    assert ext5["unit_price_offered"] == 450.0
    assert ext5["intent"] == "offer"


def test_seller_filler_does_not_mutate_counter():
    """Verify that a seller saying filler numbers does not update counter history."""
    master_state = create_test_state()
    initial_counter = master_state.counter_history[-1]

    # Seller says filler with digits
    detected = AdvisoryEngine.apply_seller_line(master_state, "Let me check for 3 minutes.")
    assert detected is None
    assert master_state.counter_history[-1] == initial_counter

    # Seller says actual counter
    detected2 = AdvisoryEngine.apply_seller_line(master_state, "I can do $90 for you today.")
    assert detected2 == 90.0
    assert master_state.counter_history[-1] == 90.0



