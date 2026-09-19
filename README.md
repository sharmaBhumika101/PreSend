# PreSend

**PreSend is a pre-send fraud triage console for outbound payment platforms (UPI and bank transfers).** Before a high-value or suspicious transaction leaves the platform, PreSend scores it using a deterministic static checklist and account-level behavioral anomaly baselines, generates an explainable plain-English brief, and equips fraud analysts with a one-click decision workflow with immutable audit logging. Built with Next.js 15, TypeScript, Tailwind CSS, and Supabase PostgreSQL.

---

## Key Features

- **Dual-Layer Deterministic Scoring**: Combines a 6-rule static checklist with an account-level behavioral anomaly engine that measures deviations against historical baselines.
- **Server-Authoritative Risk Calculation**: All risk scores (0–100), risk bands, and typologies are calculated strictly server-side, preventing client tampering or score spoofing.
- **Behavioral Anomaly Baselines**: Automatically tracks account median amounts, contextual velocity, known payees, operating hours, and channel usage ($N \ge 3$) with strict self-exclusion.
- **Human-in-the-Loop Triage Console**: Real-time pre-send queue sorted by risk score with instant multi-criteria filtering, full-text search, and funds-stopped metrics.
- **Persistent Analyst Decision Workflow**: One-click Hold, Release, and Escalate actions with mandatory rationale capture and immutable audit logging in PostgreSQL.
- **AI Explanation with Offline Resilience**: Generates plain-English analyst briefs and customer verification call scripts via Claude or Gemini, with an automatic deterministic template fallback.
- **Zero-Setup Demo Mode**: Works immediately in-memory with synthetic demo seed data, or connects to Supabase PostgreSQL for enterprise persistence.
- **Comprehensive Test Coverage**: Backed by **129 automated tests across 23 test suites**, strict TypeScript typing, and production Next.js 15 App Router architecture.

---

## Application Preview

> _Screenshots can be added by placing image files in the `docs/screenshots/` directory._

| View | Description | Preview |
|---|---|---|
| **Analyst Dashboard** | Pre-send queue ranked by composite risk score, live search, status/band filters, and funds-protected tally. | ![Analyst Dashboard](docs/screenshots/analyst-dashboard.png)<br>*(Placeholder: `docs/screenshots/analyst-dashboard.png`)* |
| **New Transaction** | Modal for initiating outbound transfers with instant schema validation and one-click fraud/benign test presets. | ![New Transaction](docs/screenshots/new-transaction.png)<br>*(Placeholder: `docs/screenshots/new-transaction.png`)* |
| **Risk / Behavioral Analysis** | Risk gauge (0–100), account baseline comparison profile, fired rule breakdown, AI brief, and decision buttons. | ![Risk & Behavioral Analysis](docs/screenshots/risk-behavioral-analysis.png)<br>*(Placeholder: `docs/screenshots/risk-behavioral-analysis.png`)* |

---

## How It Works

1. **Transaction Ingestion & Validation**: An outbound payment (UPI or Bank Transfer) is received via API or UI modal and validated against strict server-side runtime schemas.
2. **Dual-Layer Risk Evaluation**:
   - **Static Checklist**: Evaluates immediate heuristics (payee age, scam keywords, device history, amount, velocity, off-hours).
   - **Behavioral Baseline**: Queries prior account history ($N \ge 3$, excluding the evaluated transaction) to measure deviations in transfer amount, contextual velocity, payee familiarity, timing, and channel.
3. **Authoritative Composite Synthesis**: The server computes $\text{Composite Score} = \min(100, \text{Static} + \text{Behavioral})$, derives the authoritative risk band (Green / Amber / Red), and sets the default recommended action.
4. **AI Narrative Generation**: The server passes the composite verdict and baseline profile to Claude, Gemini, or the deterministic template fallback to generate an analyst brief and customer call script.
5. **Analyst Review & Audit Persistence**: The analyst reviews the flagged payment in the queue, executes a Hold / Release / Escalate action with a mandatory reason, and the decision is immutably logged to PostgreSQL.

---

## Architecture

```
Inbound Payment (API / UI Modal)
         │
         ▼
Server-Side Runtime Schema Validation (validateCreateTransactionInput)
         │
         ├─────────────────────────────────────────────┐
         ▼                                             ▼
Static Rules Checklist                      Account History Query
`scorePayment(payment)`                   `getCustomerTransactionHistory`
 (6 core deterministic rules)             (Self-excluding; min sample N >= 3)
         │                                             │
         │                                             ▼
         │                                  Behavioral Anomaly Engine
         │                                `evaluateBehavioralAnomalies`
         │                                 (Amount spike, velocity spike,
         │                                  unseen payee, timing, channel)
         │                                             │
         └──────────────────────┬──────────────────────┘
                                ▼
               Authoritative Composite Risk Calculator
                     `calculateCompositeRisk`
              - Composite Score = min(100, Static + Behavioral)
              - Composite Risk Band & Recommended Decision
              - Server-Authoritative Anti-Tampering Guarantee
                                │
         ┌──────────────────────┴──────────────────────┐
         ▼                                             ▼
Supabase PostgreSQL Persistence             AI Explanation Layer
- `transactions` (pending / held / etc)     - Context: Composite Score + Baseline
- `risk_assessments` (composite score +      - Fallback: Claude -> Gemini -> Template
   structured JSONB fired rules)            - Generates Analyst Brief & Call Script
- `audit_logs` (immutable event trail)
         │
         ▼
Analyst Console (Next.js 15 App Router)
- Risk-sorted Pre-Send Queue with full-text search & status/band filters
- Verdict Card with Risk Gauge, Stage Stepper, and Account Baseline Profile
- Interactive Decision Workflow (Hold / Release / Escalate with audit reason)
- Real-time Metrics Strip (amount stopped, status counts)
```

---

## Risk Engine

Every transaction is scored deterministically on the server across two distinct evaluation layers.

### 1. Static Rules Checklist (`src/lib/rules.ts`)

| Warning Sign | Rule ID | Points | Trigger Condition |
|---|---|:---:|---|
| **New payee** | `new_payee` | +30 | Payee known for fewer than 3 days (`payeeAgeDays < 3`). |
| **Fraud-pattern language** | `fraud_keyword` | +30 | Memo text contains urgency/verification scam keywords ("urgent", "verify", "KYC", "refund", "OTP", "blocked", "act now", etc.). |
| **High amount** | `high_amount` | +15 | Payment amount is ₹50,000 or more. |
| **New device** | `new_device` | +15 | Initiated from a device not previously recognized on the account. |
| **High transfer velocity** | `velocity` | +10 | 3 or more transfers reported in 24h context (`transfersIn24h >= 3`). |
| **Off-hours** | `off_hours` | +5 | Initiated before 07:00 or at/after 23:00 local time. |

*Static score is capped at 100 points.*

### 2. Behavioral Anomaly Engine (`src/lib/behavioral/engine.ts`)

When a synthetic demo account has at least 3 historical transactions (excluding the current payment), the engine extracts baseline statistics (median amount, average contextual velocity, known payee list, active operating window, and channel usage) and flags significant deviations:

| Anomaly Signal | Anomaly ID | Points | Trigger Condition & Threshold | Explainable Detail |
|---|---|:---:|---|---|
| **Behavioral amount spike** | `amount_spike` | **+12 to +20** | `amount >= 3.0 * median` AND `(amount - median) >= ₹15,000`. Multipliers $\ge 5.0\times$ yield **+20 pts**; multipliers $\ge 3.0\times$ yield **+12 pts**. | *"Amount ₹75,000 is 4.1x higher than demo account median (₹18,500 over 8 past transactions)."* |
| **Elevated contextual velocity** | `velocity_spike` | **+12** | `transfersIn24h >= 3` AND `transfersIn24h >= 2.0 * baselineContextualAvg`. | *"Contextual velocity of 4 transfers in 24h is 2.0x higher than demo account baseline average (2.0 transfers)."* |
| **Unseen payee for account** | `unseen_payee_for_account` | **+15** | Payee has never been paid before by this demo account AND `amount >= accountMedian`. | *"First-ever transfer to payee 'Suresh Nair' from this demo account (0 matches across 8 historical transactions)."* |
| **Unusual off-hours timing** | `unusual_timing` | **+10** | Initiated in off-hours (<07:00 or $\ge$23:00) deviating by $\ge 2$ hours from historical window, when 100% of historical transfers occurred during business hours. | *"Initiated at 01:00; demo account has exclusively transacted between 09:00 and 18:00 (6 past transactions)."* |
| **Unusual channel switch** | `unusual_channel` | **+8** | Account has 100% exclusive history on one channel ($\ge 3$ transfers, e.g. Bank Transfer) and switches to alternate channel (UPI) for an amount $\ge ₹20,000$. | *"Payment initiated via UPI, whereas 100% of past demo account transfers (5/5) used Bank Transfer."* |

*Behavioral score is capped at 50 points.*

#### Engine Invariants & Safety Guarantees:
- **Strict Self-Exclusion**: The transaction currently being evaluated is excluded from historical baseline queries (`id !== payment.id` and `reference_id !== payment.id`).
- **Cold-Start Safety**: If history contains fewer than 3 transactions, the behavioral score is strictly 0 with status `insufficient_data`, falling back cleanly to static rules without penalizing new accounts.
- **Hierarchical Fallback Scope**: Evaluates `(merchant, initiatedBy)` desk scope first; if fewer than 3 records exist, falls back to merchant-level baseline before defaulting to cold start.

### 3. Composite Risk Calculation (`src/lib/behavioral/composite.ts`)

The final authoritative `ScoreResult` is calculated on the server:

$$\text{Composite Score} = \min(100, \text{Static Score} + \text{Behavioral Score})$$

Risk bands, default recommendations, and typologies are mapped from the composite score:

- 🟢 **Green (0–39): Low risk.** Routine payment. Default recommendation: **Release**.
- 🟠 **Amber (40–69): Elevated.** Requires quick review. Default recommendation: **Hold and call**.
- 🔴 **Red (70–100): High risk.** Critical warning signs. Default recommendation: **Hold and call** (analyst decides whether to escalate).

**Typology Classification:**
- **Impersonation scam** — urgent / verification scam language detected in memo.
- **Mule pattern** — elevated velocity (static `velocity` or `velocity_spike`) combined with an unfamiliar route (`new_payee`, `unseen_payee_for_account`, or `new_device`).
- **Benign** — composite score < 40 with no suspicious pattern.
- **Unclear** — elevated score without matching a single dominant typology.

---

## Human-in-the-Loop Decision Workflow

PreSend treats AI and automation as advisory: final disposition is placed in the hands of fraud analysts.

- **Action Controls**: Analysts can **Release**, **Hold and call**, or **Escalate** any payment directly from the verdict view.
- **Mandatory Decision Rationale**: Every decision requires a recorded reason, supported by one-click suggestions (e.g., *"Confirmed with customer via out-of-band call"*, *"Beneficiary verified against vendor master"*).
- **Persistent State & Audit Log**:
  - Updates `transactions.status` (`released`, `held`, `escalated`).
  - Records the decision in `analyst_decisions` with timestamp and analyst identifier.
  - Appends an immutable event to `audit_logs`.
- **Live Metrics Strip**: Real-time counter tracks funds protected before settlement (INR sum of held + escalated transactions) alongside queue status tallies.

---

## AI Explanation Layer

The AI layer serves strictly as an explainability and translation bridge. It receives the server-computed composite verdict and baseline profile, and **never computes or alters risk scores, bands, or rules**.

```
Server Verdict & Account Baseline Profile
                   │
                   ▼
       1. Anthropic (Claude 3.5 Sonnet)
                   │ (fallback on missing key or network error)
                   ▼
       2. Google Gemini (Gemini 2.0 Flash)
                   │ (fallback on missing key or failure)
                   ▼
       3. Deterministic Template Fallback (src/lib/template.ts)
```

- **Generated Artifacts**:
  1. **Analyst Brief**: 2–3 plain-English sentences summarizing the risk verdict and baseline deviations.
  2. **Customer Call Script**: Numbered verification questions tailored to the triggered signals for analyst use on out-of-band calls.
- **Zero-Dependency Resilience**: The platform functions 100% reliably without external API keys, seamlessly using the deterministic template fallback.
- **Audit Source Tagging**: Every narrative is labeled with its origin (`source: "model"` or `source: "rules"`).

---

## Security & Server Authority

- **Zero-Trust Server Authority**: Inbound requests to `POST /api/transactions` and `POST /api/triage` strip any client-supplied `score`, `band`, `typology`, `behavioralScore`, or `assessment` fields. All risk calculations occur strictly on the server.
- **Credential Isolation**: `SUPABASE_SERVICE_ROLE_KEY` is accessible exclusively to server-side routes and repository methods. Execution guards (`getServiceSupabaseClient()`) throw an immediate error if initialized in a browser context.
- **Row-Level Security (RLS)**: Enabled across all Supabase PostgreSQL tables (`transactions`, `risk_assessments`, `analyst_decisions`, `audit_logs`).
- **Runtime Input Validation**: All API inputs are sanitized and validated using strict boundary schemas (`validateCreateTransactionInput`, `validateDecisionInput`, `validateTriageInput`).

---

## Tech Stack

- **Framework**: [Next.js 15](https://nextjs.org/) (App Router, React Server Components, Route Handlers)
- **UI & Styling**: React 19 + [Tailwind CSS v4](https://tailwindcss.com/)
- **Database & Persistence**: [Supabase](https://supabase.com/) (PostgreSQL 15) with connection pooling and RLS
- **Language**: TypeScript (strict mode, zero `any` leaks)
- **AI SDKs**: `@anthropic-ai/sdk` (Claude) and `@google/generative-ai` (Gemini)
- **Test Runner**: Node.js built-in test runner (`node --test`) via `tsx`

---

## Project Structure

```
src/
  lib/
    types.ts                  # domain interfaces, baseline types, and union rule IDs
    rules.ts                  # core static deterministic checklist (6 rules)
    rules.test.ts             # unit tests for static rules & thresholds
    format.ts                 # currency (INR), time, and risk-band formatters
    seed.ts                   # 18 synthetic demo transactions across 4 fake merchants
    queue.ts                  # queue risk sorting and multi-criteria filter functions
    queue.test.ts             # unit tests for queue sorting, search, and filters
    validation.ts             # server-side runtime payload validation schemas
    validation.test.ts        # unit tests for validation boundaries and edge cases
    template.ts               # deterministic template fallback narrative generator
    behavioral/
      engine.ts               # behavioral anomaly engine & baseline extraction
      engine.test.ts          # unit tests for baseline math, self-exclusion, & 5 signals
      composite.ts            # composite score calculator & typology classifier
      composite.test.ts       # unit tests for score combining, band mapping, & capping
    db/
      client.ts               # server-only Supabase client with security guards
      types.ts                # PostgreSQL schema types and domain <-> DB mappers
      repository.ts           # database access layer & offline seed fallback
      db.test.ts              # unit tests for domain mappers & credential safety
      schema.sql              # in-tree reference DDL and indexes
    ai/
      triage.ts               # LLM explanation pipeline (Claude -> Gemini -> template)
  app/
    page.tsx                  # main analyst console (client component orchestrator)
    layout.tsx                # root HTML structure and font configuration
    globals.css               # global styling tokens and Tailwind imports
    api/
      transactions/
        route.ts              # POST create transaction & GET queue list
        route.test.ts         # integration tests for POST/GET transactions
      decisions/
        route.ts              # POST human analyst decision workflow
        route.test.ts         # integration tests for decision persistence & audit
      triage/
        route.ts              # POST composite scoring & AI narrative endpoint
        route.test.ts         # integration tests for server authority & AI triage
  components/
    PaymentQueue.tsx          # pre-send queue with search & multi-criteria filters
    VerdictCard.tsx           # risk gauge, baseline profile, signals, and analyst actions
    NewTransactionModal.tsx   # modal for submitting new payments with presets
    MetricsStrip.tsx          # live funds protected tally & status counters
    AuditLog.tsx              # chronological immutable decision trail
    RiskGauge.tsx             # SVG gauge visualizing 0-100 risk score
    TrustFooter.tsx           # agentic principles and Indian payments context
supabase/
  migrations/
    20260919_initial_schema.sql       # core tables (transactions, assessments, decisions, audit)
    20260919_behavioral_indexes.sql   # compound index for customer history baseline lookups
```

---

## Local Setup

### 1. Clone & Install Dependencies

```bash
git clone https://github.com/sharmaBhumika101/PreSend.git
cd PreSend
npm install
```

### 2. Run in Demo Mode (Zero Setup)

PreSend runs out-of-the-box with zero external dependencies:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser. All transactions, behavioral baselines, queue filtering, and template narratives function in memory using synthetic demo seed data.

### 3. Connect Supabase & AI Models (Optional)

To enable persistent database storage and live model narratives, copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Configure credentials in `.env.local`:

```bash
# Supabase Configuration (Database Persistence)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key

# AI Model Configuration (Optional)
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=AIzaSy...
```

If connecting Supabase, apply the SQL migrations in order via the Supabase SQL Editor:
1. `supabase/migrations/20260919_initial_schema.sql`
2. `supabase/migrations/20260919_behavioral_indexes.sql`

---

## Testing & Verification

Run the full automated test suite:

```bash
npm test
```

**129 automated tests pass across 23 test suites**, covering:
- **Behavioral Anomaly Detection**: Math helpers, cold-start safety, self-exclusion, all 5 anomaly signals, score capping, determinism.
- **Composite Risk Calculation**: Additive scoring, band thresholds, default recommendations, typology mapping, anti-tampering.
- **Core Static Rules**: Exact thresholds for amount, payee age, velocity, off-hours, scam keywords, point caps.
- **Runtime Schema Validation**: Type checks, positive amounts, valid hours, string trimming, boundary values.
- **Queue Behavior**: Risk sorting, case-insensitive search by merchant/payee/ID, status & band filters.
- **Database Layer & Security**: Domain mappers, credential isolation, server-only execution guards, service key protection.
- **API Endpoints**: `POST /api/transactions`, `GET /api/transactions`, `POST /api/decisions`, `POST /api/triage`.

Verify strict TypeScript compilation:

```bash
npx tsc --noEmit
```

Verify the production build:

```bash
npm run build
```

---

## Demo Limitations / Synthetic Data Notice

- **Synthetic Accounts & Transactions**: All merchants, internal accounts, payees, transaction records, and historical baselines are synthetic demo data created for demonstration and testing.
- **Account Identity Scope**: `(merchant, initiatedBy)` (e.g., `Chai Point Retail` & `Store Ops Account`) represents a synthetic demo account identity. In a live production deployment, this maps to a KYC-verified merchant ID, virtual account number (VAN), or authenticated API key.
- **Contextual Velocity vs. Persisted Frequency**: The `transfersIn24h` field is a synthetic *contextual velocity* attribute supplied with the inbound transaction payload (simulating client-side telemetry or payment gateway metadata). It is compared against the demo account's historical average contextual velocity, clearly distinguished from true database-derived transaction frequency (which counts persisted transaction timestamps over a 24-hour window).
- **No Live Banking Integration**: This project is a demonstration triage console and does not connect to live banking networks or automated payment switches.

---

## License

MIT
