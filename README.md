<div align="center">

# Peitho — AI-Powered Negotiation Platform

**A profit-aware, multi-agent negotiation engine with a conversational interface for e-commerce sellers.**

[![FastAPI](https://img.shields.io/badge/FastAPI-0.128-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-19.2-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![MySQL](https://img.shields.io/badge/MySQL-8+-4479A1?logo=mysql&logoColor=white)](https://www.mysql.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

</div>

---

## 📋 Table of Contents

- [Overview](#overview)
- [Core Philosophy](#core-philosophy)
- [Features](#features)
- [Architecture](#architecture)
- [Technology Stack](#technology-stack)
- [Project Structure](#project-structure)
- [Backend Components](#backend-components)
- [Frontend Components](#frontend-components)
- [Data Models](#data-models)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [API Reference](#api-reference)
- [Database Schema](#database-schema)
- [Development Setup](#development-setup)
- [Current Status](#current-status)
- [Future Enhancements](#future-enhancements)

---

## Overview

Peitho is **not** a chatbot. It is a **business decision engine** with a natural language interface.

Sellers define their product costs, pricing constraints, and negotiation strategy. Peitho's multi-agent AI system then conducts negotiations with buyers — computing optimal counter-offers, managing concessions, and generating human-like conversational responses — all while **never violating the seller's hard business rules**.

The platform combines rule-based deterministic pricing logic with LLM-powered intelligence, ensuring that every deal outcome is explainable, auditable, and aligned with the seller's profit objectives.

### Key Innovation

Unlike traditional chatbots that use LLMs for all decisions, Peitho separates concerns:
- **Rule Engine**: Handles all numeric/pricing decisions (deterministic, auditable)
- **LLM**: Generates natural language only (conversational, contextual)
- **Validator**: Ensures LLM output never contradicts business rules

---

## Core Philosophy

| Principle | Description |
|---|---|
| **Profit > Deal Closure** | The system protects seller margins, even if it means walking away. |
| **Constraints > Intelligence** | Hard business rules override AI suggestions — always. |
| **Rules > Language Models** | LLMs generate language; deterministic logic controls pricing. |
| **Predictability > Creativity** | Same inputs produce same pricing decisions, every time. |
| **Safety > Autonomy** | When in doubt, the system defaults to seller protection. |

> *"If there is ever a trade-off between closing a deal and protecting seller constraints, seller constraints win."*

---

## Features

### ✅ Implemented Features

#### Negotiation Engine
- **Multi-agent architecture** — three specialized agents coordinated by an orchestration engine:
  - **Context Analysis Agent**: Analyzes negotiation posture (pressure, urgency, relationship priority)
  - **Pricing Strategy Agent**: Makes all numeric decisions (no LLM involvement)
  - **Conversation Agent**: Generates natural language responses via LLM
  
- **Two operating modes**:
  - `MAX_PROFIT`: Conservative, margin-focused (default)
  - `MIN_LOSS`: Flexible, break-even-focused
  
- **Free-text negotiation**: Buyers chat naturally; system extracts offers via LLM with regex fallback
- **Dynamic acceptance thresholds**: Bot becomes progressively more willing to accept as rounds increase
- **Session lifecycle management**: create → negotiate (multi-round) → accept/reject/expire/walk-away
- **LLM output validation**: Safety layer ensures AI never invents prices or violates constraints
- **Confirmation flows**: Explicit deal confirmation with pattern matching for strong/soft accepts

#### Product Management
- Full CRUD for products with per-user ownership
- Bulk CSV import (`products.csv` pre-loaded)
- Product performance stats: total sessions, accepted deals, average margin, revenue
- Per-product negotiation settings (cost, pricing, inventory)

#### Business Analytics
- **Revenue & profitability calculator** — revenue, costs, profit, margins, unit economics
- **Rule-based insights** — severity-graded recommendations (info/warning/critical/success)
- **Chart data generation** — pre-formatted for Chart.js/Recharts (bar, funnel, inventory, cost breakdown)
- **What-if simulation** — test scenarios without affecting live data
- **Competitive intelligence module** — isolated plugin architecture

#### Authentication & API Access
- **Dual authentication**:
  - JWT tokens for UI
  - API keys (`tm_`-prefixed) for programmatic access
  - Both methods accepted on all protected endpoints
  
- **API key management**: generate, list (masked), revoke
- **Rate limiting**: Per-minute and per-hour limits

#### Internationalization (i18n)
- **50+ languages** supported
- Static translations for English and Hindi
- **Live translation via Gemini API** (2.5-flash-lite)
- Client-side caching in localStorage
- RTL support for Arabic, Hebrew, Urdu, Persian

#### Email Notifications
- Per-user SMTP configuration for white-label emails
- Branded HTML email templates for deal/session/API key events
- Non-blocking async dispatch via `asyncio`

#### User Dashboard
- **Negotiation Dashboard**: Real-time deal tracking, session history
- **Product Catalog**: Browse, edit, and manage products
- **Business Analytics**: Revenue, profitability, insights
- **API Access**: API key management, documentation, code samples
- **Email Settings**: SMTP configuration
- **Administrative Features**: Competitive intelligence, reports, reputation dashboard
- Live session list with status filters and search
- In-app chat viewer for ongoing negotiations
- Session export functionality
- Buyer callback request tracking
- Dashboard summary metrics

---

## Architecture

### Multi-Agent System

```
┌─────────────────────────────────────────────────────────┐
│                   Orchestration Engine                    │
│              (Session lifecycle & agent flow)             │
├──────────────┬───────────────────┬───────────────────────┤
│              │                   │                        │
│  ┌───────────▼──────────┐  ┌────▼──────────────┐  ┌─────▼──────────────┐
│  │  Context Analysis     │  │  Pricing Strategy  │  │  Conversation       │
│  │  Agent                │  │  Agent             │  │  Agent              │
│  ├───────────────────────┤  ├────────────────────┤  ├─────────────────────┤
│  │ • Strategic posture   │  │ • Compute offers   │  │ • NL response gen   │
│  │ • Aggressiveness      │  │ • Accept / counter │  │ • Justify decisions  │
│  │ • Concession budget   │  │ • Enforce floors   │  │ • Template fallback  │
│  │ • Risk tolerance      │  │ • Hard guardrails  │  │ • LLM validation     │
│  │                       │  │                    │  │                     │
│  │ LLM + heuristic       │  │ LLM + deterministic│  │ LLM + template      │
│  │ fallback              │  │ safety override    │  │ fallback            │
│  └───────────────────────┘  └────────────────────┘  └─────────────────────┘
│                                                                           │
│  Key: LLM provides intelligence — hard rules CANNOT be overridden by AI   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Triple-Fallback Resilience

Every AI-powered component follows a three-tier fallback chain:

1. **LLM call** (OpenRouter → Gemini / GPT-4 / Claude)
2. **Heuristic fallback** (rule-based computation)
3. **Template fallback** (pre-defined responses)

This ensures the system operates correctly even with **zero API keys configured**.

### Data Flow

```
Buyer Message
     │
     ▼
 ┌─────────────┐    ┌──────────────┐    ┌────────────────┐    ┌──────────────┐
 │ Extract      │───▶│ Context      │───▶│ Pricing        │───▶│ Conversation │
 │ Offer/Intent │    │ Analysis     │    │ Strategy       │    │ Generation   │
 └─────────────┘    └──────────────┘    └────────────────┘    └──────────────┘
                                              │                       │
                                              ▼                       ▼
                                     Decision (price)        Natural language
                                     + constraints           response
                                              │                       │
                                              └──────────┬────────────┘
                                                         ▼
                                                  ┌──────────────┐
                                                  │ LLM Validator│
                                                  │ (price-check)│
                                                  └──────┬───────┘
                                                         ▼
                                                   Response to
                                                     Buyer
```

---

## Tech Stack

### Backend

| Component | Technology |
|---|---|
| Framework | **FastAPI** 0.128 |
| Runtime | Python 3.10+ with **Uvicorn** |
| Database | **MySQL 8+** via `aiomysql` (async connection pool) |
| LLM Provider | **OpenRouter** (Gemini 2.0 Flash, GPT-4, Claude) via `httpx` |
| Authentication | **PyJWT** + **bcrypt** |
| Session Cache | `cachetools.TTLCache` (1hr TTL, 10K max sessions) |
| Validation | **Pydantic v2** |
| Rate Limiting | **SlowAPI** |
| Logging | **structlog** |
| Config | `pydantic-settings` + `.env` |
| Testing | **pytest** |

### Frontend

| Component | Technology |
|---|---|
| Framework | **React 19.2** |
| Bundler | **Vite 7.2** |
| Routing | **react-router-dom** 6.28 |
| Styling | **Tailwind CSS** 3.4 + `tailwindcss-animate` |
| UI Primitives | **Radix UI** + shadcn/ui pattern |
| Icons | **lucide-react** |
| 3D Visuals | **Three.js** + `@react-three/fiber` + `@react-three/drei` |
| Translation | **Gemini API** (2.5-flash-lite) |

### Infrastructure

| Component | Technology |
|---|---|
| Reverse Proxy | **Nginx** |
| Frontend Hosting | **Vercel** |
| Backend Hosting | Railway / Render / any FastAPI host |

---

## Project Structure

```
Negotiation-Bot/
├── backend/
│   ├── app/
│   │   ├── main.py                    # Application factory (create_app)
│   │   ├── server.py                  # Uvicorn entry point
│   │   ├── agents/
│   │   │   ├── context_agent.py       # Strategic posture analysis
│   │   │   ├── pricing_agent.py       # Deterministic pricing decisions
│   │   │   └── conversation_agent.py  # Natural language generation
│   │   ├── analytics/
│   │   │   ├── calculations.py        # Business metrics calculator
│   │   │   ├── insights.py            # Rule-based recommendations
│   │   │   ├── routes.py              # Analytics API endpoints
│   │   │   ├── schemas.py             # Analytics request/response models
│   │   │   └── service.py             # Analytics orchestration
│   │   ├── api/
│   │   │   ├── router.py              # Top-level API router
│   │   │   ├── middleware/             # Request logging, CORS
│   │   │   └── v1/                    # Versioned route modules
│   │   ├── core/
│   │   │   ├── config.py              # Settings via pydantic-settings
│   │   │   ├── engine.py              # Negotiation orchestration engine
│   │   │   ├── session.py             # Session lifecycle management
│   │   │   └── logging.py             # structlog configuration
│   │   ├── infrastructure/
│   │   │   ├── database/              # MySQL pool & queries
│   │   │   ├── external/              # External service integrations
│   │   │   └── llm/                   # OpenRouter LLM client
│   │   ├── models/
│   │   │   ├── schemas.py             # Pydantic request/response models
│   │   │   └── enums.py               # NegotiationMode, Decision enums
│   │   ├── services/
│   │   │   ├── email_service.py       # SMTP email notifications
│   │   │   └── llm_validator.py       # AI output price-checking
│   │   └── tests/
│   │       ├── conftest.py            # Pytest fixtures
│   │       ├── unit/                  # Unit tests
│   │       └── integration/           # Integration tests
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.jsx                    # Root component & routing
│   │   ├── pages/
│   │   │   ├── Landing.jsx            # Marketing homepage
│   │   │   ├── Login.jsx              # Authentication
│   │   │   ├── Register.jsx           # User registration
│   │   │   ├── NegotiationDashboard.jsx  # Live session management
│   │   │   ├── BusinessAnalytics.jsx  # Analytics & competitive intel
│   │   │   ├── ProductCatalog.jsx     # Product CRUD + opportunity score
│   │   │   ├── ApiAccess.jsx          # API key management
│   │   │   ├── EmailSettings.jsx      # SMTP configuration
│   │   │   └── ApiReference.jsx       # API documentation
│   │   ├── components/
│   │   │   ├── Layout.jsx / Navbar.jsx / Footer.jsx
│   │   │   ├── NeoButton.jsx / NeoCard.jsx   # Neo-brutalist components
│   │   │   ├── ProtectedRoute.jsx     # Auth guard
│   │   │   ├── LanguageModal.jsx      # i18n language picker
│   │   │   ├── SourceNetwork.jsx      # 3D Three.js visualization
│   │   │   └── ui/                    # shadcn/ui primitives
│   │   ├── context/
│   │   │   ├── I18nContext.jsx         # Translation provider
│   │   │   └── SessionContext.jsx      # Auth session provider
│   │   └── lib/
│   │       ├── api.js                 # API client (Axios)
│   │       ├── encryption.js          # NaCl client-side encryption
│   │       ├── geminiTranslate.js     # Gemini translation service
│   │       ├── productStore.js        # Product state management
│   │       └── i18n/                  # Static translation files
│   ├── package.json
│   ├── tailwind.config.js
│   └── vercel.json                    # Vercel deployment config
├── infrastructure/
│   └── nginx/                         # Reverse proxy configuration
├── agent_instructions.md              # AI agent design specification
├── products.csv                       # Sample product catalog
└── requirements.txt                   # Python dependencies
```

---

## Getting Started

### Prerequisites

- **Python** 3.10+
- **Node.js** 18+
- **MySQL** 8+
- **OpenRouter API key** (for LLM features — system works without it via fallbacks)

### 1. Clone the Repository

```bash
git clone https://github.com/your-username/Negotiation-Bot.git
cd Negotiation-Bot
```

### 2. Backend Setup

```bash
cd backend

# Create and activate virtual environment
python -m venv env
# Windows:
env\Scripts\activate
# Linux/macOS:
source env/bin/activate

# Install dependencies
pip install -r requirements.txt

# Start the server
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

The API will be available at `http://localhost:8000`. Interactive docs at `/docs` (Swagger) and `/redoc` (ReDoc).

### 3. Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Start the dev server
npm run dev
```

The UI will be available at `http://localhost:5173`.

### 4. Database Setup

Create a MySQL database named `trademind` and ensure the backend can connect. Tables are auto-created or can be set up from the schema below.

---

## Environment Variables

### Backend (`backend/.env`)

| Variable | Description | Example |
|---|---|---|
| `MYSQL_HOST` | MySQL server hostname | `localhost` |
| `MYSQL_PORT` | MySQL server port | `3306` |
| `MYSQL_USER` | MySQL username | `root` |
| `MYSQL_PASSWORD` | MySQL password | `yourpassword` |
| `MYSQL_DB` | Database name | `trademind` |
| `OPENROUTER_API_KEY` | OpenRouter API key for LLM access | `sk-or-...` |
| `JWT_SECRET` | Secret key for JWT token signing | `your-secret-key` |
| `SERP_API_KEY` | SerpAPI key for live Google Shopping market listings | `serp_api_...` |
| `MARKET_SOURCES` | Comma-separated price sources (`serp`, `html`, `seeded`) | `seeded` |
| `COMPARISON_MODE` | Market comparison mode (keeps items >= 1.02x our price) | `we_are_cheaper` |

### Frontend (`frontend/.env`)

| Variable | Description | Example |
|---|---|---|
| `VITE_API_URL` | Backend API base URL | `http://localhost:8000` |
| `VITE_AUTH_API_URL` | Auth API base URL | `http://localhost:8000` |
| `VITE_ANALYTICS_API_URL` | Analytics API base URL | `http://localhost:8000/api/v1` |
| `VITE_GEMINI_API_KEY` | Gemini API key for live translations | `AIza...` |

---

## API Reference

### Authentication

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `POST` | `/api/v1/auth/register` | Create user account | None |
| `POST` | `/api/v1/auth/login` | Login, returns JWT | None |
| `GET` | `/api/v1/auth/me` | Get current user | JWT / API Key |

### Negotiation

| Method | Endpoint | Description | Auth | Rate Limit |
|---|---|---|---|---|
| `POST` | `/api/v1/negotiate/sessions` | Create negotiation session | JWT / API Key | 20/min |
| `GET` | `/api/v1/negotiate/sessions/{id}` | Get session summary | JWT / API Key | 60/min |
| `DELETE` | `/api/v1/negotiate/sessions/{id}` | End session early | JWT / API Key | 30/min |
| `POST` | `/api/v1/negotiate/sessions/{id}/turns` | Submit structured offer | JWT / API Key | 30/min |
| `POST` | `/api/v1/negotiate/sessions/{id}/chat` | Free-text chat message | JWT / API Key | 30/min |

### Products

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `GET` | `/api/v1/products` | List user's products | JWT / API Key |
| `POST` | `/api/v1/products` | Create product | JWT / API Key |
| `PUT` | `/api/v1/products/{id}` | Update product | JWT / API Key |
| `DELETE` | `/api/v1/products/{id}` | Delete product | JWT / API Key |
| `POST` | `/api/v1/products/import` | Bulk CSV import | JWT / API Key |
| `GET` | `/api/v1/products/{id}/market-comparison` | Get higher-priced market competitor bubbles | JWT / API Key |

### Chat Sessions

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `POST` | `/api/v1/chat-sessions` | Start chat session | JWT / API Key |
| `GET` | `/api/v1/chat-sessions` | List sessions | JWT / API Key |
| `GET` | `/api/v1/chat-sessions/{id}` | Get session + messages | JWT / API Key |
| `POST` | `/api/v1/chat-sessions/{id}/messages` | Save round messages | JWT / API Key |
| `PUT` | `/api/v1/chat-sessions/{id}/close` | Close session | JWT / API Key |
| `GET` | `/api/v1/chat-sessions/dashboard/summary` | Dashboard metrics | JWT / API Key |
| `GET` | `/api/v1/chat-sessions/{id}/export` | Export session | JWT / API Key |
| `POST` | `/api/v1/chat-sessions/callback-request` | Request callback | JWT / API Key |
| `GET` | `/api/v1/chat-sessions/callback-requests` | List callbacks | JWT / API Key |

### API Keys

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `POST` | `/api/v1/api-keys` | Generate new API key | JWT |
| `GET` | `/api/v1/api-keys` | List keys (masked) | JWT |
| `DELETE` | `/api/v1/api-keys/{id}` | Revoke key | JWT |

### Email

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `GET` | `/api/v1/email/settings` | Get email config | JWT / API Key |
| `PUT` | `/api/v1/email/settings` | Update email config | JWT / API Key |
| `POST` | `/api/v1/email/test` | Send test email | JWT / API Key |

### Analytics

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `POST` | `/api/v1/analytics/calculate` | Calculate business analytics | JWT / API Key |
| `POST` | `/api/v1/analytics/simulate` | What-if simulation | JWT / API Key |
| `POST` | `/api/v1/analytics/competitive-analysis` | Competitive intelligence | JWT / API Key |
| `GET` | `/api/v1/analytics/health` | Health check | None |
| `GET` | `/api/v1/analytics/schema` | Input schema | None |

### Example: Create a Negotiation Session

```bash
curl -X POST http://localhost:8000/api/v1/negotiate/sessions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-jwt-or-api-key>" \
  -d '{
    "product": {
      "product_id": "SKU-001",
      "product_name": "Premium Widget",
      "base_price": 100.00,
      "cost_price": 60.00,
      "min_acceptable_price": 75.00,
      "max_loss_percentage": 0
    },
    "inventory": {
      "available_quantity": 100,
      "requested_quantity": 10,
      "inventory_pressure": "medium",
      "sales_frequency": "medium"
    },
    "strategy": {
      "mode": "MAX_PROFIT",
      "urgency": "medium",
      "relationship_priority": "medium",
      "max_rounds": 5
    }
  }'
```

### Example: Free-Text Negotiation

```bash
curl -X POST http://localhost:8000/api/v1/negotiate/sessions/{session_id}/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-jwt-or-api-key>" \
  -d '{
    "message": "That seems expensive. Can you do $80?"
  }'
```

---

## Database Schema

The platform uses **MySQL 8+** with the following tables:

### `users`
| Column | Type | Description |
|---|---|---|
| `id` | INT (PK) | Auto-increment user ID |
| `full_name` | VARCHAR | User's full name |
| `email` | VARCHAR (unique) | Login email |
| `password_hash` | VARCHAR | bcrypt-hashed password |
| `created_at` | DATETIME | Registration timestamp |

### `products`
| Column | Type | Description |
|---|---|---|
| `id` | INT (PK) | Auto-increment product ID |
| `user_id` | INT (FK → users) | Product owner |
| `name` | VARCHAR | Product name |
| `base_price` | DECIMAL | Listed / asking price |
| `cost_price` | DECIMAL | Seller's cost |
| `min_acceptable_price` | DECIMAL | Hard floor price |
| `max_loss_percent` | DECIMAL | Maximum allowed loss % |
| `mode` | ENUM | MAX_PROFIT / MIN_LOSS |
| `max_rounds` | INT | Max negotiation rounds |
| `category` | VARCHAR | Product category |
| `status` | VARCHAR | active / inactive |
| `total_sessions` | INT | Negotiation count |
| `accepted_deals` | INT | Successful deals |
| `avg_margin` | DECIMAL | Average profit margin |
| `revenue` | DECIMAL | Total revenue |

### `chat_sessions`
| Column | Type | Description |
|---|---|---|
| `id` | VARCHAR (PK) | Session UUID |
| `user_id` | INT (FK → users) | Session owner |
| `product_name` | VARCHAR | Product being negotiated |
| `mode` | VARCHAR | MAX_PROFIT / MIN_LOSS |
| `base_price` / `cost_price` / `min_price` | DECIMAL | Price parameters |
| `max_rounds` / `rounds_used` | INT | Round tracking |
| `status` | VARCHAR | active / closed / expired |
| `final_price` / `final_decision` | DECIMAL / VARCHAR | Outcome |
| `deal_closed` | BOOLEAN | Whether deal was accepted |
| `buyer_last_offer` / `seller_last_offer` | DECIMAL | Last offers |

### `chat_messages`
| Column | Type | Description |
|---|---|---|
| `id` | INT (PK) | Message ID |
| `session_id` | VARCHAR (FK → chat_sessions) | Parent session |
| `round_number` | INT | Negotiation round |
| `user_message` / `bot_reply` | TEXT | Conversation content |
| `offered_price` / `counter_price` | DECIMAL | Prices in this round |
| `decision` | VARCHAR | accept / counter / reject |

### `api_keys`
| Column | Type | Description |
|---|---|---|
| `id` | INT (PK) | Key ID |
| `user_id` | INT (FK → users) | Key owner |
| `api_key` | VARCHAR | `tm_`-prefixed key |
| `label` | VARCHAR | User-defined label |
| `is_active` | BOOLEAN | Active status |
| `last_used_at` | DATETIME | Last usage timestamp |

### `email_settings`
| Column | Type | Description |
|---|---|---|
| `id` | INT (PK) | Settings ID |
| `user_id` | INT (FK → users, unique) | Settings owner |
| SMTP fields | VARCHAR | host, port, user, password |
| Notification toggles | BOOLEAN | Per-event notification flags |

### `callback_requests`
| Column | Type | Description |
|---|---|---|
| `id` | INT (PK) | Request ID |
| `user_id` / `session_id` | INT / VARCHAR | Associated user & session |
| `phone_number` | VARCHAR | Buyer's phone |
| `status` | VARCHAR | pending / completed / missed |
| `created_at` | DATETIME | Request timestamp |

---

## Backend Components

### Core Engine (`core/engine.py`)

**Orchestration Layer** — coordinates the three agents and manages session lifecycle.

**Key Responsibilities:**
- Create negotiation sessions
- Parse buyer offers (structured + free-text)
- Route through context → pricing → conversation pipeline
- Manage session state (active, closed, expired)
- Track negotiation rounds and enforce max_rounds limit
- Handle acceptance confirmation (strong vs. soft accept patterns)
- Enforce hard constraints (never violate min price, max loss %)

**Key Methods:**
- `create_session()` — Initialize negotiation
- `process_negotiation_turn()` — Handle buyer offer → compute response
- `process_chat_message()` — Extract offer from free-text message
- `get_session()` — Retrieve session state
- `close_session()` — Finalize negotiation

### Agents

#### Context Analysis Agent (`agents/context_agent.py`)

**Purpose:** Compute strategic posture and aggressiveness.

**Inputs:**
- Negotiation mode (MAX_PROFIT / MIN_LOSS)
- Inventory pressure, sales frequency
- Urgency, relationship priority
- Negotiation round number

**Outputs:**
- Strategic posture score (-1 to +1, where +1 = aggressive/willing to negotiate)
- Aggressiveness level (CONSERVATIVE / MODERATE / AGGRESSIVE)
- Concession budget (how much margin can be given)
- Risk tolerance
- Fallback template

**Logic:**
- LLM analyzes context and returns strategic scores
- Heuristic fallback computes aggressiveness via rule-based rubric
- Dynamic acceptance: becomes more accepting as rounds increase (simulates pressure)

#### Pricing Strategy Agent (`agents/pricing_agent.py`)

**Purpose:** Compute optimal counter-offers and accept/reject decisions (deterministic, no LLM).

**Inputs:**
- Current price / requested price
- Cost, base price, min acceptable price
- Strategic posture
- Round number
- Remaining margin

**Outputs:**
- Counter-offer price (or acceptance)
- Decision (ACCEPT / COUNTER / REJECT)
- Justification, constraint violated flag

**Logic:**
- Pure deterministic algorithm (rule-based, auditable)
- Computes profit margin and enforces floors
- If margin approaches min, progressively becomes more accepting
- In MIN_LOSS mode, allows concessions below cost (with reason)
- Never invents prices; always respects seller constraints
- Template fallback for off-path decisions

**Key Safety Guarantees:**
- ✓ Never accepts below `min_acceptable_price`
- ✓ Never exceeds `max_loss_percentage` in MIN_LOSS mode
- ✓ Profit margin always auditable and explainable
- ✓ Same inputs → deterministic output (reproducible)

#### Conversation Agent (`agents/conversation_agent.py`)

**Purpose:** Generate human-like responses explaining pricing decisions.

**Inputs:**
- Buyer message
- Seller's pricing decision (ACCEPT / COUNTER / REJECT)
- Counter price (if applicable)
- Strategic posture
- Negotiation history

**Outputs:**
- Natural language response (conversational tone)
- Explanation of counter-offer
- Additional context (inventory pressure, market conditions)

**Safety Checks:**
- LLM validator ensures:
  - No invented prices
  - No contradiction with pricing decision
  - No forbidden phrases (e.g., "guaranteed profit")
  - Proper tone and professionalism
- Fallback to template responses if LLM output fails validation

### Session Management (`core/session.py`)

**SessionManager** — persistent session storage and retrieval.

**Features:**
- TTL-based cache (1 hour default, configurable)
- Auto-cleanup of expired sessions
- Concurrent session limits per user
- Session export functionality
- Callback request tracking

**Key Methods:**
- `create_session()`, `get_session()`, `update_session()`, `close_session()`
- `get_user_sessions()` — List all sessions for dashboard
- `session_expired()` — Check TTL
- `export_session()` — Prepare session data for download

### LLM Integration (`infrastructure/llm/`)

**OpenRouter Client** — interface to LLM provider (Gemini, GPT-4, Claude via OpenRouter).

**Features:**
- Connection pooling via `httpx`
- Timeout handling (10 sec default)
- Fallback to heuristics if LLM is unavailable
- Rate limiting respect
- Structured prompts for deterministic outputs

**Key Components:**
- `openai_client.py` — LLM API calls
- `prompt_templates.py` — Jinja2 templates for context/conversation
- Error handling with graceful degradation

### Database Layer (`infrastructure/database/`)

**MySQL Connection Pool** — async connection management via `aiomysql`.

**Features:**
- Async pool (concurrent connections) via `aiomysql`
- Query builders for CRUD operations
- Transaction support
- Prepared statements (SQL injection prevention)
- Automatic reconnection on pool stale

### Email Service (`services/email_service.py`)

**Purpose:** Send email notifications to users and buyers.

**Features:**
- Per-user SMTP configuration
- Async dispatch (non-blocking via `asyncio`)
- HTML email templates (Jinja2)
- White-label branding (from user's domain)
- Events: deal notifications, session alerts, API key events

**Safety:**
- No direct email in response (prevent PII leakage)
- Encrypted SMTP credentials in database
- Rate limiting on emails (max 100 per hour per user)

### Analytics Module (`analytics/`)

**Purpose:** Calculate business metrics, generate insights, provide what-if simulation.

**Key Components:**

| Component | Purpose |
|---|---|
| `calculations.py` | Revenue, profit, margins, unit economics, ROI |
| `insights.py` | Rule-based recommendations (info/warning/critical/success) |
| `routes.py` | Analytics API endpoints |
| `service.py` | Orchestration of calculations & insights |

**Features:**
- Revenue calculator (deals × price × quantity)
- Profitability (revenue - costs)
- Margin tracking (unit, order, average)
- Threshold-based alerts (e.g., "margin < 10%" → critical)
- What-if simulation (test scenarios without affecting live data)
- Chart data generation (pre-formatted for Recharts / Chart.js)

### Competitive Intelligence (`app/buisness anlytics/competitive_intelligence/`)

**Purpose:** Isolated plugin for market positioning analysis.

**Features:**
- Web scraper (BeautifulSoup) for public listing data
- LLM-powered analysis (market positioning, pricing gaps)
- Competitor price tracking
- Margin benchmarking
- Plugin architecture (can be disabled independently)

---

## Frontend Components

### Pages

| Page | Route | Purpose |
|---|---|---|
| **Landing** | `/` | Marketing homepage, feature showcase |
| **Login** | `/login` | Authentication form |
| **Register** | `/register` | User registration |
| **NegotiationDashboard** | `/negotiations` | Live session management & monitoring |
| **ProductCatalog** | `/products` | CRUD products, opportunity scoring |
| **BusinessAnalytics** | `/analytics` | Revenue, profitability, insights, competitive intel |
| **ApiAccess** | `/api-access` | API key management + documentation |
| **EmailSettings** | `/email-settings` | SMTP configuration for email notifications |
| **ApiReference** | `/api-ref` | Interactive API documentation |
| **ReportSubmission** | `/submit-report` | User feedback / bug reports |
| **ReputationDashboard** | `/reputation` | User reputation & credibility metrics |

### Key Components

| Component | Purpose |
|---|---|
| **ProtectedRoute** | Auth guard for private pages |
| **Layout / Navbar / Footer** | Page layout & navigation |
| **NeoButton / NeoCard** | Neo-brutalist design system |
| **LanguageModal** | i18n language picker (50+ languages) |
| **LanguageSwitcher** | Quick language toggle |
| **AlertBanner** | Error/success/info notifications |
| **SourceNetwork** | 3D Three.js network visualization |
| **TranslationLoadingOverlay** | Loading indicator during translation |

### Context Providers

| Context | Purpose |
|---|---|
| **I18nContext** | Global translation state & Gemini translation API |
| **SessionContext** | Auth session state (user, JWT, API keys) |

### Utility Libraries

| Utility | Purpose |
|---|---|
| `api.js` | Axios API client with auth headers |
| `encryption.js` | TweetNaCl.js client-side encryption (PII) |
| `geminiTranslate.js` | Gemini 2.5-flash-lite translation service |
| `productStore.js` | Client-side product state management |
| `utils.js` | Formatting, validation, helpers |
| `i18n/` | Static translation JSON files (English, Hindi + dynamic) |

---

## Data Models (Pydantic Schemas)

All request/response models are strictly validated via **Pydantic v2**.

### Core Negotiation Models

**ProductData** — Immutable product configuration
- `product_id`, `product_name` (string)
- `base_price`, `cost_price`, `min_acceptable_price` (Decimal, gt=0)
- `max_loss_percentage` (Decimal, 0–100)
- Validation: min_price ≤ base_price, cost ≤ base_price

**InventoryContext** — Inventory and supply context
- `available_quantity`, `requested_quantity` (int, gt=0)
- `inventory_pressure`, `sales_frequency` (PressureLevel / FrequencyLevel enum)
- Validation: requested ≤ available

**StrategicControls** — Seller's strategy parameters
- `mode` (NegotiationMode: MAX_PROFIT / MIN_LOSS)
- `urgency` (UrgencyLevel: LOW / MEDIUM / HIGH)
- `relationship_priority` (RelationshipPriority: LOW / MEDIUM / HIGH)
- `max_rounds` (int, 1–20)

**BuyerOffer** — Structured offer from buyer
- `offered_price` (Decimal, gt=0)
- `offered_quantity` (int, optional)
- `message` (string, max 1000 chars, optional)

**ChatMessage** — Free-text chat message
- `message` (string, 1–2000 chars)

**CreateSessionRequest** — Create negotiation session
- `product` (ProductData)
- `inventory` (InventoryContext)
- `strategy` (StrategicControls, optional)
- `buyer_id` (string, optional)
- `metadata` (dict, optional)

**CreateSessionResponse** — Session created successfully
- `session_id` (UUID)
- `timestamp` (datetime)
- `message` (string, confirmation)

### Negotiation Response Models

**PricingDecision** — Pricing logic output
- `decision` (OfferDecision: ACCEPT / COUNTER / REJECT)
- `counter_price` (Decimal, optional if accepting/rejecting)
- `profit_margin` (Decimal, percentage)
- `constraint_violated` (bool, if true: constraint has been breached)
- `justification` (string, why this decision)

**NegotiationTurnResponse** — Full turn response (pricing + conversation)
- `session_id` (UUID)
- `round_number` (int)
- `status` (NegotiationStatus: active / accepted / rejected / expired)
- `pricing` (PricingDecision)
- `message` (string, seller's response)
- `can_continue` (bool, can buyer make another offer?)
- `rounds_remaining` (int)
- `timestamp` (datetime)

**ChatResponse** — Response to free-text chat
- `session_id` (UUID)
- `message` (string, seller's response)
- `has_price_offer` (bool, whether buyer's message contained a price)
- `extracted_price` (Decimal, optional)
- Additional fields from NegotiationTurnResponse (if price found)

**SessionSummary** — Session overview
- `session_id` (UUID)
- `product_name` (string)
- `mode`, `status` (enum)
- `base_price`, `cost_price`, `min_price` (Decimal)
- `initial_offer`, `buyer_last_offer`, `seller_last_offer` (Decimal)
- `final_price`, `final_decision` (Decimal, enum)
- `rounds_used` / `max_rounds` (int)
- `deal_closed` (bool)
- `profit_margin` (Decimal, %)
- `revenue` (Decimal)
- `created_at`, `updated_at` (datetime)

---

## Development Setup

### Running Tests

```bash
cd backend

# Run all tests
pytest

# Run with coverage
pytest --cov=app

# Run specific test
pytest tests/unit/test_engine.py -v
```

### Linting & Code Quality

```bash
# Backend (Python)
pylint app/
ruff check app/

# Frontend (JavaScript)
npm run lint
```

### Database Migrations

Migrations are manual (no ORM). To add a table:

1. Create `.sql` file in `backend/app/infrastructure/database/migrations/`
2. Run: `mysql -h <HOST> -u <USER> -p <DB> < migration.sql`

(Consider using Alembic for version control in production.)

### Environment Setup

**Backend `.env` example:**
```
ENV=development
DEBUG=true
LOG_LEVEL=DEBUG

MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=yourpassword
MYSQL_DB=trademind

OPENROUTER_API_KEY=sk-or-...  # Get from https://openrouter.ai/keys
JWT_SECRET=your-secret-key-here

ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000
```

**Frontend `.env` example:**
```
VITE_API_URL=http://localhost:8000
VITE_GEMINI_API_KEY=AIza...  # Get from Google Cloud Console
```

---

## Current Status

### ✅ Completed

- [x] **Negotiation Engine** — full multi-agent orchestration system
  - [x] Context Analysis Agent with strategic posture scoring
  - [x] Pricing Strategy Agent with deterministic pricing logic
  - [x] Conversation Agent with LLM integration
  - [x] Session lifecycle management (create → negotiate → close)
  - [x] Free-text offer extraction (LLM + regex fallback)
  - [x] Confirmation flow (strong/soft accept patterns)
  
- [x] **Product Management**
  - [x] CRUD operations (create, read, update, delete)
  - [x] Bulk CSV import
  - [x] Per-product performance tracking
  
- [x] **Business Analytics**
  - [x] Revenue calculator
  - [x] Profitability metrics
  - [x] Margin tracking
  - [x] Rule-based insights (threshold alerts)
  - [x] What-if simulation
  - [x] Chart data generation
  
- [x] **Authentication**
  - [x] JWT token-based auth (UI)
  - [x] API key management (`tm_`-prefixed keys)
  - [x] Dual auth support on all endpoints
  - [x] Rate limiting (per-minute, per-hour)
  
- [x] **Email Notifications**
  - [x] Per-user SMTP configuration
  - [x] HTML email templates
  - [x] Async email dispatch
  - [x] White-label branding support
  
- [x] **Internationalization (i18n)**
  - [x] 50+ language support
  - [x] Static translations (English, Hindi)
  - [x] Live translation via Gemini API
  - [x] Client-side caching
  - [x] RTL support (Arabic, Hebrew, Urdu, Persian)
  
- [x] **Frontend UI**
  - [x] Pages: Landing, Login, Register, Negotiations, Products, Analytics, API, Email, API Ref
  - [x] Responsive design (Tailwind CSS)
  - [x] Neo-brutalist design system
  - [x] Auth guards (Protected routes)
  - [x] Real-time session monitoring
  - [x] Product opportunity scoring
  
- [x] **Competitive Intelligence Module**
  - [x] Web scraper (BeautifulSoup)
  - [x] LLM-powered analysis
  - [x] Isolated plugin architecture
  
- [x] **API Documentation**
  - [x] Swagger/OpenAPI (auto-generated at `/docs`)
  - [x] ReDoc (`/redoc`)
  - [x] Interactive API reference page
  - [x] Code samples (Python, JavaScript, TypeScript)

### ⚠️ In Progress / Partial

- [ ] **Database Schema** — Core tables created, some features incomplete
- [ ] **Testing** — Unit and integration tests partially written
- [ ] **Deployment** — Docker images, CI/CD pipelines needed
- [ ] **Performance Optimization** — Caching strategy, DB indexing tuning

### 📋 Future Enhancements

- [ ] **Advanced Analytics**
  - [ ] Sales funnel visualization
  - [ ] Cohort analysis (buyer segments)
  - [ ] Lifetime value (LTV) prediction
  - [ ] Churn prediction
  
- [ ] **Negotiation AI**
  - [ ] Multi-buyer negotiations (auction mode)
  - [ ] Negotiation outcome prediction (likelihood of acceptance)
  - [ ] Dynamic strategy adjustment based on buyer behavior
  - [ ] Learning from historical negotiations
  
- [ ] **Compliance & Audit**
  - [ ] Session audit logs (all decisions + rationale)
  - [ ] GDPR compliance (data export, deletion)
  - [ ] SOC 2 audit preparation
  - [ ] Compliance dashboard
  
- [ ] **Security Hardening**
  - [ ] OAuth 2.0 + SSO (Google, Microsoft)
  - [ ] Two-factor authentication (2FA)
  - [ ] IP allowlisting for API keys
  - [ ] Secret rotation (JWT secret, SMTP credentials)
  
- [ ] **Scaling**
  - [ ] Redis cache layer (replace TTLCache)
  - [ ] Message queue (Celery + RabbitMQ) for async tasks
  - [ ] Database read replicas
  - [ ] CDN for frontend (Vercel already handles this)
  - [ ] Horizontal pod autoscaling (Kubernetes)
  
- [ ] **Mobile**
  - [ ] React Native mobile app (iOS + Android)
  - [ ] Push notifications for deal alerts
  - [ ] Mobile-optimized negotiation interface
  
- [ ] **Integration Ecosystem**
  - [ ] Shopify integration
  - [ ] WooCommerce integration
  - [ ] Zapier integration
  - [ ] Slack notifications
  - [ ] Webhook support
  
- [ ] **Advanced Reporting**
  - [ ] Custom report builder
  - [ ] Scheduled report delivery (email)
  - [ ] PDF export
  - [ ] Data warehouse integration
  
- [ ] **Localization**
  - [ ] Localized email templates
  - [ ] Regional currency support
  - [ ] Tax calculation (by region)
  
- [ ] **Buyer Portal**
  - [ ] Buyer-facing negotiation interface
  - [ ] Buyer account dashboard
  - [ ] Negotiation history from buyer perspective
  - [ ] Counter-proposal drafting tools

---

## Code Organization & Conventions

### Backend

**Naming Conventions:**
- Modules: `snake_case` (e.g., `pricing_agent.py`)
- Classes: `PascalCase` (e.g., `PricingStrategyAgent`)
- Functions: `snake_case` (e.g., `compute_counter_offer()`)
- Constants: `UPPER_SNAKE_CASE` (e.g., `MAX_ROUNDS = 5`)

**Structure:**
- One logical unit per file
- No file exceeds 500 lines (split into submodules if needed)
- Type hints on all function signatures
- Docstrings on all public functions (format: "Brief description")

**Error Handling:**
- Use custom exceptions (e.g., `ConstraintViolationError`)
- Never expose internal stack traces to API clients
- Structured logging (structlog) for debugging

### Frontend

**Naming Conventions:**
- Components: `PascalCase` (e.g., `NegotiationDashboard.jsx`)
- Utilities: `camelCase` (e.g., `geminiTranslate.js`)
- CSS Classes: `kebab-case` (Tailwind utility + custom)
- Constants: `UPPER_SNAKE_CASE` (e.g., `API_BASE_URL`)

**Structure:**
- One component per file
- Co-locate styles with components (Tailwind inline or CSS modules)
- Separate `lib/` for utilities, APIs, services
- Separate `context/` for global state

---

## Contribution Guidelines

1. **Branch Naming**: `feature/<feature-name>` or `fix/<bug-description>`
2. **Commit Messages**: Imperative mood (e.g., "Add negotiation engine tests" not "Added tests")
3. **Code Review**: All PRs require review before merge
4. **Testing**: New features require tests (min 70% coverage)
5. **Documentation**: Update README and docstrings for API changes

---

## Troubleshooting

### Backend

**"ModuleNotFoundError: No module named 'app'"**
- Ensure you're running from `backend/` directory
- Verify `.env` file exists with required vars

**"Connection to MySQL failed"**
- Check `MYSQL_HOST`, `MYSQL_USER`, `MYSQL_PASSWORD` in `.env`
- Verify MySQL service is running: `systemctl status mysql` (Linux) or check Services (Windows)
- Create database: `mysql -u root -p -e "CREATE DATABASE trademind;"`

**"OpenRouter API key not found"**
- System will use fallback (heuristic) mode
- To enable LLM, set `OPENROUTER_API_KEY` in `.env`

### Frontend

**"VITE_API_URL is not defined"**
- Create `frontend/.env.local` with: `VITE_API_URL=http://localhost:8000`

**"Translation not loading"**
- Check browser console for CORS errors
- Verify `VITE_GEMINI_API_KEY` is set and valid
- Fallback: manual language selection in modal

---

## License

MIT License — see [LICENSE](LICENSE) for details.

---

## Contact & Support

**Questions or Issues?**
- 📧 Email: support@trademind.ai
- 🐛 Issues: [GitHub Issues](https://github.com/your-username/Negotiation-Bot/issues)
- 💬 Discussions: [GitHub Discussions](https://github.com/your-username/Negotiation-Bot/discussions)

---

**Version**: 1.0.0 (March 5, 2026)
**Last Updated**: March 5, 2026
| `product_name` | VARCHAR | Product name |
| `status` | VARCHAR | pending / contacted / resolved |

---

## Design System

TradeMind uses a **Neo-Brutalist** design language — bold colors, thick borders, and high-contrast typography.

| Token | Hex | Preview |
|---|---|---|
| `neo-navy` | `#001524` | ![#001524](https://via.placeholder.com/15/001524/001524.png) Deep navy background |
| `neo-teal` | `#15616D` | ![#15616D](https://via.placeholder.com/15/15616D/15616D.png) Primary accent |
| `neo-cream` | `#FFECD1` | ![#FFECD1](https://via.placeholder.com/15/FFECD1/FFECD1.png) Light background |
| `neo-orange` | `#FF7D00` | ![#FF7D00](https://via.placeholder.com/15/FF7D00/FF7D00.png) CTA / highlights |
| `neo-maroon` | `#78290F` | ![#78290F](https://via.placeholder.com/15/78290F/78290F.png) Danger / emphasis |

---

## Deployment

### Backend

Deploy to **Railway**, **Render**, or any platform that supports Python + FastAPI:

```bash
# Production start
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

Ensure all environment variables are set and the MySQL database is accessible.

### Frontend

Deploy to **Vercel** (recommended — `vercel.json` included) or any static host:

```bash
npm run build    # Outputs to dist/
```

### Production Checklist

- [ ] Set `CORS` origins in `backend/app/main.py` to your frontend domain
- [ ] Use a strong, unique `JWT_SECRET`
- [ ] Configure MySQL with proper credentials and SSL
- [ ] Set `OPENROUTER_API_KEY` for full LLM capability (optional — fallbacks work without it)
- [ ] Configure Nginx reverse proxy for HTTPS termination (see `infrastructure/nginx/`)

---

## License

MIT License
