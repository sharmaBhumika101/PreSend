# PreSend

**A pre-send fraud triage console for a payments platform.**

Before an outbound payment (UPI or bank transfer) leaves the platform,
PreSend scores it, explains *why* in plain English, and gives an analyst a
one-click Hold / Release / Escalate decision — with every decision logged.

Built for a Razorpay-style payments platform operating in India. No
database, no accounts: everything runs from a seeded, in-memory demo so it
can be reviewed in a browser with zero setup.

---

## How the scoring works (read this in under a minute)

Every pending payment starts at **0 points**. A short checklist of six
warning signs adds points if they're true for that payment. Nothing here is
guessed or written by AI — it's simple addition, the same every time.

| Warning sign | Points | What it means |
|---|---|---|
| **New payee** | +30 | This is the first time (or within 3 days) the merchant has ever paid this person. |
| **Scam-style language in the note** | +30 | The payment note uses words scammers use to create panic — "urgent", "verify", "KYC", "refund", "OTP", "suspended", "act now", etc. |
| **Large amount** | +15 | The payment is ₹50,000 or more. |
| **New device** | +15 | Whoever sent this payment is using a device the account hasn't used before. |
| **Sending money fast, repeatedly** | +10 | 3 or more payments have already gone out from this account in the last 24 hours. |
| **Odd hour** | +5 | The payment was made before 7am or after 11pm. |

The points add up (maximum 100) and land the payment in a **band**:

- 🟢 **Green (0–39): Low risk.** Nothing unusual — safe to send. Default suggestion: **Release**.
- 🟠 **Amber (40–69): Elevated.** A quick check is worth doing before release. Default suggestion: **Hold and call**.
- 🔴 **Red (70+): High risk.** Hold and verify with the customer before anything moves. Default suggestion: **Hold and call**.

Note that red never auto-suggests "Escalate" — escalation is reserved for
cases an analyst has actually confirmed as fraud, typically after reading
the call script. The suggestion is shown as "Recommended: X. The analyst
decides." and the analyst can always choose differently; whichever button
they click is what's written to the audit log.

PreSend also labels *what kind* of risk it looks like, using the same
warning signs:

- **Impersonation scam** — the note itself uses urgent/verify language. This
  is the classic "your KYC will be blocked, verify now" scam script.
- **Mule pattern** — money is moving fast, to someone unfamiliar, from an
  unfamiliar device — but *without* scammy language. This looks like a
  compromised account quietly funnelling money out.
- **Benign** — nothing meaningful triggered.
- **Unclear** — some points were added, but not enough of one pattern to
  call it confidently.

**Nothing here is decided by AI.** The score, the band, and the label are
all produced by one plain TypeScript function
([`src/lib/rules.ts`](src/lib/rules.ts)) that a person can read top to
bottom. The AI layer described below is only ever handed *the result* of
this checklist — it explains the verdict, it never invents one. This is
also why a benign payment can never be scored red: the rules are the only
thing that can move the number, and they're all here in this one table.

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
- `@anthropic-ai/sdk` (primary LLM) + `@google/generative-ai` (fallback LLM)
- No database — all state lives in React state, seeded on load
- Deploys to **Vercel** as-is

## Project structure

```
src/
  lib/
    types.ts           # shared domain types
    rules.ts            # the deterministic scoring engine (read this first)
    rules.test.ts        # unit tests for the scoring engine
    template.ts           # hardcoded fallback narrative generator
    seed.ts                # 18 synthetic pending payments, 4 fake merchants
    format.ts                # currency/time/risk-band display helpers
  app/
    page.tsx              # the console (client component, all state lives here)
    api/triage/route.ts     # LLM layer: Claude -> Gemini -> template
  components/
    PaymentQueue.tsx, VerdictCard.tsx, RiskGauge.tsx,
    MetricsStrip.tsx, AuditLog.tsx, TrustFooter.tsx
```

## Running it locally

```bash
npm install
npm run dev
```

Open http://localhost:3000 — works immediately, no `.env` file required.

To turn on real model-generated briefs, copy `.env.example` to `.env.local`
and set `ANTHROPIC_API_KEY` (and optionally `GEMINI_API_KEY` as a fallback).

## Running the rules engine tests

```bash
npm test
```

26 tests using Node's built-in test runner, covering every rule's exact
threshold, every typology path, the 100-point cap, and — most importantly —
several benign scenarios asserting the score **never** reaches the red band.

## Deploying

Push to a Git repo and import it into Vercel — zero configuration required.
Add `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` as environment variables in the
Vercel project settings if you want live model narratives; otherwise it
runs on the template fallback out of the box.
