# PreSend

**A pre-send fraud triage console for a payments platform.**

Before an outbound payment (UPI or bank transfer) leaves the platform, PreSend evaluates it against a deterministic static checklist and account-level behavioral anomaly baselines, explains the verdict in plain English, and provides human fraud analysts with a one-click Hold / Release / Escalate decision workflow — with every action immutably logged.

Designed for an Indian payments platform context (supporting UPI and Bank Transfer channels). Works in dual modes: with full **Supabase PostgreSQL** persistence, or in an offline **zero-setup synthetic demo mode**.

---

> [!NOTE]
> ### Notice on Synthetic / Demo Data
> - **Synthetic Accounts & Transactions**: All merchants, internal accounts, payees, transaction records, and historical baselines are synthetic demo data created for demonstration and testing.
> - **Account Identity Scope**: `(merchant, initiatedBy)` (e.g. `Chai Point Retail` & `Store Ops Account`) represents a synthetic demo account identity. In a live production deployment, this maps to a KYC-verified merchant ID, virtual account number (VAN), or authenticated API key.
> - **Contextual Velocity vs. Persisted Frequency**: The `transfersIn24h` field is a synthetic *contextual velocity* attribute supplied with the inbound transaction payload (simulating client-side telemetry or payment gateway metadata). It is compared against the demo account's historical average contextual velocity, clearly distinguished from true database-derived transaction frequency (which counts persisted transaction timestamps over a 24-hour window).

---

## Architecture Overview

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

## How the Scoring Engine Works

Every payment is scored independently and deterministically on the server across two layers: the **Static Rules Checklist** and the **Behavioral Anomaly Engine**.

### 1. Core Static Rules Checklist (`src/lib/rules.ts`)

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

When a synthetic demo account has at least 3 historical transactions (excluding the current payment under review), the behavioral engine extracts account baseline statistics (median transfer amount, contextual velocity average, known payee set, operating hour window, and channel history) and evaluates deviations:

| Anomaly Signal | Anomaly ID | Points | Trigger Condition & Threshold | Explainable Output Detail |
|---|---|:---:|---|---|
| **Behavioral amount spike** | `amount_spike` | **+12 to +20** | `amount >= 3.0 * median` AND `(amount - median) >= ₹15,000`. Multipliers $\ge 5.0\times$ yield **+20 pts**; multipliers $\ge 3.0\times$ yield **+12 pts**. | *"Amount ₹75,000 is 4.1x higher than demo account median (₹18,500 over 8 past transactions)."* |
| **Elevated contextual velocity** | `velocity_spike` | **+12** | `transfersIn24h >= 3` AND `transfersIn24h >= 2.0 * baselineContextualAvg`. | *"Contextual velocity of 4 transfers in 24h is 2.0x higher than demo account baseline average (2.0 transfers)."* |
| **Unseen payee for account** | `unseen_payee_for_account` | **+15** | Payee has never been paid before by this demo account AND `amount >= accountMedian`. | *"First-ever transfer to payee 'Suresh Nair' from this demo account (0 matches across 8 historical transactions)."* |
| **Unusual off-hours timing** | `unusual_timing` | **+10** | Transaction initiated in off-hours (<07:00 or $\ge$23:00) deviating by $\ge 2$ hours from historical window, when 100% of historical transfers occurred during business hours. | *"Initiated at 01:00; demo account has exclusively transacted between 09:00 and 18:00 (6 past transactions)."* |
| **Unusual channel switch** | `unusual_channel` | **+8** | Account has 100% exclusive history on one channel ($\ge 3$ transfers, e.g. Bank Transfer) and switches to alternate channel (UPI) for an amount $\ge ₹20,000$. | *"Payment initiated via UPI, whereas 100% of past demo account transfers (5/5) used Bank Transfer."* |

*Behavioral score is capped at 50 points.*

#### Invariants & Safety Guarantees:
- **Strict Self-Exclusion**: The transaction currently being evaluated is filtered out of history (`id !== payment.id` and `reference_id !== payment.id`).
- **Cold-Start Safety**: If history contains fewer than 3 transactions, the behavioral score is strictly 0 with status `insufficient_data`, falling back 100% to core static rules without penalizing the customer.
- **Hierarchical Fallback Scope**: Evaluates `(merchant, initiatedBy)` desk scope first; if fewer than 3 records exist, falls back to merchant-level baseline before falling back to cold start.

### 3. Authoritative Composite Risk Calculation (`src/lib/behavioral/composite.ts`)

The final authoritative `ScoreResult` is strictly computed from:

$$\text{Composite Score} = \min(100, \text{Static Score} + \text{Behavioral Score})$$

Risk bands, recommendations, and typologies are mapped from the composite score:

- 🟢 **Green (0–39): Low risk.** Routine payment. Default recommendation: **Release**.
- 🟠 **Amber (40–69): Elevated.** Requires quick review. Default recommendation: **Hold and call**.
- 🔴 **Red (70–100): High risk.** Critical warning signs. Default recommendation: **Hold and call** (analyst decides whether to escalate).

**Typology Classification:**
- **Impersonation scam** — urgent / verification scam language detected in the memo.
- **Mule pattern** — elevated velocity (static `velocity` or `velocity_spike`) combined with an unfamiliar route (`new_payee`, `unseen_payee_for_account`, or `new_device`).
- **Benign** — composite score < 40 with no suspicious pattern.
- **Unclear** — elevated score without matching a single dominant typology.

---

## Server Authority & Anti-Tampering

PreSend implements strict zero-trust server authority:
- **Client Score Stripping**: Any client-submitted `score`, `band`, `typology`, `behavioralScore`, or `assessment` object in `POST /api/transactions` or `POST /api/triage` is strictly ignored and discarded.
- **Server-Only Verification**: All scores, bands, typologies, recommendations, and baseline metrics are computed exclusively on the server.
- **Security Boundaries**: `SUPABASE_SERVICE_ROLE_KEY` is accessible only to server-side routes and repository methods; client-side execution is guarded and blocked (`getServiceSupabaseClient()` throws if simulated in a browser environment).
- **Row-Level Security (RLS)**: Enabled across all four Supabase tables (`transactions`, `risk_assessments`, `analyst_decisions`, `audit_logs`).

---

## AI Explanation Pipeline (`src/lib/ai/triage.ts`)

The AI layer never calculates or alters fraud scores, bands, or rules. It acts solely as an explainability and translation layer, receiving the server-computed composite verdict and account baseline profile.

```
Server Verdict & Account Baseline Profile
                   │
                   ▼
       1. Anthropic (Claude Sonnet 4.5)
                   │ (fallback on missing key or network error)
                   ▼
       2. Google Gemini (Gemini 2.0 Flash)
                   │ (fallback on missing key or failure)
                   ▼
       3. Deterministic Template Fallback (src/lib/template.ts)
```

- **Output**:
  1. **Analyst Brief**: 2–3 plain-English sentences explaining the verdict and highlighting baseline deviations.
  2. **Call Script**: Numbered lines an analyst can read aloud to the customer on a verification call.
- **Resilience**: The app is 100% functional with zero API keys configured, running reliably on the deterministic template generator.
- **Audit Traceability**: Every brief is tagged with `source: "model"` or `source: "rules"`.

---

## Console Features & Analyst Workflow

1. **Pre-Send Queue (`PaymentQueue.tsx`)**:
   - Ranked by risk score (descending).
   - Real-time client-side search across Merchant, Payee, and Transaction ID.
   - Status filters: `All`, `Pending`, `Released`, `Held`, `Escalated`.
   - Risk-band filters: `Red`, `Amber`, `Green`.
   - Visual badges: Merchant bank badges, channel, risk dots, and purple anomaly indicators (`+15 Anomaly`).
2. **New Transaction Modal (`NewTransactionModal.tsx`)**:
   - Interactive modal to submit new outbound transactions.
   - Quick-fill presets: *Benign routine vendor*, *Urgent KYC impersonation*, *Fast mule fan-out*, *High-value supplier*.
   - Strict runtime schema validation with user-friendly error banners.
3. **Verdict & Anomaly Breakdown (`VerdictCard.tsx`)**:
   - Visual Risk Gauge (0–100) and lifecycle stepper (Submitted $\to$ Analyst gate $\to$ Settled).
   - Structured From / To / Channel / Device / Memo detail grid.
   - **Account Behavioral Baseline Profile**: Shows historical sample size, median amount comparison, velocity baseline, payee history, operating window, and behavioral score contribution.
   - **Fired Signals List**: Clearly differentiates `Core Rule` from `Behavioral Anomaly` badges.
   - Human analyst action buttons (**Release**, **Hold and call**, **Escalate**) with suggested action pre-selected.
4. **Analyst Decision Capture**:
   - Modal prompt capturing mandatory decision reasons with one-click suggestions.
   - Persists to `analyst_decisions`, updates `transactions.status`, and writes an immutable audit record.
5. **Live Metrics Strip (`MetricsStrip.tsx`)**:
   - Live tally of funds stopped before settlement (INR sum of held + escalated payments).
   - Counters for pending review, held, escalated, and released payments.
6. **Audit Trail (`AuditLog.tsx`)**:
   - Chronological log of all analyst decisions and system events with timestamps, composite scores, bands, actors, and reasons.

---

## Tech Stack

- **Framework**: [Next.js 15](https://nextjs.org/) (App Router, React Server Components & API routes)
- **UI & Styling**: React 19 + [Tailwind CSS v4](https://tailwindcss.com/)
- **Database & Persistence**: [Supabase](https://supabase.com/) (PostgreSQL 15) with connection pooling and RLS
- **Language**: TypeScript (strict mode enabled, zero `any` leaks)
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
    PaymentQueue.tsx          # left column: pre-send queue with search & filters
    VerdictCard.tsx           # center column: gauge, baseline profile, signals, actions
    NewTransactionModal.tsx   # interactive modal for submitting new transactions
    MetricsStrip.tsx          # top right: funds protected & status counts
    AuditLog.tsx              # bottom right: immutable decision history
    RiskGauge.tsx             # SVG gauge visualizing 0-100 risk score
    TrustFooter.tsx           # footer: agentic principles & UPI regulatory context
supabase/
  migrations/
    20260919_initial_schema.sql       # core tables (transactions, assessments, decisions, audit)
    20260919_behavioral_indexes.sql   # compound index for customer history baseline lookups
```

---

## Local Setup & Development

### 1. Clone & Install Dependencies

```bash
git clone https://github.com/sharmaBhumika101/PreSend.git
cd PreSend
npm install
```

### 2. Run in Demo Mode (Zero Setup)

PreSend runs out-of-the-box with zero configuration:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser. All transactions, behavioral baselines, queue filtering, and template narratives function immediately in memory using synthetic demo seed data.

### 3. Connect Supabase & AI Models (Optional)

To enable persistent database storage and live AI model briefs, copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Configure your credentials in `.env.local`:

```bash
# Supabase Configuration (Database Persistence)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key

# AI Model Configuration (Optional)
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=AIzaSy...
```

If using Supabase, apply the SQL migrations in order via the Supabase SQL Editor:
1. `supabase/migrations/20260919_initial_schema.sql`
2. `supabase/migrations/20260919_behavioral_indexes.sql`

---

## Running the Verification Suite

Run the full automated test suite:

```bash
npm test
```

**129 automated tests pass across 23 test suites**, verifying:
- **Behavioral Anomaly Detection** (math helpers, cold-start safety, self-exclusion, all 5 anomaly signals, score capping, determinism)
- **Composite Risk Calculation** (additive scoring, band thresholds, default recommendations, typology mapping, anti-tampering)
- **Core Static Rules** (exact thresholds for amount, payee age, velocity, off-hours, scam keywords, point caps)
- **Runtime Schema Validation** (type checks, positive amounts, valid hours, string trimming, boundary values)
- **Queue Behavior** (risk sorting, case-insensitive search by merchant/payee/ID, status & band filters)
- **Database Layer & Security** (domain mappers, credential isolation, server-only execution guards, service key protection)
- **API Endpoints** (`POST /api/transactions`, `GET /api/transactions`, `POST /api/decisions`, `POST /api/triage`)

Verify strict TypeScript compilation:

```bash
npx tsc --noEmit
```

Verify the production build:

```bash
npm run build
```

---

## License

MIT
