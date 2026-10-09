# Peitho — Current Features

Peitho is a profit-aware, multi-agent negotiation engine with a conversational interface for e-commerce sellers. Below is a detailed breakdown of all the current features implemented in the project.

## 1. Negotiation Engine
* **Multi-agent Architecture**: Three specialized agents coordinated by an orchestration engine:
  * **Context Analysis Agent**: Analyzes negotiation posture (pressure, urgency, relationship priority).
  * **Pricing Strategy Agent**: Makes all numeric decisions using deterministic logic without LLM involvement.
  * **Conversation Agent**: Generates natural language responses via LLM.
* **Operating Modes**:
  * `MAX_PROFIT`: Conservative, margin-focused mode (default).
  * `MIN_LOSS`: Flexible, break-even-focused mode.
* **Free-text Negotiation**: Allows buyers to chat naturally; the system extracts offers via LLM with regex fallback.
* **Dynamic Acceptance Thresholds**: The bot becomes progressively more willing to accept as rounds increase.
* **Session Lifecycle Management**: Handles the full flow: create → negotiate (multi-round) → accept/reject/expire/walk-away.
* **LLM Output Validation**: A safety layer ensuring the AI never invents prices or violates business constraints.
* **Confirmation Flows**: Explicit deal confirmation with pattern matching for strong/soft accepts.
* **Triple-Fallback Resilience**: AI components fallback from LLM → Heuristic → Template.

## 2. Product Management
* **Full CRUD Operations**: Create, read, update, and delete products with per-user ownership.
* **Bulk Import**: Support for bulk CSV import (e.g., via `products.csv`).
* **Performance Statistics**: Tracks total sessions, accepted deals, average margin, and revenue per product.
* **Negotiation Settings**: Granular per-product settings for cost, pricing constraints, and inventory.

## 3. Business Analytics
* **Revenue & Profitability Calculator**: Computes revenue, costs, profit, margins, and unit economics.
* **Rule-based Insights**: Provides severity-graded recommendations (info, warning, critical, success).
* **Chart Data Generation**: Pre-formatted data ready for integration with charting libraries like Chart.js or Recharts (bar, funnel, inventory, cost breakdown).
* **What-if Simulation**: Allows testing different pricing scenarios without affecting live production data.
* **Competitive Intelligence**: Module running on an isolated plugin architecture.

## 4. Authentication & API Access
* **Dual Authentication**:
  * JWT tokens for the User Interface.
  * API keys (`tm_`-prefixed) for programmatic API access.
* **API Key Management**: Generate, list (masked), and revoke keys.
* **Rate Limiting**: Configured per-minute and per-hour limits using SlowAPI to protect endpoints.

## 5. Internationalization (i18n)
* **Extensive Language Support**: 50+ languages supported.
* **Live Translation**: Powered by Gemini API (2.5-flash-lite).
* **Static Translations**: Bundled translations for English and Hindi.
* **Client-side Caching**: LocalStorage caching for performance.
* **RTL Support**: Built-in styling and support for right-to-left languages (Arabic, Hebrew, Urdu, Persian).

## 6. Email Notifications
* **Custom SMTP**: Per-user SMTP configuration for white-label emails.
* **Branded Templates**: HTML email templates for deal events, session updates, and API key events.
* **Asynchronous Dispatch**: Non-blocking async email delivery via `asyncio`.

## 7. User Dashboard & UI
* **Negotiation Dashboard**: Real-time deal tracking and session history, including live session lists with status filters and search.
* **In-app Chat Viewer**: Monitor ongoing negotiations in real-time.
* **Product Catalog**: Interface to browse, edit, and manage products along with opportunity scores.
* **Analytics Views**: Comprehensive displays for revenue, profitability, and business insights.
* **API Access & Settings**: Dedicated pages for API key management, API documentation, and SMTP email settings.
* **Administrative Features**: Modules for competitive intelligence, reports, and a reputation dashboard.
* **Export Functionality**: Ability to export session data.
* **Buyer Callback Tracking**: Tracks and manages buyer callback requests.
