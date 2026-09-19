# PreSend

**A pre-send fraud triage console for a payments platform.**

Before an outbound payment (UPI or bank transfer) leaves the platform,
PreSend scores it, explains *why* in plain English, and gives an analyst a
one-click Hold / Release / Escalate decision — with every decision logged.

Built for a Razorpay-style payments platform operating in India. No
database, no accounts: everything runs from a seeded, in-memory demo so it
can be reviewed in a browser with zero setup.

---

## How the scoring works (Static Rules + Behavioral Anomaly Engine)

Every pending payment starts with a baseline evaluation from two pure, deterministic layers:

1. **Static Rules Engine** (`src/lib/rules.ts`): Evaluates core payload signals against standard fraud checklists.
2. **Behavioral Anomaly Engine** (`src/lib/behavioral/engine.ts`): Evaluates deviations against the demo account's historical baseline (median amounts, contextual velocity, payee novelty, operating hours, payment channels).

> **Important Notes on Account Identity & Contextual Velocity:**
> - **Synthetic / Demo Account Identity**: In this demo environment, `(merchant, initiatedBy)` explicitly represents a synthetic demo account identity (e.g. `Chai Point Retail - Store Ops Account`), not a real customer identity. In a production payments platform, this would map to a KYC-verified merchant ID, virtual account number (VAN), or authenticated API key.
> - **Contextual Velocity vs. Database Frequency**: The `transfersIn24h` field is a synthetic *contextual velocity* attribute reported with the inbound payment payload (simulating real-time telemetry or client context). It is compared against the demo account's historical average contextual velocity. It is clearly distinguished from true database-derived transaction frequency (which counts persisted transaction timestamps within a 24-hour window).

### Core Static Rules Checklist

| Warning sign | Points | What it means |
|---|---|---|
| **New payee** | +30 | This is the first time (or within 3 days) the merchant has ever paid this person. |
| **Scam-style language in the note** | +30 | The payment note uses words scammers use to create panic — "urgent", "verify", "KYC", "refund", "OTP", "suspended", "act now", etc. |
| **Large amount** | +15 | The payment is ₹50,000 or more. |
| **New device** | +15 | Whoever sent this payment is using a device the account hasn't used before. |
| **High contextual velocity** | +10 | 3 or more payments reported in the last 24h context (`transfersIn24h >= 3`). |
| **Odd hour** | +5 | The payment was made before 7am or after 11pm (outside 07:00–23:00). |

### Deterministic Behavioral Anomaly Signals

When an account has at least 3 historical transactions (excluding the payment under review), the behavioral engine evaluates:

| Anomaly Signal | Points | Condition |
|---|---|---|
| **Behavioral amount spike** | +12 to +20 | `amount >= 3.0 * median` and `(amount - median) >= ₹15,000` (+20 pts if `amount >= 5.0 * median`, +12 pts if `>= 3.0 * median`). |
| **Elevated contextual velocity** | +12 | `transfersIn24h >= 3` and `transfersIn24h >= 2.0 * baselineContextualAvg`. |
| **Unseen payee for account** | +15 | Payee has never been paid before by this demo account AND `amount >= accountMedian`. |
| **Unusual off-hours timing** | +10 | Off-hours transaction (before 7am / after 11pm) that deviates by >= 2h from historical window, when account history is 100% daytime. |
| **Unusual channel switch** | +8 | Switching from a 100% exclusive channel (e.g. Bank Transfer) to an alternate channel (UPI) for an amount >= ₹20,000. |

*Behavioral score is capped at 50 points. For cold-start demo accounts (< 3 historical transactions), behavioral score is 0 with status `insufficient_data` without penalizing the customer.*

### Composite Score & Risk Bands

The final authoritative `ScoreResult` is strictly recomputed from:
$$\text{Composite Score} = \min(100, \text{Static Score} + \text{Behavioral Score})$$

The final score, risk band, recommendation, and displayed score all correspond to this composite server-calculated score:

- 🟢 **Green (0–39): Low risk.** Safe to send. Default suggestion: **Release**.
- 🟠 **Amber (40–69): Elevated.** Manual review recommended before release. Default suggestion: **Hold and call**.
- 🔴 **Red (70–100): High risk.** Hold and verify with the customer. Default suggestion: **Hold and call**.

PreSend also labels what kind of risk it looks like:
- **Impersonation scam** — memo contains panic/urgency keywords.
- **Mule pattern** — rapid velocity (static or behavioral spike) combined with unfamiliar routes (new payee, unseen payee, or new device).
- **Benign** — composite score < 40 with no suspicious pattern.
- **Unclear** — elevated score without matching a single dominant typology.

**Server Authority & Anti-Tampering:**
Nothing here is decided by AI or trusted from the client. The final score is computed authoritatively on the server. Client-provided scores, bands, or typologies are strictly ignored and discarded.

---

## What the AI layer actually does

Once the rules engine has produced a score, band, typology, and the list of
which warning signs fired, that verdict — never the raw decision-making
power — is handed to an LLM whose only job is to turn it into two things:

1. A 2–3 sentence **analyst brief** explaining the verdict in plain English.
2. A short **call script** the analyst could read to the customer on a call.

The model is explicitly told the score is "already computed, ground truth"
and instructed not to recompute or contradict it. It responds with strict
JSON only.

**Provider chain, in order, all automatic:**

1. **Claude (Anthropic)** — primary.
2. **Gemini (Google)** — used only if the Claude call fails for any reason
   (no key, network error, bad response).
3. **Hardcoded template** — a deterministic sentence-builder
   ([`src/lib/template.ts`](src/lib/template.ts)) used if both model calls
   fail or no API keys are configured at all.

Every response is tagged `source: "model"` (came from Claude or Gemini) or
`source: "rules"` (came from the template), and that tag is shown in the UI
and logged in the audit trail. **The app is fully functional with zero API
keys** — it just runs entirely on `source: "rules"` narratives.

---

## Using the console

- **Left column** — the pre-send queue, sorted highest risk first. Each row
  shows a colored risk dot, a bank-style merchant badge, the payee, and
  which internal account/desk initiated the payment.
- **Center** — the selected payment's verdict: a risk-band label, a
  lifecycle stepper (Submitted → Analyst gate → Settled) with a note on
  whether the channel is recallable, the risk gauge, typology badge, a
  structured From / To / Amount / Channel / Device / Memo grid, the fired
  signals (always visible with full explanations, not hidden behind
  hover), the analyst brief (opening with a deterministic one-line
  recommendation, never LLM-dependent), and a numbered call script.
  **Release / Hold and call / Escalate** buttons record a decision — the
  rules engine's suggested action is highlighted, but the analyst can
  always choose differently.
- **Right column** — a live metrics strip (amount stopped before
  settlement, plus pending / held / escalated / released counts) and a
  running audit log of every decision, with timestamp, score, and
  narrative source.
- **Footer** — real, sourced context on UPI's scale and fraud losses in
  India, three agentic-safety principles (human accountable, least
  privilege, logged activity), and a note on the regulatory framing.

---

## Tech stack

- **Next.js 15** (App Router) + **React 19** + **TypeScript** (strict mode)
- **Tailwind CSS v4**
- **Supabase (PostgreSQL)** — persistent transactions, risk assessments, analyst decisions, and audit trail with offline synthetic seed fallback
- `@anthropic-ai/sdk` (primary LLM) + `@google/generative-ai` (fallback LLM)
- Pure deterministic behavioral anomaly engine + static rules checklist
- Deploys to **Vercel** as-is

## Project structure

```
src/
  lib/
    types.ts                # shared domain types & baseline interfaces
    rules.ts                # static deterministic rulebook
    behavioral/
      engine.ts             # deterministic behavioral anomaly engine & baseline extraction
      composite.ts          # authoritative composite score & band calculation
    db/
      client.ts             # server-only Supabase client with security guards
      repository.ts         # persistent data access, history lookups & seed fallback
      types.ts              # database models, schema types & domain mappers
    ai/
      triage.ts             # LLM explanation layer: Claude -> Gemini -> template
    template.ts             # hardcoded fallback narrative generator
    queue.ts                # queue sorting and multi-criteria filtering
    validation.ts           # server-side runtime payload schema validators
    seed.ts                 # 18 synthetic pending payments across demo merchants
    format.ts               # currency/time/risk-band display helpers
  app/
    page.tsx                # the console (queue, verdict, metrics, audit log, modal)
    api/
      transactions/route.ts # POST create transaction & GET queue list
      decisions/route.ts    # POST human analyst decision workflow
      triage/route.ts       # POST authoritative composite scoring & AI narrative
  components/
    PaymentQueue.tsx, VerdictCard.tsx, RiskGauge.tsx,
    NewTransactionModal.tsx, MetricsStrip.tsx, AuditLog.tsx, TrustFooter.tsx
supabase/
  migrations/
    20260919_initial_schema.sql       # PostgreSQL DDL, constraints & RLS policies
    20260919_behavioral_indexes.sql   # compound index for customer baseline lookups
```

## Running it locally

```bash
npm install
npm run dev
```

Open http://localhost:3000 — works immediately, no `.env` file required.

To turn on real model-generated briefs, copy `.env.example` to `.env.local`
and set `ANTHROPIC_API_KEY` (and optionally `GEMINI_API_KEY` as a fallback).
To enable persistent Supabase storage, set `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

## Running the test suite

```bash
npm test
```

129 tests across 23 test suites using Node's built-in test runner, covering:
- Behavioral anomaly detection (cold start, self-exclusion, all 5 signals, score capping)
- Composite risk calculation and risk band recomputation
- Static rules thresholds, typologies, and point caps
- Server-side runtime validation schemas
- Queue risk sorting, search, and multi-criteria filters
- Server authority and anti-tampering guarantees (preventing client-spoofed scores or assessments)
- Database mappers, client safety, and credential isolation

## Deploying

Push to a Git repo and import it into Vercel — zero configuration required.
Add `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` as environment variables in the
Vercel project settings if you want live model narratives; otherwise it
runs on the template fallback out of the box.
