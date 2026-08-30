"use client";

import type { Decision, Payment, ScoreResult, TriageResult } from "@/lib/types";
import { buildLeadLine, DECISION_META, formatClock, formatINR, RISK_BAND_META } from "@/lib/format";
import { RiskGauge } from "./RiskGauge";

interface VerdictCardProps {
  payment: Payment;
  score: ScoreResult;
  triage: TriageResult | null;
  triageLoading: boolean;
  decision: Decision | null;
  onDecision: (decision: Decision) => void;
}

const TYPOLOGY_META: Record<string, string> = {
  "impersonation scam": "Language in the memo mimics a verification/urgency scam.",
  "mule pattern": "Money moving fast through an unfamiliar payee or device.",
  benign: "No meaningful risk signal detected.",
  unclear: "Some signal present, but no single pattern dominates.",
};

const LIFECYCLE_STAGES = ["Submitted", "Analyst gate", "Settled"] as const;

function irrevocabilityNote(channel: Payment["channel"]): string {
  return channel === "UPI"
    ? "UPI settles in seconds once released and generally cannot be recalled."
    : "Bank transfers may allow a short recall window, but it isn't guaranteed once sent.";
}

// Tailwind's JIT scanner needs full literal class strings, so these are
// spelled out per-decision rather than built with template interpolation.
const DECISION_BUTTON_STYLE: Record<Decision, { recommended: string; muted: string }> = {
  release: {
    recommended: "bg-risk-green text-void hover:brightness-110",
    muted: "border border-risk-green/40 bg-risk-green-dim text-risk-green hover:brightness-125",
  },
  hold: {
    recommended: "bg-risk-amber text-void hover:brightness-110",
    muted: "border border-risk-amber/40 bg-risk-amber-dim text-risk-amber hover:brightness-125",
  },
  escalate: {
    recommended: "bg-risk-red text-void hover:brightness-110",
    muted: "border border-risk-red/40 bg-risk-red-dim text-risk-red hover:brightness-125",
  },
};

function DecisionButton({
  decision,
  isRecommended,
  disabled,
  onClick,
}: {
  decision: Decision;
  isRecommended: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const style = DECISION_BUTTON_STYLE[decision];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex-1 rounded-lg text-sm font-medium py-2.5 transition disabled:opacity-40 disabled:cursor-not-allowed ${
        isRecommended ? style.recommended : style.muted
      }`}
    >
      {DECISION_META[decision].buttonLabel}
    </button>
  );
}

export function VerdictCard({
  payment,
  score,
  triage,
  triageLoading,
  decision,
  onDecision,
}: VerdictCardProps) {
  const meta = RISK_BAND_META[score.band];
  const leadLine = buildLeadLine(score.recommendedDecision, payment.amount, payment.channel, score.typology);
  const currentStageIndex = decision ? 2 : 1;

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-data text-[11px] uppercase tracking-[0.16em] text-ink-faint">
              {payment.id} &middot; {payment.channel} &middot; submitted {formatClock(payment.hourOfDay)}
            </p>
            <h1 className={`text-xl font-semibold mt-1 ${meta.text}`}>{meta.label}</h1>
            <p className="text-sm text-ink-muted mt-0.5">{payment.merchant}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="font-data text-2xl font-semibold tabular-nums text-ink">
              {formatINR(payment.amount)}
            </p>
            {decision && (
              <span className="inline-block mt-1 text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border border-hairline text-ink-muted">
                {DECISION_META[decision].label}
              </span>
            )}
          </div>
        </div>

        {/* Lifecycle stepper */}
        <div>
          <div className="flex items-center">
            {LIFECYCLE_STAGES.map((stage, idx) => (
              <div key={stage} className="flex items-center flex-1 last:flex-none">
                <div className="flex flex-col items-center gap-1">
                  <div
                    className={`h-2.5 w-2.5 rounded-full ${
                      idx <= currentStageIndex ? "bg-accent" : "bg-hairline"
                    }`}
                    aria-hidden
                  />
                  <span
                    className={`text-[10px] uppercase tracking-wide whitespace-nowrap ${
                      idx <= currentStageIndex ? "text-ink-muted" : "text-ink-faint"
                    }`}
                  >
                    {stage}
                  </span>
                </div>
                {idx < LIFECYCLE_STAGES.length - 1 && (
                  <div className={`h-px flex-1 mx-2 ${idx < currentStageIndex ? "bg-accent" : "bg-hairline"}`} />
                )}
              </div>
            ))}
          </div>
          <p className="text-xs text-ink-faint mt-2">{irrevocabilityNote(payment.channel)}</p>
        </div>

        {/* Gauge + typology */}
        <div className="rounded-xl border border-hairline bg-panel p-6 flex flex-col items-center">
          <RiskGauge score={score.score} band={score.band} />
          <div className="mt-3">
            <span className="inline-flex items-center rounded-full border border-hairline px-3 py-1 text-xs font-medium text-ink capitalize">
              {score.typology}
            </span>
          </div>
          <p className="text-xs text-ink-muted mt-2 text-center max-w-sm">
            {TYPOLOGY_META[score.typology]}
          </p>
        </div>

        {/* Structured detail grid */}
        <dl className="rounded-lg border border-hairline bg-panel-raised divide-y divide-hairline text-sm">
          <div className="grid grid-cols-2 divide-x divide-hairline">
            <div className="px-4 py-3">
              <dt className="text-[11px] uppercase tracking-wide text-ink-faint mb-0.5">From</dt>
              <dd className="text-ink">{payment.initiatedBy}</dd>
            </div>
            <div className="px-4 py-3">
              <dt className="text-[11px] uppercase tracking-wide text-ink-faint mb-0.5">To</dt>
              <dd className="text-ink">
                {payment.payeeName}{" "}
                <span className="text-ink-faint">
                  ({payment.payeeAgeDays === 0 ? "added today" : `added ${payment.payeeAgeDays}d ago`})
                </span>
              </dd>
            </div>
          </div>
          <div className="grid grid-cols-2 divide-x divide-hairline">
            <div className="px-4 py-3">
              <dt className="text-[11px] uppercase tracking-wide text-ink-faint mb-0.5">Channel</dt>
              <dd className="text-ink">{payment.channel}</dd>
            </div>
            <div className="px-4 py-3">
              <dt className="text-[11px] uppercase tracking-wide text-ink-faint mb-0.5">Device</dt>
              <dd className="text-ink">
                {payment.deviceIsNew ? "New — not seen before on this account" : "Recognized device"}
              </dd>
            </div>
          </div>
          <div className="px-4 py-3">
            <dt className="text-[11px] uppercase tracking-wide text-ink-faint mb-0.5">Memo</dt>
            <dd className="text-ink font-data">&ldquo;{payment.memo}&rdquo;</dd>
          </div>
        </dl>

        {/* Fired rules - always-visible list, not hover-only */}
        <div>
          <p className="text-[11px] uppercase tracking-wide text-ink-faint mb-2">
            Signals ({score.firedRules.length})
          </p>
          {score.firedRules.length === 0 ? (
            <p className="text-sm text-ink-muted">No rules fired on this payment.</p>
          ) : (
            <ul className="space-y-2">
              {score.firedRules.map((rule) => (
                <li
                  key={rule.id}
                  className="flex gap-3 rounded-lg border border-hairline bg-panel-raised px-3 py-2.5"
                >
                  <span className="font-data text-xs text-ink-faint shrink-0 pt-0.5">+{rule.points}</span>
                  <div>
                    <p className="text-sm text-ink font-medium">{rule.label}</p>
                    <p className="text-xs text-ink-muted mt-0.5">{rule.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Analyst brief */}
        <div className="rounded-lg border border-hairline bg-panel-raised p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] uppercase tracking-wide text-ink-faint">Analyst brief</p>
            {triage && (
              <span className="text-[10px] uppercase tracking-wide text-ink-faint border border-hairline rounded px-1.5 py-0.5">
                source: {triage.source}
              </span>
            )}
          </div>
          <p className={`text-sm font-semibold mb-1.5 ${meta.text}`}>{leadLine}</p>
          {triageLoading ? (
            <div className="space-y-2 animate-pulse">
              <div className="h-3 bg-hairline rounded w-full" />
              <div className="h-3 bg-hairline rounded w-5/6" />
              <div className="h-3 bg-hairline rounded w-2/3" />
            </div>
          ) : (
            <p className="text-sm text-ink-muted leading-relaxed">{triage?.brief}</p>
          )}
        </div>

        {/* Call script */}
        <div className="rounded-lg border border-hairline bg-panel-raised p-4">
          <p className="text-[11px] uppercase tracking-wide text-ink-faint mb-2">Call script</p>
          {triageLoading ? (
            <div className="space-y-2 animate-pulse">
              <div className="h-3 bg-hairline rounded w-full" />
              <div className="h-3 bg-hairline rounded w-4/5" />
            </div>
          ) : (
            <ol className="space-y-2">
              {triage?.callScript.map((line, idx) => (
                <li key={idx} className="flex gap-2.5 text-sm text-ink-muted leading-relaxed">
                  <span className="font-data text-xs text-ink-faint shrink-0 pt-0.5">{idx + 1}</span>
                  <span className="italic">&ldquo;{line}&rdquo;</span>
                </li>
              ))}
            </ol>
          )}
        </div>

        {/* Recommendation + actions */}
        <div className="pb-2">
          <p className="text-xs text-ink-muted mb-2">
            Recommended: <span className="text-ink font-medium">{DECISION_META[score.recommendedDecision].buttonLabel}</span>. The analyst decides.
          </p>
          <div className="flex gap-3">
            <DecisionButton
              decision="release"
              isRecommended={score.recommendedDecision === "release"}
              disabled={!!decision}
              onClick={() => onDecision("release")}
            />
            <DecisionButton
              decision="hold"
              isRecommended={score.recommendedDecision === "hold"}
              disabled={!!decision}
              onClick={() => onDecision("hold")}
            />
            <DecisionButton
              decision="escalate"
              isRecommended={score.recommendedDecision === "escalate"}
              disabled={!!decision}
              onClick={() => onDecision("escalate")}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
