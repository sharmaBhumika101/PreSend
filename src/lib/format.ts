import type { Decision, RiskBand } from "./types";

export function formatINR(amount: number): string {
  return `\u20b9${amount.toLocaleString("en-IN")}`;
}

export function formatClock(hourOfDay: number): string {
  const h = hourOfDay % 24;
  const period = h < 12 ? "AM" : "PM";
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}:00 ${period}`;
}

export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function formatToday(): string {
  return new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/** A short 2-4 letter badge from a merchant name, e.g. "Chai Point Retail"
 * -> "CPR", for a compact bank-style tag in the queue. */
export function merchantBadge(merchant: string): string {
  const words = merchant.split(/\s+/).filter(Boolean);
  const letters = words.map((w) => w[0]?.toUpperCase() ?? "").join("");
  return letters.slice(0, 4) || merchant.slice(0, 3).toUpperCase();
}

export const RISK_BAND_META: Record<
  RiskBand,
  { label: string; dot: string; text: string; bg: string; ring: string }
> = {
  green: {
    label: "Low risk",
    dot: "bg-risk-green",
    text: "text-risk-green",
    bg: "bg-risk-green-dim",
    ring: "stroke-risk-green",
  },
  amber: {
    label: "Elevated",
    dot: "bg-risk-amber",
    text: "text-risk-amber",
    bg: "bg-risk-amber-dim",
    ring: "stroke-risk-amber",
  },
  red: {
    label: "High risk",
    dot: "bg-risk-red",
    text: "text-risk-red",
    bg: "bg-risk-red-dim",
    ring: "stroke-risk-red",
  },
};

export const DECISION_META: Record<Decision, { label: string; buttonLabel: string }> = {
  release: { label: "released", buttonLabel: "Release" },
  hold: { label: "held", buttonLabel: "Hold and call" },
  escalate: { label: "escalated", buttonLabel: "Escalate" },
};

/** Builds the one-line, deterministic lead sentence for the verdict card —
 * e.g. "Hold ₹82,000 UPI: pattern matches impersonation scam." This never
 * depends on the LLM, so the analyst always sees a clear, correctly-worded
 * recommendation even if both model calls and the template were somehow
 * unavailable. */
export function buildLeadLine(
  recommendedDecision: Decision,
  amount: number,
  channel: string,
  typology: string
): string {
  const actionVerb: Record<Decision, string> = {
    hold: "Hold",
    release: "Clear for release",
    escalate: "Escalate",
  };
  const suffix = typology === "benign" ? "no risk pattern matched." : `pattern matches ${typology}.`;
  return `${actionVerb[recommendedDecision]} ${formatINR(amount)} ${channel}: ${suffix}`;
}
