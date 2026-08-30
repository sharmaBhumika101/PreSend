// Hardcoded template fallback for the triage narrative layer.
//
// This is what PreSend uses when no LLM key is configured, or when both the
// Anthropic and Gemini calls fail. It builds a brief + call script purely
// from the already-computed ScoreResult — same contract as the model path,
// just template strings instead of a generation call. This is what makes
// the app fully functional with zero API keys.

import type { TriageContext, TriageResult } from "./types";

function formatAmount(amount: number): string {
  return `\u20b9${amount.toLocaleString("en-IN")}`;
}

function ruleList(context: TriageContext): string {
  if (context.score.firedRules.length === 0) return "no risk signals";
  return context.score.firedRules.map((r) => r.label.toLowerCase()).join(", ");
}

export function generateTemplateTriage(context: TriageContext): TriageResult {
  const { payment, score } = context;
  const amount = formatAmount(payment.amount);
  const signals = ruleList(context);

  let brief: string;
  let callScript: string[];

  if (score.band === "red") {
    brief =
      `${payment.payeeName} is receiving ${amount} and this matches a ${score.typology} pattern with a risk score of ${score.score}/100. ` +
      `Strongest signals: ${signals}. Once this settles it typically cannot be recalled, so verifying with the customer before release is worth the two minutes it takes.`;
    callScript = [
      `Hi, this is the fraud prevention team calling about a pending payment of ${amount} to ${payment.payeeName}. We've paused it as a precaution — nothing is wrong with your account.`,
      `Did anyone contact you today asking you to move money urgently, verify your account, or avoid a KYC block?`,
      `No bank or platform will ever ask you to move funds to a "safe account" or verify by paying someone. That request is always a scam.`,
      `Based on what you've told me, we recommend cancelling this payment. Would you like us to do that now?`,
    ];
  } else if (score.band === "amber") {
    brief =
      `${payment.payeeName} is receiving ${amount}, scoring ${score.score}/100 (amber). Some signals are present (${signals}) but nothing conclusive — a quick manual check is worth it before release.`;
    callScript = [
      `Hi, we're doing a routine check on a pending payment of ${amount} to ${payment.payeeName}.`,
      `Can you confirm you recognize this payee and that the amount and account details are correct?`,
      `Thanks — we'll release it now that you've confirmed.`,
    ];
  } else {
    brief =
      `${payment.payeeName} is receiving ${amount}, scoring ${score.score}/100 (green) with ${signals}. Nothing unusual here — safe to release without further checks.`;
    callScript = [
      `This is a routine confirmation for your payment of ${amount} to ${payment.payeeName}. No action needed on your end.`,
    ];
  }

  return { brief, callScript, source: "rules" };
}
