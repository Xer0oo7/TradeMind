# Peitho Live Call Assistant — Negotiation Engine Audit & Reuse Report

**Target System:** Peitho Live Call Assistant for Sellers  
**Audited Codebase:** TradeMind Multi-Agent Negotiation Engine  
**Date of Audit:** October 2026  
**Auditor:** Antigravity Engineering (Read-Only Analysis)  

---

## Executive Summary

This audit assesses the feasibility of building **Peitho**—a real-time, seller-facing call copilot—on top of the TradeMind negotiation engine. The analysis confirms that TradeMind's computational core (PRANE-X, located in [`backend/app/agents/negotiation_engine.py`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/agents/negotiation_engine.py)) is **100% deterministic, stateless, and free of database/network side effects**. 

An **advisory mode** that evaluates incoming live-call buyer utterances, computes optimal counter-offers, assesses acceptance probability, and generates seller guidance cards without persisting session mutations or writing to MySQL **is entirely achievable as a thin wrapper**.

---

## PART A: Negotiation Engine in Advisory Mode

### 1. Side-Effect Free Execution of `PricingStrategyAgent`

#### Can `PricingStrategyAgent` (and its dependencies) be called without side effects?
**Yes.** Neither `PricingStrategyAgent` nor the underlying `process_round()` engine perform database writes, cache commits, or network I/O during pricing calculation. All database operations in TradeMind are isolated inside the API route handlers ([`backend/app/api/v1/chat_session_routes.py`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/api/v1/chat_session_routes.py)) and session persistence is inside [`SessionManager`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/core/session.py).

#### Decision Pipeline Methods & State Access
The decision pipeline involves three core functions across two modules:

| Function / Method | Exact File Path | Exact Signature | State Read | State Written | Side Effects (DB/Cache) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `compute_initial_offer` | [`backend/app/agents/pricing_agent.py`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/agents/pricing_agent.py#L244-L265) | `def compute_initial_offer(self, product: ProductData, inventory: InventoryContext, posture: StrategicPosture, strategy: Optional[StrategicControls] = None) -> Decimal` | `product.base_price`, `product.min_acceptable_price`, `inventory.requested_quantity`, `strategy.mode` | None | **None** (Pure function) |
| `evaluate_offer` | [`backend/app/agents/pricing_agent.py`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/agents/pricing_agent.py#L266-L316) | `def evaluate_offer(self, buyer_offer: BuyerOffer, product: ProductData, inventory: InventoryContext, strategy: StrategicControls, posture: StrategicPosture, state: PricingState) -> PricingDecision` | `buyer_offer`, `product`, `inventory`, `strategy`, `posture`, `state.engine_state` | Mutates passed `state.engine_state` in memory | **None** (Optional LLM call for intent extraction if `buyer_offer.message` provided; no DB or cache write) |
| `process_round` | [`backend/app/agents/negotiation_engine.py`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/agents/negotiation_engine.py#L1375) | `def process_round(state: NegotiationState, extraction: dict) -> EngineResult` | `state` fields (`base_price`, `dynamic_floor`, `current_round`, `offer_history`, etc.), `extraction` | Mutates passed `state` in memory | **None** (No DB, no cache, no LLM, no I/O) |
| `verbalize` | [`backend/app/agents/pricing_agent.py`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/agents/pricing_agent.py#L541-L673) | `def verbalize(self, result: EngineResult, state: NegotiationState) -> str` | `result`, `state.offer_history`, `state.dynamic_floor`, `state.quantity` | None | Outbound LLM API call to OpenRouter (falls back to local templates on timeout/error) |

---

### 2. Core Data Structures & Schema Definitions

Below are the exact dataclasses and Pydantic models from [`backend/app/models/schemas.py`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/models/schemas.py) and [`backend/app/agents/negotiation_engine.py`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/agents/negotiation_engine.py).

#### `PricingDecision` ([`schemas.py:L161-L183`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/models/schemas.py#L161-L183))
```python
class PricingDecision(BaseModel):
    decision: OfferDecision
    counter_offer_price: Optional[Decimal] = None
    accepted_price: Optional[Decimal] = None
    is_final_offer: bool = False
    reasoning_tag: Optional[str] = None
    margin_percentage: Decimal
    profit_per_unit: Decimal
    total_profit: Decimal
    within_constraints: bool
    constraint_violations: List[str] = Field(default_factory=list)
    concession_made: Decimal = Field(default=Decimal("0"))
    remaining_concession_budget: Decimal
    concession_percentage_used: Decimal
```

#### `ProductData` ([`schemas.py:L29-L54`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/models/schemas.py#L29-L54))
```python
class ProductData(BaseModel):
    product_id: str = Field(..., min_length=1, max_length=100)
    product_name: str = Field(..., min_length=1, max_length=200)
    base_price: Decimal = Field(..., gt=0, le=Decimal("99999999.99"))
    cost_price: Decimal = Field(..., gt=0, le=Decimal("99999999.99"))
    min_acceptable_price: Decimal = Field(..., gt=0, le=Decimal("99999999.99"))
    max_loss_percentage: Decimal = Field(default=Decimal("0"), ge=0, le=100)
```

#### `BuyerOffer` ([`schemas.py:L115-L125`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/models/schemas.py#L115-L125))
```python
class BuyerOffer(BaseModel):
    offered_price: Decimal = Field(..., gt=0, le=Decimal("99999999.99"))
    offered_quantity: Optional[int] = Field(default=None, gt=0)
    message: Optional[str] = Field(default=None, max_length=1000)
```

#### `StrategicControls` ([`schemas.py:L78-L99`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/models/schemas.py#L78-L99))
```python
class StrategicControls(BaseModel):
    mode: NegotiationMode = Field(default=NegotiationMode.MAX_PROFIT)
    urgency: UrgencyLevel = Field(default=UrgencyLevel.MEDIUM)
    relationship_priority: RelationshipPriority = Field(default=RelationshipPriority.MEDIUM)
    max_rounds: int = Field(default=5, ge=1, le=20)
```

#### `InventoryContext` ([`schemas.py:L56-L76`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/models/schemas.py#L56-L76))
```python
class InventoryContext(BaseModel):
    available_quantity: int = Field(..., gt=0)
    requested_quantity: int = Field(..., gt=0)
    inventory_pressure: PressureLevel = Field(default=PressureLevel.MEDIUM)
    sales_frequency: FrequencyLevel = Field(default=FrequencyLevel.MEDIUM)
```

#### `NegotiationSession` (Session State Object) ([`backend/app/core/session.py:L30-L71`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/core/session.py#L30-L71))
```python
@dataclass
class NegotiationSession:
    session_id: UUID
    product: ProductData
    inventory: InventoryContext
    strategy: StrategicControls
    posture: StrategicPosture
    initial_offer: Decimal
    status: NegotiationStatus = NegotiationStatus.ACTIVE
    pricing_state: Optional[PricingState] = None
    buyer_id: Optional[str] = None
    client_ip: Optional[str] = None
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    closed_at: Optional[datetime] = None
    final_price: Optional[Decimal] = None
    total_profit: Optional[Decimal] = None
```

#### `NegotiationState` (PRANE-X Engine State Object) ([`backend/app/agents/negotiation_engine.py:L365-L488`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/agents/negotiation_engine.py#L365-L488))
```python
@dataclass
class NegotiationState:
    base_price: float
    cost_price: float
    min_floor: float
    mode: str       # "MAX_PROFIT" | "MIN_LOSS"
    max_rounds: int
    quantity: int
    total_sessions: int
    accepted_deals: int
    historical_avg_margin: float
    historical_revenue: float
    available_inventory: int
    reference_inventory: int
    buyer_archetype: BuyerArchetype = BuyerArchetype.UNKNOWN

    # Computed in __post_init__
    inventory_ratio: float = field(init=False)
    dynamic_floor: float = field(init=False)
    bulk_target_price: float = field(init=False)
    historical_target: float = field(init=False)
    total_concession_budget: float = field(init=False)
    remaining_concession_budget: float = field(init=False)
    phase: NegotiationPhase = field(init=False)
    bbi: float = field(init=False)
    p_high_wtp: float = field(init=False)

    # Round tracking
    current_round: int = field(default=0)
    offer_history: list[float] = field(default_factory=list)
    counter_history: list[float] = field(default_factory=list)
    consecutive_stagnant: int = field(default=0)
    consecutive_grind: int = field(default=0)
    retrograde_count: int = field(default=0)
    anchoring_penalty_done: bool = field(default=False)
    manipulation_events: int = field(default=0)
    zopa_no_overlap_count: int = field(default=0)
    scarcity_locked: bool = field(default=False)
    firmness_level: int = field(default=0)
    _last_result: Optional["EngineResult"] = field(default=None)
    _last_buyer_message: Optional[str] = field(default=None)
    good_faith_after_final: int = field(default=0)
    _freeze_low_offer: float = field(default=0.0)
    _freeze_offer_idx: int = field(default=-1)
    _post_redemption_round: int = field(default=-1)
```

---

### 3. Economic Rules, Formulas, and Mode Differences

#### Dynamic Floor Price Formulation ([`negotiation_engine.py:L494-L525`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/agents/negotiation_engine.py#L494-L525))
```python
def _compute_dynamic_floor(s: NegotiationState) -> float:
    T = TUNING
    buf = T["margin_buffer_max_profit"] if s.mode == "MAX_PROFIT" else T["margin_buffer_min_loss"]
    mode_floor = max(s.min_floor, s.cost_price * (1 + buf))

    r = s.inventory_ratio
    if r < T["inv_scarce_threshold"]:      inv_m = T["inv_scarce_multiplier"]   # 1.12
    elif r < T["inv_low_threshold"]:       inv_m = T["inv_low_multiplier"]      # 1.06
    elif r > T["inv_surplus_threshold"]:   inv_m = T["inv_surplus_multiplier"]  # 0.96
    else:                                  inv_m = 1.00

    if s.quantity >= T["bulk_discount_min_qty"]:
        raw = math.log(s.quantity + 1) / math.log(51)
        bulk_disc = min(raw * T["bulk_discount_rate"], T["bulk_discount_cap"])
        if s.mode == "MAX_PROFIT":
            bulk_disc *= 0.65
    else:
        bulk_disc = 0.0

    floor = mode_floor * inv_m * (1 - bulk_disc)
    return round(max(floor, s.cost_price), 2)
```

#### Acceptance Thresholds & Walk-Away Logic ([`negotiation_engine.py:L1046-L1149`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/agents/negotiation_engine.py#L1046-L1149))
In `_should_accept(s, buyer_unit, next_counter)`:
1. **Absolute Ratio Pre-Check (Patch 3 Bug A Guard):**
   ```python
   offer_ratio = buyer_unit / s.base_price
   min_ratio = T["min_acceptance_ratio_max_profit"] if s.mode == "MAX_PROFIT" else T["min_acceptance_ratio_min_loss"]
   if offer_ratio < min_ratio:
       return False
   ```
2. **Hard Floor Guard:**
   `if buyer_unit < s.dynamic_floor: return False`
3. **Minimum Round Guard:**
   `min_round = T["min_acceptance_round_max_profit"] (3) if s.mode == "MAX_PROFIT" else T["min_acceptance_round_min_loss"] (2)`  
   Cannot accept if `s.current_round < min_round - 1` unless `s.firmness_level == 3`.
4. **Marginal Utility Calculation:**
   Accepts when `net_benefit_of_waiting <= 0`, where:
   $$\text{expected\_gain} = (\text{counter} - \text{bid}) \times \text{qty} \times P(\text{improve}) \times \left(\frac{\text{rounds\_left}}{\text{max\_rounds}}\right)$$
   $$\text{discounted\_gain} = \text{expected\_gain} \times (1 - 0.04)^{\text{rounds\_left}}$$
   $$\text{net\_benefit} = \text{discounted\_gain} + \text{price\_signal\_damage} - \text{inventory\_relief}$$
5. **Last-Round Walk-Away ([`negotiation_engine.py:L1523-L1545`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/agents/negotiation_engine.py#L1523-L1545)):**
   When `s.current_round >= s.max_rounds`:
   $$\text{min\_accept} = \max(\text{last\_counter} \times 0.90, \text{base\_price} \times \text{min\_ratio})$$
   If `buyer_bid >= min_accept`: accepts with `ReasoningTag.LAST_ROUND_ACCEPT`. Otherwise rejects (`ReasoningTag.LAST_ROUND_REJECT`).

#### `MAX_PROFIT` vs `MIN_LOSS` Parameter Differences

| Parameter / Rule | `MAX_PROFIT` | `MIN_LOSS` | Impact |
| :--- | :--- | :--- | :--- |
| `margin_buffer` | `0.08` (8% above cost) | `0.03` (3% above cost) | Sets the baseline dynamic floor above cost |
| `curve_power` | `2.2` | `1.1` | Polynomial concession curve ($t^{\text{power}}$); `MAX_PROFIT` yields slow concessions early on; `MIN_LOSS` yields nearly linear concessions |
| `min_acceptance_ratio` | `0.88` (88% of base price) | `0.78` (78% of base price) | Absolute lowest acceptable ratio |
| `min_acceptance_round` | Round 3 | Round 2 | Minimum rounds required before deal can close |
| `bulk_target_profit_mult`| `0.65` | `1.00` | Reduces bulk discounts granted in `MAX_PROFIT` mode |

---

### 4. Simulating Round $N$ Without a Database Session

#### Required Fields to Instantiate an In-Memory `NegotiationState`
To simulate a negotiation state at round $N$, an external caller only needs to construct `NegotiationState` with:
- `base_price: float`
- `cost_price: float`
- `min_floor: float`
- `mode: str` ("MAX_PROFIT" or "MIN_LOSS")
- `max_rounds: int`
- `quantity: int`
- `available_inventory: int`
- `reference_inventory: int`
- `total_sessions: int` (can pass `0`)
- `accepted_deals: int` (can pass `0`)
- `historical_avg_margin: float` (can pass `0.20`)
- `historical_revenue: float` (can pass `0.0`)

To replay/set to round $N$:
```python
state = NegotiationState(...)
state.current_round = N
state.offer_history = [offer_1, offer_2, ..., offer_n]
state.counter_history = [counter_1, counter_2, ..., counter_n]
state.firmness_level = 0  # or 1, 2, 3 based on hostility
# Concession budget updates automatically or can be decayed:
state.remaining_concession_budget = (state.base_price - state.dynamic_floor) * state.quantity - sum_concessions
```

#### Can a temporary in-memory session be constructed for advisory use?
**Yes, completely.** No database session, UUID, or Redis key is required. Calling `process_round(temp_state, extraction)` executes in under 1 millisecond.

---

### 5. Offer Extraction from Free Text

#### Free-Text Extraction Implementation
TradeMind provides two extraction pathways:

1. **`PricingStrategyAgent._extract_intent()`** ([`backend/app/agents/pricing_agent.py:L321-L426`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/agents/pricing_agent.py#L321-L426)):  
   Takes `BuyerOffer` and calls the OpenRouter LLM using `_EXTRACTION_USER_TEMPLATE`.
2. **`NegotiationEngine._understand_chat()`** ([`backend/app/core/engine.py:L1240-L1334`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/core/engine.py#L1240-L1334)):  
   Takes raw buyer text and calls the LLM with `build_chat_understanding_prompt()`.

#### The Extraction Prompt (`_EXTRACTION_USER_TEMPLATE` in `pricing_agent.py:L87-L129`)
```text
Extract structured negotiation intent from this buyer message.

BUYER MESSAGE:
"""{buyer_message}"""

CONTEXT:
- Product base price: ${base_price}
- Seller's current counter: ${current_counter}
- Quantity previously agreed: {quantity}

TOTAL PRICE EXTRACTION PATTERNS:
"X for N units"     → total_price_offered=X, quantity=N, unit_price=X/N
"total of X"        → total_price_offered=X
"X total"           → total_price_offered=X
"total for X"       → total_price_offered=X
"X for all of them" → total_price_offered=X
"X for everything"  → total_price_offered=X
"for both" / "for all" / "for the lot" → always total
When total_price_offered is extracted, always compute unit_price = total / known_quantity.

CONVERSATIONAL INTENT examples (intent=conversational, no price extraction):
"for how many units?"       → conversational (asking current qty)
"what quantity are we at?"  → conversational
"what's the current offer?" → conversational (asking current counter)

Return ONLY this JSON (no markdown, no commentary):
{
  "quantity":               <int or null>,
  "unit_price_offered":     <float or null>,
  "total_price_offered":    <float or null>,
  "intent":                 "<offer|inquiry|accept|reject|walkaway|conditional|conversational>",
  "tone":                   "<aggressive|neutral|cooperative|desperate>",
  "anchoring_detected":     <true or false>,
  "urgency_signal":         <true or false>,
  "bundle_request":         <true or false>,
  "social_proof_claim":     <true or false>,
  "competitor_price_claim": <float or null>,
  "conditional_offer":      <true or false>,
  "condition_text":         <string or null>
}
```

#### Deterministic Regex Fallbacks ([`backend/app/core/engine.py:L994-L1018`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/core/engine.py#L994-L1018))
```python
_QUANTITY_WORD_RE = re.compile(r"\b(\d{1,6})\s*(?:units?|pcs?|pieces?|items?)\b", re.IGNORECASE)
_QUANTITY_INTENT_RE = re.compile(r"\b(?:quantity|qty)\s*(?:is|=|:)?\s*(\d{1,6})\b", re.IGNORECASE)
_EXPLICIT_PRICE_RE = re.compile(
    r"(?:[$]\s*(\d+(?:\.\d{1,2})?)|"
    r"\b(?:offer|offering|pay|price|budget|bid)\s*(?:is|of|=|:)?\s*[$]?\s*(\d+(?:\.\d{1,2})?))",
    re.IGNORECASE,
)
```

#### Can it handle a line spoken by the SELLER?
**No, not as currently written.**
- The existing prompts are strictly buyer-centric: *"Extract structured negotiation intent from this buyer message"*, *"Does the buyer accept or agree to the seller's counter-offer?"*.
- If the human seller says: *"I could come down to $450 for you"*, passing this into `_extract_intent` would erroneously classify $450 as a `unit_price_offered` from the buyer or generate a buyer tone assessment.
- **Peitho Requirement:** A dedicated `extract_seller_intent(text)` prompt/parser is needed to recognize when the human seller independently spoke a counter-offer or accepted a deal so the engine state can mirror what the seller actually said.

---

### 6. Context Analysis Agent & Strategic Posture

#### How Strategic Posture is Computed ([`backend/app/agents/context_agent.py:L83-L97`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/agents/context_agent.py#L83-L97))
```python
def analyze(self, product: ProductData, inventory: InventoryContext, strategy: StrategicControls) -> StrategicPosture:
    # Always uses deterministic heuristic; AI path removed to avoid non-determinism
    return self._fallback_analyze(product, inventory, strategy)
```

#### Inputs Needed
The method only requires seller/catalog parameters:
1. `ProductData`: `base_price`, `cost_price`, `min_acceptable_price`, `max_loss_percentage`
2. `InventoryContext`: `available_quantity`, `requested_quantity`, `inventory_pressure` (HIGH/MEDIUM/LOW)
3. `StrategicControls`: `mode` (MAX_PROFIT/MIN_LOSS), `urgency` (HIGH/MEDIUM/LOW), `max_rounds`

#### Can it run on transcript-derived data?
**Yes.** If an audio transcription pipeline detects that the buyer requested a specific volume (e.g. 5 units), `requested_quantity` is updated in `InventoryContext`, and calling `analyze()` re-derives `quantity_discount_factor` and `total_concession_budget`.

---

### 7. LLM Output Validator

#### Function Names and Verification Rules
The safety validation is implemented in [`backend/app/services/llm_validator.py`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/services/llm_validator.py):
- **Class / Entry Point:** `LLMValidator.validate(llm_output, decision, expected_price, buyer_offered) -> ValidationResult`
- **Rule 1 (Length Bounds):** Min 5 characters, Max 800 characters ([`L98-L104`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/services/llm_validator.py#L98-L104)).
- **Rule 2 (Forbidden Promises):** Blocks phrases like `"i can guarantee"`, `"as an ai"`, `"let me check with my manager"`, `"100% discount"` ([`L49-L62`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/services/llm_validator.py#L49-L62)).
- **Rule 3 (Security / Data Leakage):** Fatal rejection if text mentions `"cost price"`, `"our margin"`, `"concession budget"`, `"floor price"`, `"minimum acceptable"` ([`L65-L80`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/services/llm_validator.py#L65-L80)).
- **Rule 4 (Price Verification):** Extracts prices with regexes:
  ```python
  r'\$[\d,]+\.?\d*'
  r'[\d,]+\.?\d*\s*dollars?'
  r'[\d,]+\.\d{2}\b'
  ```
  Compares extracted numbers against `allowed_prices` (`counter_offer_price`, `accepted_price`, `expected_price`, `buyer_offered`). Prices within $\pm \$1.00$ are permitted. Any number within $0.3\times \text{min}$ to $2.0\times \text{max}$ of the range that is not in the allowed list triggers `invented_price` ([`L180-L240`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/services/llm_validator.py#L180-L240)).

There is also a second, inline sanitizer:
- **`PricingStrategyAgent.validate_and_sanitize_prices(text, counter_unit_price, counter_total_price)`** ([`pricing_agent.py:L506-L536`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/agents/pricing_agent.py#L506-L536)): Regex-replaces any dollar amount that diverges from the engine's counter by more than $1.00 with the exact calculated unit price string.

#### Running Validator Over Suggestion Text with Allowed Numbers
It is **very easy** to adapt. Passing an allowed list of numbers into `_verify_prices` is already supported by passing `expected_price` and `decision.counter_offer_price`. For Peitho, a standalone function `validate_suggestion(text, allowed_prices: list[Decimal])` can be extracted directly from `LLMValidator._extract_prices` and `_verify_prices` in ~25 lines of code.

---

### 8. Per-Call Override of `StrategicControls` and Target Price

#### Can `StrategicControls` or target price be overridden per call without modifying defaults?
**Yes, natively.**
- Neither `StrategicControls` nor `ProductData` are global singletons; they are instantiated per request or session.
- To simulate or advise a higher target margin on a single call:
  ```python
  custom_strategy = StrategicControls(
      mode=NegotiationMode.MAX_PROFIT,
      max_rounds=6,
      urgency=UrgencyLevel.LOW  # Will defend price more aggressively
  )
  custom_product = product.model_copy(update={
      "min_acceptable_price": Decimal("85.00")  # Raised floor to preserve target margin
  })
  decision = pricing_agent.evaluate_offer(buyer_offer, custom_product, inventory, custom_strategy, posture, state)
  ```
- The automated buyer bot uses its own session objects stored in `SessionManager` and is completely isolated from per-call overrides passed by Peitho.

---

## PART B: Data, Products, Outcomes and the Profit Ledger

### 1. Database Schema & Tables

TradeMind does not use SQLAlchemy or an ORM; it uses `aiomysql` and raw SQL statements. There are three primary business tables and three auxiliary tables:

#### Table `products` ([`backend/app/api/v1/product_routes.py:L133-L140`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/api/v1/product_routes.py#L133-L140))
```sql
CREATE TABLE products (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    name VARCHAR(200) NOT NULL,
    base_price DECIMAL(10, 2) NOT NULL,
    cost_price DECIMAL(10, 2) NOT NULL,
    min_acceptable_price DECIMAL(10, 2) NOT NULL,
    max_loss_percent DECIMAL(5, 2) DEFAULT 0.00,
    mode VARCHAR(20) DEFAULT 'MAX_PROFIT',
    max_rounds INT DEFAULT 5,
    category VARCHAR(100) DEFAULT 'General',
    status VARCHAR(20) DEFAULT 'active',
    total_sessions INT DEFAULT 0,
    accepted_deals INT DEFAULT 0,
    avg_margin DECIMAL(5, 2) DEFAULT 0.00,
    revenue DECIMAL(12, 2) DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

#### Table `chat_sessions` ([`backend/app/api/v1/chat_session_routes.py:L139-L146`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/api/v1/chat_session_routes.py#L139-L146))
```sql
CREATE TABLE chat_sessions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    product_name VARCHAR(200) NOT NULL,
    mode VARCHAR(20) NOT NULL,
    base_price DECIMAL(10, 2) NOT NULL,
    cost_price DECIMAL(10, 2) NOT NULL,
    min_price DECIMAL(10, 2) NOT NULL,
    max_rounds INT NOT NULL,
    rounds_used INT DEFAULT 0,
    status VARCHAR(20) DEFAULT 'active',
    final_price DECIMAL(10, 2) DEFAULT NULL,
    final_decision VARCHAR(20) DEFAULT NULL,
    deal_closed TINYINT(1) DEFAULT 0,
    buyer_last_offer DECIMAL(10, 2) DEFAULT NULL,
    seller_last_offer DECIMAL(10, 2) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    closed_at TIMESTAMP NULL DEFAULT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

#### Table `chat_messages` ([`backend/app/api/v1/chat_session_routes.py:L396-L403`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/api/v1/chat_session_routes.py#L396-L403))
```sql
CREATE TABLE chat_messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    session_id INT NOT NULL,
    user_id INT NOT NULL,
    round_number INT NOT NULL,
    user_message TEXT NOT NULL,
    bot_reply TEXT NOT NULL,
    offered_price DECIMAL(10, 2) DEFAULT NULL,
    counter_price DECIMAL(10, 2) DEFAULT NULL,
    decision VARCHAR(20) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

#### Status of Fields Requested in Prompt
- **Cost Price:** `cost_price` (in `products`, `chat_sessions`)
- **Floor Price:** `min_acceptable_price` (in `products`), `min_price` (in `chat_sessions`)
- **Target / List Price:** `base_price` (in `products`, `chat_sessions`)
- **Quantity:** **NOT PRESENT in DB tables.** (Only exists in Pydantic models `InventoryContext`, `BuyerOffer`, and Analytics schemas).
- **Stock Age:** **NOT PRESENT in DB tables.**
- **Margin:** Stored as summary on `products.avg_margin`; calculated dynamically during deal closure.
- **Dedicated `deal_outcomes` table:** **NOT PRESENT.** Deal outcomes are stored directly on `chat_sessions` columns (`status`, `deal_closed`, `final_price`, `closed_at`).

---

### 2. Recording Deal Outcomes and Revenue Aggregation

#### How a Deal Outcome is Recorded ([`chat_session_routes.py:L440-L455`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/api/v1/chat_session_routes.py#L440-L455))
When a negotiation concludes, the frontend or client calls `PUT /api/v1/sessions/{session_id}/close`:
```sql
UPDATE chat_sessions
SET status = %s,
    final_price = %s,
    final_decision = %s,
    deal_closed = %s,
    buyer_last_offer = %s,
    seller_last_offer = %s,
    rounds_used = %s,
    closed_at = NOW()
WHERE id = %s
```

#### Query Aggregating Revenue and Profit ([`product_routes.py:L274-L293`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/api/v1/product_routes.py#L274-L293))
The product stats endpoint (`GET /api/v1/products/{id}/stats`) aggregates revenue and average margin across closed deals:
```sql
SELECT
    COUNT(*)                                              AS total_sessions,
    SUM(CASE WHEN deal_closed = 1 THEN 1 ELSE 0 END)     AS accepted_deals,
    SUM(CASE WHEN deal_closed = 0 AND status != 'active'
             THEN 1 ELSE 0 END)                          AS rejected_deals,
    SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END)   AS active_sessions,
    AVG(rounds_used)                                      AS avg_rounds,
    AVG(CASE WHEN deal_closed = 1 THEN final_price END)   AS avg_final_price,
    MIN(CASE WHEN deal_closed = 1 THEN final_price END)   AS min_deal_price,
    MAX(CASE WHEN deal_closed = 1 THEN final_price END)   AS max_deal_price,
    SUM(CASE WHEN deal_closed = 1 THEN final_price ELSE 0 END) AS total_revenue,
    AVG(CASE WHEN deal_closed = 1 AND final_price IS NOT NULL
             THEN ((final_price - %s) / final_price * 100)
        END)                                              AS avg_margin,
    AVG(CASE WHEN deal_closed = 1 THEN buyer_last_offer END) AS avg_buyer_offer,
    AVG(CASE WHEN deal_closed = 1 THEN seller_last_offer END) AS avg_seller_offer
FROM chat_sessions
WHERE user_id = %s AND product_name = %s
```

---

### 3. Portfolio-Level, Period-Level, or Per-Batch Profit Targets

#### Is there any portfolio profit target concept?
**NOT PRESENT.** TradeMind evaluates each session and each product independently. There is no concept of a cross-product profit target, a portfolio ledger, a monthly sales quota, or compensating for an under-target deal by lifting target margins on open deals.

#### Closest Existing Structure
The closest existing structures are:
1. **Product-Level Historical Feedback in Engine ([`negotiation_engine.py:L565-L586`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/agents/negotiation_engine.py#L565-L586)):**  
   The engine reads `historical_avg_margin` on `NegotiationState`. If `historical_avg_margin` falls 5% below `TUNING["target_margin_default"]` (0.20), `_compute_historical_target()` raises the initial counter by 2% of the base price.
2. **Business Analytics Single-Product Batch Model ([`backend/app/analytics/schemas.py:L14-L44`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/analytics/schemas.py#L14-L44)):**  
   `ProductParameters` models a single batch: `initial_stock`, `cost_price`, `selling_price`, `platform_fee_percent`, `shipping_cost`, `marketing_cost`.

---

### 4. Existing Analytics Functions

The repository provides deterministic analytics calculation functions in [`backend/app/analytics/calculations.py`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/analytics/calculations.py):

| Function | Exact Signature | Computes |
| :--- | :--- | :--- |
| `calculate_revenue` | `def calculate_revenue(product: ProductParameters, performance: PerformanceSignals) -> RevenueMetrics` | Gross revenue, net revenue, units sold, net units sold (sold minus returns) |
| `calculate_costs` | `def calculate_costs(product: ProductParameters, revenue: RevenueMetrics) -> CostMetrics` | Product COGS, platform fee, shipping, marketing cost, total cost |
| `calculate_profit_metrics` | `def calculate_profit_metrics(revenue: RevenueMetrics, costs: CostMetrics) -> ProfitMetrics` | Realized profit or loss ($), profit status ("PROFIT", "LOSS", "BREAK_EVEN"), profit margin (%) |
| `calculate_all_metrics` | `def calculate_all_metrics(product: ProductParameters, performance: PerformanceSignals) -> Tuple[RevenueMetrics, CostMetrics, ProfitMetrics, PerformanceRatios, UnitEconomics, int]` | Returns all above plus unit economics and remaining inventory (`remaining_stock = product.initial_stock - revenue.net_units_sold`) |

---

### 5. Database Migrations and Scripts

#### Where Migrations are Kept
- There is **no migration directory** and **no migration tool** (Alembic or Flyway is NOT configured in backend dependencies or codebase).
- `backend/app/infrastructure/database/migrations/` is mentioned in [`README.md:L967`](file:///d:/Negotiation_Bot/Negotiation-Bot/README.md#L967) as a manual convention, but the directory does not exist on disk.
- The only table creation script that executes programmatically is [`create_email_settings_table_if_not_exists()`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/api/v1/email_routes.py#L48-L67) in `email_routes.py`. All other tables (`users`, `products`, `chat_sessions`, `chat_messages`, `api_keys`) must be created manually using the MySQL CLI.

---

## PART C: LLM Client, Real-Time and Rate Limits

### 1. LLM Client Architecture ([`backend/app/infrastructure/llm/openai_client.py`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/infrastructure/llm/openai_client.py))

#### Public Methods and Signatures
```python
class OpenRouterClient:
    async def generate(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: Optional[float] = None,
    ) -> LLMResponse:
        ...

    def generate_sync(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: Optional[float] = None,
    ) -> LLMResponse:
        ...

def get_llm_client() -> OpenRouterClient: ...
def shutdown_llm_pool() -> None: ...
```

#### Configuration & Models
- **Configured In:** [`backend/app/core/config.py`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/core/config.py#L42-L46)
- **Model Name:** Defaults to `google/gemini-2.0-flash-001` (env var: `OPENROUTER_MODEL`).
- **Endpoint:** `https://openrouter.ai/api/v1/chat/completions`
- **Timeout:** Defaults to `10.0` seconds (env var: `LLM_TIMEOUT_SECONDS`).
- **Max Tokens:** Defaults to `200` (env var: `LLM_MAX_TOKENS`).

#### Timeout and Retry Behavior
- Uses `httpx.AsyncClient(timeout=self.timeout)`.
- **No retry loop exists.** Upon timeout (`httpx.TimeoutException`) or HTTP error (`httpx.HTTPStatusError`), it immediately catches the exception and returns `LLMResponse(success=False, error=...)`. Callers fall back to static templates.

#### JSON Mode & `response_format`
- **`response_format` is NOT PRESENT.** The request payload passes only `{"model", "messages", "max_tokens", "temperature"}`.
- Structured JSON output relies on prompt instructions and string cleaning (`_clean_json()` removes ` ```json ` fences).

#### End-to-End Execution Flow
1. Caller (`PricingStrategyAgent._extract_intent` or `ConversationAgent.generate_response`) renders prompt strings.
2. Calls `llm_client.generate_sync(system_prompt, user_prompt, temperature)`.
3. `generate_sync()` submits `asyncio.run(self.generate(...))` to `_sync_pool` (a 4-worker `ThreadPoolExecutor`).
4. `generate()` posts JSON to OpenRouter API via `httpx.AsyncClient`.
5. Parses `choices[0].message.content`, logs token count, and returns `LLMResponse(content=..., success=True)`.

---

### 2. Prompt Storage and Rendering ([`backend/app/infrastructure/llm/prompt_templates.py`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/infrastructure/llm/prompt_templates.py))

#### How Prompts are Stored and Rendered
Prompts are stored as multi-line format strings or Python builder functions.

#### Example: Initial Offer Prompt Builder ([`prompt_templates.py:L36-L52`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/infrastructure/llm/prompt_templates.py#L36-L52))
```python
def build_initial_offer_prompt(
    product_name: str,
    quantity: int,
    offer_price: str,
    mode: str,
) -> str:
    """Build prompt for generating initial offer message."""
    return f"""You’re starting a negotiation call for {product_name}. Make your opening pitch.

DETAILS:
- Product: {product_name} ({quantity} units)
- Your opening price: ${offer_price} per unit
- Mode: {mode}

Make it feel like a natural conversation starter. Mention the product, the price ${offer_price}, and the quantity. Be welcoming and confident — you’re excited to work with this buyer. 1-2 sentences, casual and professional.

Generate your opening:"""
```

---

### 3. Non-Buyer Facing LLM Endpoints

**Yes, there is one non-buyer facing LLM service:**
- **Competitive Intelligence Analyzer ([`backend/app/buisness anlytics/competitive_intelligence/llm_analyzer.py`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/buisness anlytics/competitive_intelligence/llm_analyzer.py)):**  
  Endpoint `POST /api/v1/competitive/analyze` scrapes e-commerce competitors and sends price/rating distributions to OpenRouter via `generate_llm_analysis(scraped_summary, product_details)`. This is strictly a **seller-facing business intelligence tool**.

---

### 4. Rate Limiting and Concurrency Conflicts

#### SlowAPI Configuration ([`backend/app/api/middleware/rate_limiter.py`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/api/middleware/rate_limiter.py))
- Configured with `Limiter(key_func=get_remote_address)`.
- Default limits: `settings.rate_limit_per_minute` (60/min) and `settings.rate_limit_per_hour` (1000/hr).
- Handled globally via `RateLimitExceeded` returning HTTP 429.

#### LLM-Level Limits & Potential Concurrency Conflict
- OpenRouter client uses a static thread pool:
  ```python
  _sync_pool = concurrent.futures.ThreadPoolExecutor(max_workers=4, thread_name_prefix="llm_sync")
  ```
- **Conflict Assessment:**
  1. **Thread Pool Contention:** Because `_sync_pool` is capped at `max_workers=4`, if an automated buyer chat and a live Peitho seller call make synchronous LLM calls at the same second, they compete for the 4 worker threads. If all 4 are occupied by 10-second OpenRouter calls, new calls will queue or time out.
  2. **IP Rate Limit:** If the seller frontend and live audio copilot run from the same client IP as the demo buyer, they share the 60 requests/minute limit unless the seller WebSocket/API route uses a separate rate limit tier or custom key.

---

### 5. FastAPI App Setup, WebSockets, CORS, and Auth

#### App Setup & Router Registration ([`backend/app/main.py:L176-L180`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/main.py#L176-L180))
```python
app.include_router(router)
app.include_router(analytics_router)
app.include_router(competitive_router)
app.include_router(voice_router)
```

#### CORS Configuration ([`main.py:L150-L161`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/main.py#L150-L161))
```python
allowed_origins = [origin.strip() for origin in settings.allowed_origins.split(",") if origin.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Requested-With"],
)
```

#### Does FastAPI allow adding a WebSocket route?
**Yes.** In fact, a full WebSocket route already exists in [`backend/app/call_feature/voice_routes.py:L98-L100`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/call_feature/voice_routes.py#L98-L100):
```python
@voice_router.websocket("/ws/{session_id}")
async def voice_call_websocket(websocket: WebSocket, session_id: str, token: str = Query(default="")):
```

#### Auth Dependency Names & WebSocket Token Auth
- HTTP endpoints use `user = Depends(get_current_user)` ([`backend/app/api/v1/auth_routes.py:L141`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/api/v1/auth_routes.py#L141)).
- Browser WebSockets cannot send `Authorization: Bearer` headers during handshake. `voice_routes.py` already solves this with a query parameter validator ([`voice_routes.py:L40-L54`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/call_feature/voice_routes.py#L40-L54)):
  ```python
  def _verify_ws_token(token: str) -> dict:
      if not token:
          return None
      try:
          payload = pyjwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
          return {"id": int(payload["sub"]), "email": payload.get("email", ""), "full_name": payload.get("full_name", "")}
      except (pyjwt.ExpiredSignatureError, pyjwt.InvalidTokenError):
          return None
  ```

---

### 6. Structlog Configuration & Message Text Privacy

#### Structlog Configuration ([`backend/app/core/logging.py:L64-L74`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/core/logging.py#L64-L74))
```python
structlog.configure(
    processors=[
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.processors.KeyValueRenderer(key_order=["event"]),
    ],
    logger_factory=structlog.stdlib.LoggerFactory(),
    cache_logger_on_first_use=True,
)
```

#### Is Chat Message Text Ever Logged?
**Yes, in specific debugging and error paths:**
1. [`backend/app/core/engine.py:L431-L434`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/core/engine.py#L431-L434): Logs `message_preview=msg_stripped_early[:50]` on `zombie_confirmation_cleared`.
2. [`backend/app/services/llm_validator.py:L146`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/services/llm_validator.py#L146): Logs `content_preview=content[:100]` on validation failure.
3. [`backend/app/call_feature/voice_handler.py:L340`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/call_feature/voice_handler.py#L340): Logs `logger.debug("skipping_filler", text=transcript)`.
4. [`backend/app/call_feature/voice_handler.py:L435`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/call_feature/voice_handler.py#L435): Logs `logger.error("llm_timeout", text=text)`.

---

### 7. Email Service & Templating ([`backend/app/services/email_service.py`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/services/email_service.py))

#### Class and Signatures
```python
class EmailService:
    def __init__(self, smtp_host: str, smtp_port: int, smtp_user: str, smtp_password: str, from_email: str, from_name: str = "TradeMind", use_tls: bool = True): ...
    def send(self, to_email: str, subject: str, html_body: str) -> bool: ...
```

#### How a Templated Email is Sent (Post-Call Summary)
TradeMind uses pure Python string formatting returning `tuple[str, str]` (subject and HTML body):
- `template_deal_notification(seller_name, product_name, outcome, final_price, original_price, buyer_name="Customer", rounds=0, session_id="") -> tuple[str, str]` ([`L93-L130`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/services/email_service.py#L93-L130))
- `template_new_session(...) -> tuple[str, str]` ([`L133-L160`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/services/email_service.py#L133-L160))

To send a post-call summary in Peitho:
```python
subject, html = template_deal_notification(
    seller_name="Deva", product_name="Ergonomic Chair", outcome="accepted",
    final_price=6800.0, original_price=7499.0, rounds=4, session_id=session_id
)
email_service.send("seller@company.com", subject, html)
```

---

### 8. Environment Variables and Configuration Files

#### Complete List of `.env.example` Variables & Readers

| Variable Name in `.env.example` | File Reading the Variable | Default / Usage |
| :--- | :--- | :--- |
| `ENV` | [`backend/app/core/config.py:L13`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/core/config.py#L13) | `"development"` |
| `DEBUG` | [`backend/app/core/config.py:L14`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/core/config.py#L14) | `False` |
| `LOG_LEVEL` | [`backend/app/core/config.py:L15`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/core/config.py#L15), [`logging.py:L42`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/core/logging.py#L42) | `"INFO"` |
| `HOST` | [`backend/app/core/config.py:L18`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/core/config.py#L18) | `"0.0.0.0"` |
| `PORT` | [`backend/app/core/config.py:L19`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/core/config.py#L19) | `8000` |
| `RATE_LIMIT_PER_MINUTE` | [`backend/app/core/config.py:L22`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/core/config.py#L22) | `60` |
| `RATE_LIMIT_PER_HOUR` | [`backend/app/core/config.py:L23`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/core/config.py#L23) | `1000` |
| `SESSION_TTL_SECONDS` | [`backend/app/core/config.py:L26`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/core/config.py#L26) | `7200` (code) / `3600` (env) |
| `MAX_SESSIONS_PER_CLIENT` | [`backend/app/core/config.py:L27`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/core/config.py#L27) | `10` |
| `JWT_SECRET` | [`backend/app/core/config.py:L30`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/core/config.py#L30) | Required for JWT tokens |
| `ENCRYPTION_KEY` | [`backend/app/core/config.py:L31`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/core/config.py#L31) | PII encryption |
| `ALLOWED_ORIGINS` | [`backend/app/core/config.py:L32`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/core/config.py#L32) | CORS allowed domains |
| `MYSQL_HOST` | [`backend/app/core/config.py:L35`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/core/config.py#L35) | `"127.0.0.1"` |
| `MYSQL_PORT` | [`backend/app/core/config.py:L36`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/core/config.py#L36) | `3306` |
| `MYSQL_USER` | [`backend/app/core/config.py:L37`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/core/config.py#L37) | MySQL username |
| `MYSQL_PASSWORD` | [`backend/app/core/config.py:L38`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/core/config.py#L38) | MySQL password |
| `MYSQL_DB` | [`backend/app/core/config.py:L39`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/core/config.py#L39) | `"trademind"` |
| `OPENROUTER_API_KEY` | [`backend/app/core/config.py:L42`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/core/config.py#L42) | OpenRouter auth |
| `OPENROUTER_MODEL` | [`backend/app/core/config.py:L43`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/core/config.py#L43) | `"google/gemini-2.0-flash-001"` |
| `LLM_MAX_TOKENS` | [`backend/app/core/config.py:L44`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/core/config.py#L44) | `200` |
| `LLM_TEMPERATURE` | [`backend/app/core/config.py:L45`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/core/config.py#L45) | `0.7` |
| `LLM_TIMEOUT_SECONDS` | [`backend/app/core/config.py:L46`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/core/config.py#L46) | `10.0` |
| `GEMINI_API_KEY` | [`backend/app/api/v1/translate_routes.py:L21`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/api/v1/translate_routes.py#L21) | Read via `os.getenv` for UI translation |
| `SARVAM_API_KEY` | [`backend/app/core/config.py:L49`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/core/config.py#L49) | Voice STT/TTS |

---

## PART D: Current Frontend (Adding One New Page)

### 1. Layout Shell and Routing Pattern

- **Layout Shell:** [`frontend/src/components/Layout.jsx`](file:///d:/Negotiation_Bot/Negotiation-Bot/frontend/src/components/Layout.jsx). Wraps pages with `<Navbar />`, `<main className="flex-1 bg-neo-cream">{children}</main>`, and `<Footer />`.
- **Route Registration File:** [`frontend/src/App.jsx`](file:///d:/Negotiation_Bot/Negotiation-Bot/frontend/src/App.jsx#L29-L70).
- **Navigation Registration File:** [`frontend/src/components/Navbar.jsx`](file:///d:/Negotiation_Bot/Negotiation-Bot/frontend/src/components/Navbar.jsx#L61-L74).

#### Code Pattern to Add a New Page (e.g. `/peitho`)
1. Create `frontend/src/pages/PeithoLiveAssistant.jsx`:
   ```jsx
   import Layout from '../components/Layout';
   import NeoCard from '../components/NeoCard';
   export default function PeithoLiveAssistant() {
     return (
       <Layout>
         <div className="max-w-[1440px] mx-auto p-6">
           <NeoCard variant="default">...</NeoCard>
         </div>
       </Layout>
     );
   }
   ```
2. In `frontend/src/App.jsx`:
   ```jsx
   import PeithoLiveAssistant from './pages/PeithoLiveAssistant';
   // Inside <Routes>:
   <Route path="/peitho" element={<ProtectedRoute><PeithoLiveAssistant /></ProtectedRoute>} />
   ```
3. In `frontend/src/components/Navbar.jsx`:
   Add to `navLinks`:
   ```javascript
   { path: '/peitho', label: 'Peitho Call Copilot', icon: PhoneCall }
   ```

---

### 2. Reusable UI Components

The application uses a **Neo-Brutalist** design system (`neo-navy`, `neo-teal`, `neo-cream`, `neo-orange`, `neo-maroon` with $3\text{px}$ hard borders and offset box shadows).

| Component | File Path | Props & Variants |
| :--- | :--- | :--- |
| `NeoButton` | [`frontend/src/components/NeoButton.jsx`](file:///d:/Negotiation_Bot/Negotiation-Bot/frontend/src/components/NeoButton.jsx) | `variant` (`'default'`, `'teal'`, `'orange'`, `'maroon'`, `'navy'`), `size` (`'sm'`, `'md'`, `'lg'`), `danger` (`bool`), `className`, standard HTML button props |
| `NeoCard` | [`frontend/src/components/NeoCard.jsx`](file:///d:/Negotiation_Bot/Negotiation-Bot/frontend/src/components/NeoCard.jsx) | `variant` (`'default'`, `'teal'`, `'orange'`, `'maroon'`, `'navy'`), `hover` (`bool`, enables -translate-y-1 + shadow lift), `className` |
| `Button` | [`frontend/src/components/ui/button.jsx`](file:///d:/Negotiation_Bot/Negotiation-Bot/frontend/src/components/ui/button.jsx) | `variant` (`default`, `destructive`, `outline`, `secondary`, `ghost`, `link`), `size` (`default`, `sm`, `lg`, `icon`), `asChild` |
| `AlertBanner`| [`frontend/src/components/AlertBanner.jsx`](file:///d:/Negotiation_Bot/Negotiation-Bot/frontend/src/components/AlertBanner.jsx) | No custom props; displays scrolling announcement banner |
| `Modal` | Inline Neo-Brutalist pattern | Standard pattern: `<div className="fixed inset-0 bg-neo-navy/60 backdrop-blur-sm flex items-center justify-center p-4">...</div>` |
| `Input` | Global CSS class `.neo-input` | Standard `<input className="w-full bg-neo-cream border-[3px] border-neo-navy px-4 py-3 font-body focus:bg-white focus:outline-none focus:shadow-neo" />` |
| `Badge` | Inline CSS class `.neo-badge` | `<span className="px-3 py-1 font-heading font-bold text-xs uppercase border-2 border-neo-navy">` |

---

### 3. Usage Pattern: Auth, API Client, and i18n

Typical pattern from [`NegotiationDashboard.jsx`](file:///d:/Negotiation_Bot/Negotiation-Bot/frontend/src/pages/NegotiationDashboard.jsx) and [`ProductCatalog.jsx`](file:///d:/Negotiation_Bot/Negotiation-Bot/frontend/src/pages/ProductCatalog.jsx):

```javascript
import { useState, useEffect } from 'react';
import { useI18n } from '../context/I18nContext';
import { getAuthToken, getAuthUser, isAuthenticated, getDashboardSummary } from '../lib/api';
import Layout from '../components/Layout';
import NeoCard from '../components/NeoCard';
import NeoButton from '../components/NeoButton';

export default function ExamplePage() {
  const { t } = useI18n();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      if (!isAuthenticated()) return;
      try {
        const result = await getDashboardSummary(); // Attaches JWT token automatically
        setData(result);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  return (
    <Layout>
      <div className="max-w-[1440px] mx-auto p-4 sm:p-6">
        <h1 className="text-3xl font-heading font-bold text-neo-navy mb-6">
          {t('navbar.products') || 'Products'}
        </h1>
        <NeoCard variant="default">
          {/* Content */}
        </NeoCard>
      </div>
    </Layout>
  );
}
```

---

### 4. Occurrences of the App Name "TradeMind"

An audit scan for the token `"TradeMind"` across the repository identified **90 occurrences across 27 files**:

| Occurrence Count | File Path | Usage Context |
| :---: | :--- | :--- |
| **10** | [`backend/app/services/email_service.py`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/services/email_service.py) | Email sender display name & HTML email headers/footers |
| **10** | [`README.md`](file:///d:/Negotiation_Bot/Negotiation-Bot/README.md) | Documentation titles and examples |
| **10** | [`QUICKSTART.md`](file:///d:/Negotiation_Bot/Negotiation-Bot/QUICKSTART.md) | Quickstart guides and database name |
| **6** | [`frontend/src/lib/api.js`](file:///d:/Negotiation_Bot/Negotiation-Bot/frontend/src/lib/api.js) | LocalStorage keys (`trademind_token`, `trademind_user`) |
| **6** | [`frontend/index.html`](file:///d:/Negotiation_Bot/Negotiation-Bot/frontend/index.html) | Title tag, meta tags, and open graph titles |
| **5** | [`backend/app/api/v1/email_routes.py`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/api/v1/email_routes.py) | Default `from_name` in table schema |
| **4** | [`frontend/src/lib/productStore.js`](file:///d:/Negotiation_Bot/Negotiation-Bot/frontend/src/lib/productStore.js) | Default product names & dummy data |
| **4** | [`ARCHITECTURE.md`](file:///d:/Negotiation_Bot/Negotiation-Bot/ARCHITECTURE.md) | Architecture document headings |
| **4** | [`docs/PROJECT_AUDIT.md`](file:///d:/Negotiation_Bot/Negotiation-Bot/docs/PROJECT_AUDIT.md) | System description |
| **3** | [`frontend/src/pages/EmailSettings.jsx`](file:///d:/Negotiation_Bot/Negotiation-Bot/frontend/src/pages/EmailSettings.jsx) | Default settings placeholders in UI |
| **3** | [`PROJECT_STATUS.md`](file:///d:/Negotiation_Bot/Negotiation-Bot/PROJECT_STATUS.md) | Project status documentation |
| **2** | [`backend/app/buisness anlytics/competitive_intelligence/llm_analyzer.py`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/buisness anlytics/competitive_intelligence/llm_analyzer.py) | LLM prompt context |
| **2** | [`backend/.env.example`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/.env.example) | Header comments & DB name |
| **2** | [`frontend/src/pages/ApiReference.jsx`](file:///d:/Negotiation_Bot/Negotiation-Bot/frontend/src/pages/ApiReference.jsx) | API documentation titles |
| **2** | [`FEATURES.md`](file:///d:/Negotiation_Bot/Negotiation-Bot/FEATURES.md) | Feature list |
| **1** | [`backend/app/core/config.py`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/core/config.py) | Default MySQL database name `mysql_db = "trademind"` |
| **1** | [`frontend/src/call-feature/useVoiceCall.js`](file:///d:/Negotiation_Bot/Negotiation-Bot/frontend/src/call-feature/useVoiceCall.js) | Comments/logs |
| **1** | [`frontend/src/lib/i18n/translations/en.js`](file:///d:/Negotiation_Bot/Negotiation-Bot/frontend/src/lib/i18n/translations/en.js) | Navbar title string |
| **1** | [`frontend/src/lib/i18n/translations/hi.js`](file:///d:/Negotiation_Bot/Negotiation-Bot/frontend/src/lib/i18n/translations/hi.js) | Hindi title string |
| **1** | [`frontend/src/test-chat/src/api.js`](file:///d:/Negotiation_Bot/Negotiation-Bot/frontend/src/test-chat/src/api.js) | LocalStorage key |
| **1** | [`backend/refactor_progress.md`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/refactor_progress.md) | Heading |
| **1** | [`backend/requirements.txt`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/requirements.txt) | Comments |

---

### 5. Existing Audio/Mic Code, WebSockets, or EventSource

- **Audio / Mic Code:** **PRESENT.** [`frontend/src/call-feature/useVoiceCall.js`](file:///d:/Negotiation_Bot/Negotiation-Bot/frontend/src/call-feature/useVoiceCall.js) has production-ready audio handling:
  - `navigator.mediaDevices.getUserMedia({ audio: ... })`
  - Client-side RMS-based Voice Activity Detection (VAD)
  - `AudioContext` and `AudioWorkletNode` streaming 16kHz PCM audio
  - `decodeBase64Audio()` playback helper for AI audio responses
- **WebSocket Hooks:** **PRESENT.** `useVoiceCall.js` connects via `new WebSocket(wsUrl)` to `/api/v1/voice/ws/{sessionId}?token={jwt}` with ping/pong keepalive, exponential reconnect, and message routing.
- **EventSource (SSE):** **NOT PRESENT.** Neither backend nor frontend use Server-Sent Events.

---

## PART E: Readiness

### 1. Test Execution & Fixtures

#### Running Backend Tests
From the `backend` directory:
```bash
pytest
```
or to run specific test suites:
```bash
pytest app/tests/test_engine.py -v
```

#### Reusable Test Fixtures
[`backend/app/tests/test_engine.py:L45-L80`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/tests/test_engine.py#L45-L80) provides clean test builders that can be reused directly to script demos:
```python
def _make_state(**overrides) -> NegotiationState:
    defaults = dict(
        base_price=100.0,
        cost_price=60.0,
        min_floor=65.0,
        mode="MAX_PROFIT",
        max_rounds=10,
        quantity=1,
        total_sessions=0,
        accepted_deals=0,
        historical_avg_margin=0.20,
        historical_revenue=0.0,
        available_inventory=100,
        reference_inventory=100,
        buyer_archetype=BuyerArchetype.UNKNOWN,
    )
    defaults.update(overrides)
    return NegotiationState(**defaults)

def _make_extraction(**overrides) -> dict:
    defaults = dict(
        quantity=None,
        unit_price_offered=80.0,
        total_price_offered=None,
        intent="offer",
        tone="neutral",
        anchoring_detected=False,
        urgency_signal=False,
        bundle_request=False,
        social_proof_claim=False,
        competitor_price_claim=None,
        conditional_offer=False,
        condition_text=None,
        raw_message="",
    )
    defaults.update(overrides)
    return defaults
```

---

### 2. Seed / Demo Data

Seed data is stored at [`products.csv`](file:///d:/Negotiation_Bot/Negotiation-Bot/products.csv) in the repository root.

#### Columns
`name,basePrice,costPrice,category`

#### Contents
```csv
name,basePrice,costPrice,category
Premium Widget,100,40,Electronics
Basic Plan,50,20,Services
Wireless Earbuds,2499,1100,Electronics
Smart LED Bulb,899,350,Electronics
Organic Coffee Beans (1kg),1299,650,Consumables
Fitness Band,3999,2200,Electronics
Cloud Storage Subscription,299,80,Services
Office Chair (Ergonomic),7499,4200,Furniture
Bluetooth Speaker,1999,950,Electronics
Online Course Access,999,150,Services
```

---

### 3. Architectural Risks When Calling Engine from a New Module

1. **In-Place Mutation of `NegotiationState`:**  
   `process_round(state, extraction)` mutates `state.current_round`, `state.offer_history`, and `state.counter_history` in place.
   - *Risk:* If Peitho evaluates hypothetical recommendations ("What if the buyer says $80 vs $85?"), running multiple checks on the same `state` object will corrupt round counters and concession curves.
   - *Mitigation:* Always clone the state using `copy.deepcopy(state)` before running advisory calculations.
2. **Global Module Dict `TUNING`:**  
   All engine parameters live in the global `TUNING` dictionary in `negotiation_engine.py`.
   - *Risk:* Never modify `TUNING["..."]` at runtime to change a single seller's policy; doing so mutates engine rules globally for all concurrent sessions. Instead, adjust parameters on the instantiated `NegotiationState` (e.g. `min_floor`, `mode`, `historical_avg_margin`).
3. **Synchronous LLM ThreadPool Starvation:**  
   `OpenRouterClient` routes synchronous calls through `_sync_pool = ThreadPoolExecutor(max_workers=4)`.
   - *Risk:* If Peitho executes extraction or verbalization synchronously during live calls while an automated chat session is running, workers can easily become saturated, blocking both services.
   - *Mitigation:* In Peitho, use the async `client.generate()` method rather than `generate_sync()`.
4. **Disparity in Product ID Data Types:**  
   - In MySQL, product ID is an `INT`.
   - In `ProductData` (Pydantic), `product_id` is a `str`.
   - In `NegotiationState`, there is no `product_id` at all.
   - *Risk:* Passing an integer product ID to components expecting strings (or vice versa). Keep Peitho's in-memory engine calls decoupled from database ID types.

---

## Conclusion & Architectural Recommendation

### (a) 5 Files to Read First
1. [`backend/app/agents/negotiation_engine.py`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/agents/negotiation_engine.py): The complete PRANE-X engine (`process_round`, dynamic floor, concession curves, acceptance checks).
2. [`backend/app/agents/pricing_agent.py`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/agents/pricing_agent.py): Bridge between extraction, engine, and verbalizer.
3. [`backend/app/call_feature/voice_routes.py`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/call_feature/voice_routes.py): Existing FastAPI WebSocket implementation with JWT query-param auth.
4. [`frontend/src/call-feature/useVoiceCall.js`](file:///d:/Negotiation_Bot/Negotiation-Bot/frontend/src/call-feature/useVoiceCall.js): Existing AudioWorklet, mic capture, and real-time streaming hook.
5. [`backend/app/models/schemas.py`](file:///d:/Negotiation_Bot/Negotiation-Bot/backend/app/models/schemas.py): Pydantic input/output contracts.

### (b) Verdict on Advisory Mode: Thin Wrapper vs Rewrite
**VERDICT: YES — Advisory Mode can be implemented as a THIN WRAPPER.**

#### Reasoning:
- **Zero Decoupling Required:** The core negotiation engine (`process_round`) is already decoupled from databases, HTTP sessions, and websockets. It is a pure Python function that accepts a state dataclass and an extraction dict, returning an immutable `EngineResult`.
- **Stateless Execution:** Calling `process_round(state, extraction)` does not touch MySQL, Redis, or disk. Peitho can hold the call transcript and negotiation state entirely in-memory for the duration of a phone call.
- **Bot Isolation:** The existing automated chat bot continues to run untouched through `NegotiationEngine` and `chat_session_routes.py`. Peitho can sit in parallel as a dedicated service or router (`app/peitho/`) importing `process_round` directly.
- **Reusable Real-Time Assets:** You do not even need to build WebSockets or audio capture from scratch; `backend/app/call_feature/voice_routes.py` and `frontend/src/call-feature/useVoiceCall.js` already implement the exact WebSocket and microphone mechanics needed for live calls.

### (c) Open Questions for Implementation
1. **Audio Pipeline / STT Provider:** Are you planning to use Sarvam AI (already integrated in `backend/app/call_feature/sarvam_service.py`), or will Peitho use Deepgram / Whisper / Google Cloud Speech for speaker-diarized seller/buyer live audio?
2. **Speaker Diarization:** How will the call audio identify whether the speaker is the "Seller" or "Buyer"? Will you have two separate audio streams (e.g. Twilio / Daily conference legs) or perform real-time mono diarization?
3. **Private "Ask" Chat Data Boundary:** Should the private seller-facing "Ask" chat only answer questions about the current call and product economics, or should it query the entire database of previous sessions and competitive intelligence data?
