// PreSend rules engine.
//
// This is the ONLY place a fraud score is computed. It is a pure,
// deterministic function of the payment's fields — no network calls, no
// randomness, no LLM. The model layer (src/app/api/triage/route.ts) is only
// ever handed the output of this file; it never sees enough raw signal to
// invent its own score.
//
// Scoring is additive and capped at 100. See README.md for the plain-English
// version of this logic.

import type { Decision, FiredRule, Payment, RiskBand, RuleId, ScoreResult, Typology } from "./types";

/** Amount (INR) at or above which a payment gets the "high amount" points. */
export const HIGH_AMOUNT_THRESHOLD = 50_000;

/** A payee known for fewer than this many days is considered "new". */
export const NEW_PAYEE_DAYS = 3;

/** 3 or more transfers to different payees in 24h reads as fan-out velocity. */
export const VELOCITY_THRESHOLD = 3;

/** Off-hours window: before 7am or at/after 11pm (23:00), local time. */
export const OFF_HOURS_START = 23;
export const OFF_HOURS_END = 7;

export const SCORE_CAP = 100;

export const BAND_THRESHOLDS = {
  amber: 40,
  red: 70,
} as const;

/** Words/phrases commonly used in impersonation & social-engineering scams
 * ("this is urgent, verify your account or KYC will be blocked", etc). Matched
 * case-insensitively as whole words/phrases against the memo text. */
const FRAUD_KEYWORDS = [
  "urgent",
  "verify",
  "verification",
  "refund",
  "kyc",
  "blocked",
  "suspended",
  "otp",
  "immediately",
  "act now",
  "penalty",
  "reactivate",
  "confirm your",
  "final notice",
];

function matchedFraudKeywords(memo: string): string[] {
  const lower = memo.toLowerCase();
  return FRAUD_KEYWORDS.filter((kw) => lower.includes(kw));
}

function isOffHours(hourOfDay: number): boolean {
  return hourOfDay >= OFF_HOURS_START || hourOfDay < OFF_HOURS_END;
}

function bandForScore(score: number): RiskBand {
  if (score >= BAND_THRESHOLDS.red) return "red";
  if (score >= BAND_THRESHOLDS.amber) return "amber";
  return "green";
}

/**
 * The rules engine's default suggestion, shown as "Recommended: X" in the
 * UI. It is only ever a suggestion — the analyst clicks the button, and
 * their decision (which may differ) is what gets logged. Red and amber
 * both default to "hold" rather than "escalate": escalation is reserved
 * for cases the analyst has actually confirmed as fraud, typically after
 * the call script below.
 */
function recommendedDecisionForBand(band: RiskBand): Decision {
  if (band === "green") return "release";
  return "hold";
}

function classifyTypology(fired: Set<RuleId>, score: number): Typology {
  // Language-driven social engineering takes precedence: if the memo itself
  // is doing the manipulating, this is an impersonation scam regardless of
  // what else fired alongside it.
  if (fired.has("fraud_keyword")) {
    return "impersonation scam";
  }

  // Rapid fan-out of funds through an unfamiliar payee or device, without
  // manipulative language, reads as a mule account moving money through.
  const hasVelocity = fired.has("velocity");
  const hasUnfamiliarRoute = fired.has("new_payee") || fired.has("new_device");
  if (hasVelocity && hasUnfamiliarRoute) {
    return "mule pattern";
  }

  if (score < BAND_THRESHOLDS.amber) {
    return "benign";
  }

  return "unclear";
}

/**
 * Score a pending outbound payment against the fraud rulebook.
 *
 * Pure function: same input always produces the same output. Never throws;
 * callers can rely on it as the deterministic ground truth for a payment's
 * risk score, band, and typology.
 */
export function scorePayment(payment: Payment): ScoreResult {
  const fired: FiredRule[] = [];

  if (payment.payeeAgeDays < NEW_PAYEE_DAYS) {
    fired.push({
      id: "new_payee",
      label: "New payee",
      points: 30,
      detail: `Payee first seen ${payment.payeeAgeDays} day(s) ago (< ${NEW_PAYEE_DAYS} day threshold).`,
    });
  }

  const keywords = matchedFraudKeywords(payment.memo);
  if (keywords.length > 0) {
    fired.push({
      id: "fraud_keyword",
      label: "Fraud-pattern language",
      points: 30,
      detail: `Memo contains urgency/verification language: "${keywords.join(", ")}".`,
    });
  }

  if (payment.amount >= HIGH_AMOUNT_THRESHOLD) {
    fired.push({
      id: "high_amount",
      label: "High amount",
      points: 15,
      detail: `Amount ₹${payment.amount.toLocaleString("en-IN")} is at/above the ₹${HIGH_AMOUNT_THRESHOLD.toLocaleString("en-IN")} threshold.`,
    });
  }

  if (payment.deviceIsNew) {
    fired.push({
      id: "new_device",
      label: "New device",
      points: 15,
      detail: "Payment initiated from a device not previously seen on this account.",
    });
  }

  if (payment.transfersIn24h >= VELOCITY_THRESHOLD) {
    fired.push({
      id: "velocity",
      label: "High transfer velocity",
      points: 10,
      detail: `${payment.transfersIn24h} transfers out in the last 24h (>= ${VELOCITY_THRESHOLD} threshold).`,
    });
  }

  if (isOffHours(payment.hourOfDay)) {
    fired.push({
      id: "off_hours",
      label: "Off-hours",
      points: 5,
      detail: `Initiated at ${String(payment.hourOfDay).padStart(2, "0")}:00, outside the 07:00\u201323:00 window.`,
    });
  }

  const rawScore = fired.reduce((sum, rule) => sum + rule.points, 0);
  const score = Math.min(SCORE_CAP, rawScore);
  const band = bandForScore(score);
  const firedIds = new Set(fired.map((r) => r.id));
  const typology = classifyTypology(firedIds, score);
  const recommendedDecision = recommendedDecisionForBand(band);

  return { score, band, typology, firedRules: fired, recommendedDecision };
}
