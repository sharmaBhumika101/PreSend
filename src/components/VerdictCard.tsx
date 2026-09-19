"use client";

import { useEffect, useState } from "react";
import type { Decision, Payment, ScoreResult, TriageResult } from "@/lib/types";
import { buildLeadLine, DECISION_META, formatClock, formatINR, RISK_BAND_META } from "@/lib/format";
import { RiskGauge } from "./RiskGauge";

interface VerdictCardProps {
  payment: Payment;
  score: ScoreResult;
  triage: TriageResult | null;
  triageLoading: boolean;
  decision: Decision | null;
  onDecision: (decision: Decision, reason: string) => Promise<void> | void;
}

const TYPOLOGY_META: Record<string, string> = {
  "impersonation scam": "Language in the memo mimics a verification/urgency scam.",
  "mule pattern": "Money moving fast through an unfamiliar payee or device.",
  benign: "No meaningful risk signal detected.",
  unclear: "Some signal present, but no single pattern dominates.",
};

const REASON_SUGGESTIONS: Record<Decision, string[]> = {
  release: [
    "Verified invoice details with merchant founder",
    "Established recurring business payee",
    "Customer confirmed transfer via verified phone",
  ],
  hold: [
    "Urgent KYC keyword detected; customer callback required",
    "Unrecognized device and off-hours timing anomaly",
    "First-time transfer to new payee exceeding safe limit",
  ],
  escalate: [
    "Confirmed mule network pattern matching known typology",
    "Rapid velocity fan-out to unverified accounts",
    "High-probability account takeover indicator",
  ],
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

  const [pendingDecision, setPendingDecision] = useState<Decision | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setPendingDecision(null);
    setReason("");
    setReasonError(null);
    setSubmitting(false);
  }, [payment.id]);

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
          {score.behavioralScore !== undefined && score.behavioralScore > 0 && (
            <div className="mt-3 flex items-center gap-1.5 text-[11px] font-data text-ink-muted bg-panel-raised border border-hairline px-2.5 py-1 rounded-full">
              <span>Static: {score.staticScore ?? (score.score - score.behavioralScore)}</span>
              <span>+</span>
              <span className="text-purple-400 font-medium">Behavioral: +{score.behavioralScore}</span>
              <span>=</span>
              <span className="text-ink font-semibold">Composite: {score.score}</span>
            </div>
          )}
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

        {/* Account Behavioral Baseline Profile */}
        {score.behavioral && (
          <div className="rounded-lg border border-hairline bg-panel-raised p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <p className="text-[11px] uppercase tracking-wide text-ink-faint">
                  Account Behavioral Baseline
                </p>
                <span
                  className="text-[9px] font-data px-1.5 py-0.2 rounded border border-ink-faint/30 text-ink-faint"
                  title="Synthetic demo account identity (merchant, initiatedBy)"
                >
                  Demo Account
                </span>
              </div>
              {score.behavioral.status === "insufficient_data" ? (
                <span className="text-[10px] uppercase font-data px-2 py-0.5 rounded border border-hairline text-ink-faint">
                  Cold Start ({score.behavioral.baseline.sampleSize}/3)
                </span>
              ) : (
                <span className="text-[10px] font-data px-2 py-0.5 rounded border border-purple-500/30 text-purple-400 bg-purple-500/10">
                  {score.behavioral.baseline.sampleSize} past transfers &middot;{" "}
                  {score.behavioral.baseline.scope === "account" ? "Desk Baseline" : "Merchant Baseline"}
                </span>
              )}
            </div>

            {score.behavioral.status === "insufficient_data" ? (
              <p className="text-xs text-ink-muted leading-relaxed">
                Cold start baseline: Only {score.behavioral.baseline.sampleSize} of 3 historical transfers recorded for this demo account. Evaluated strictly on core checklist rules without anomaly penalty.
              </p>
            ) : (
              <div className="space-y-2.5">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div className="rounded border border-hairline/60 bg-panel px-2.5 py-2">
                    <p className="text-[10px] uppercase text-ink-faint">Median Amount</p>
                    <p className="font-data font-medium text-ink mt-0.5">
                      {formatINR(score.behavioral.baseline.medianAmount)}
                    </p>
                    <p className="text-[10px] text-ink-faint mt-0.5">
                      vs {formatINR(payment.amount)}
                    </p>
                  </div>
                  <div className="rounded border border-hairline/60 bg-panel px-2.5 py-2">
                    <p className="text-[10px] uppercase text-ink-faint">Contextual Velocity</p>
                    <p className="font-data font-medium text-ink mt-0.5">
                      {score.behavioral.baseline.avgContextualTransfersIn24h.toFixed(1)}/day
                    </p>
                    <p className="text-[10px] text-ink-faint mt-0.5">
                      vs {payment.transfersIn24h} in 24h
                    </p>
                  </div>
                  <div className="rounded border border-hairline/60 bg-panel px-2.5 py-2">
                    <p className="text-[10px] uppercase text-ink-faint">Payee History</p>
                    <p className="font-medium text-ink truncate mt-0.5">
                      {score.behavioral.anomalies.some((a) => a.id === "unseen_payee_for_account")
                        ? "New Payee"
                        : "Known Payee"}
                    </p>
                    <p className="text-[10px] text-ink-faint mt-0.5 truncate">
                      {score.behavioral.baseline.knownPayees.length} on file
                    </p>
                  </div>
                  <div className="rounded border border-hairline/60 bg-panel px-2.5 py-2">
                    <p className="text-[10px] uppercase text-ink-faint">Operating Window</p>
                    <p className="font-data font-medium text-ink mt-0.5">
                      {String(score.behavioral.baseline.typicalHourRange.min).padStart(2, "0")}:00&ndash;
                      {String(score.behavioral.baseline.typicalHourRange.max).padStart(2, "0")}:00
                    </p>
                    <p className="text-[10px] text-ink-faint mt-0.5">
                      sent {formatClock(payment.hourOfDay)}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-0.5 text-xs">
                  <span className="text-ink-muted">
                    Behavioral contribution to composite score:
                  </span>
                  <span
                    className={`font-data font-semibold ${
                      score.behavioral.score > 0 ? "text-purple-400" : "text-ink-faint"
                    }`}
                  >
                    +{score.behavioral.score} pts
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Fired rules - always-visible list, not hover-only */}
        <div>
          <p className="text-[11px] uppercase tracking-wide text-ink-faint mb-2">
            Signals ({score.firedRules.length})
          </p>
          {score.firedRules.length === 0 ? (
            <p className="text-sm text-ink-muted">No rules fired on this payment.</p>
          ) : (
            <ul className="space-y-2">
              {score.firedRules.map((rule) => {
                const isBehavioral =
                  rule.category === "behavioral" ||
                  rule.id === "amount_spike" ||
                  rule.id === "velocity_spike" ||
                  rule.id === "unseen_payee_for_account" ||
                  rule.id === "unusual_timing" ||
                  rule.id === "unusual_channel";

                return (
                  <li
                    key={rule.id}
                    className="flex gap-3 rounded-lg border border-hairline bg-panel-raised px-3 py-2.5"
                  >
                    <span className="font-data text-xs text-ink-faint shrink-0 pt-0.5">+{rule.points}</span>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm text-ink font-medium">{rule.label}</p>
                        {isBehavioral ? (
                          <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.2 rounded border border-purple-500/30 text-purple-400 bg-purple-500/10">
                            Behavioral Anomaly
                          </span>
                        ) : (
                          <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.2 rounded border border-ink-faint/30 text-ink-faint bg-panel">
                            Core Rule
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-ink-muted mt-0.5">{rule.detail}</p>
                    </div>
                  </li>
                );
              })}
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
        <div className="pb-4">
          <p className="text-xs text-ink-muted mb-2">
            Recommended: <span className="text-ink font-medium">{DECISION_META[score.recommendedDecision].buttonLabel}</span>. The analyst decides.
          </p>
          <div className="flex gap-3">
            <DecisionButton
              decision="release"
              isRecommended={score.recommendedDecision === "release"}
              disabled={!!decision || submitting}
              onClick={() => {
                setPendingDecision("release");
                setReason(REASON_SUGGESTIONS.release[0]);
                setReasonError(null);
              }}
            />
            <DecisionButton
              decision="hold"
              isRecommended={score.recommendedDecision === "hold"}
              disabled={!!decision || submitting}
              onClick={() => {
                setPendingDecision("hold");
                setReason(REASON_SUGGESTIONS.hold[0]);
                setReasonError(null);
              }}
            />
            <DecisionButton
              decision="escalate"
              isRecommended={score.recommendedDecision === "escalate"}
              disabled={!!decision || submitting}
              onClick={() => {
                setPendingDecision("escalate");
                setReason(REASON_SUGGESTIONS.escalate[0]);
                setReasonError(null);
              }}
            />
          </div>

          {/* Confirmation & Reason Interaction */}
          {pendingDecision && !decision && (
            <div className="mt-3 rounded-lg border border-hairline bg-panel-raised p-4 space-y-3 animate-in fade-in duration-150">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-ink">
                    Confirm {DECISION_META[pendingDecision].buttonLabel}
                  </span>
                  <span
                    className={`text-[10px] uppercase font-data px-1.5 py-0.5 rounded border ${
                      pendingDecision === "release"
                        ? "border-risk-green/40 text-risk-green bg-risk-green-dim"
                        : pendingDecision === "hold"
                        ? "border-risk-amber/40 text-risk-amber bg-risk-amber-dim"
                        : "border-risk-red/40 text-risk-red bg-risk-red-dim"
                    }`}
                  >
                    Required Audit Reason
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setPendingDecision(null);
                    setReason("");
                    setReasonError(null);
                  }}
                  disabled={submitting}
                  className="text-xs text-ink-muted hover:text-ink transition cursor-pointer"
                >
                  Cancel
                </button>
              </div>

              {/* Quick rationale presets */}
              <div className="flex flex-wrap gap-1.5">
                {REASON_SUGGESTIONS[pendingDecision].map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={submitting}
                    onClick={() => {
                      setReason(s);
                      setReasonError(null);
                    }}
                    className="text-[11px] px-2 py-1 rounded border border-hairline bg-panel hover:bg-hairline/60 text-ink-muted hover:text-ink transition text-left cursor-pointer"
                  >
                    {s}
                  </button>
                ))}
              </div>

              <div>
                <textarea
                  rows={2}
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value);
                    if (reasonError) setReasonError(null);
                  }}
                  disabled={submitting}
                  placeholder="Why are you making this decision? (Required for immutable audit trail)"
                  className="w-full rounded-md border border-hairline bg-panel p-2.5 text-xs text-ink focus:border-accent focus:outline-hidden placeholder:text-ink-faint"
                />
                {reasonError && (
                  <p className="text-[11px] text-risk-red mt-1">{reasonError}</p>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => {
                    setPendingDecision(null);
                    setReason("");
                    setReasonError(null);
                  }}
                  className="px-3 py-1.5 text-xs text-ink-muted hover:text-ink transition rounded cursor-pointer"
                >
                  Back
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={async () => {
                    const trimmed = reason.trim();
                    if (!trimmed) {
                      setReasonError("A non-empty reason is required to record an analyst decision");
                      return;
                    }
                    setSubmitting(true);
                    try {
                      await onDecision(pendingDecision, trimmed);
                      setPendingDecision(null);
                    } catch (err) {
                      setReasonError(err instanceof Error ? err.message : "Failed to record decision");
                    } finally {
                      setSubmitting(false);
                    }
                  }}
                  className={`px-3 py-1.5 text-xs font-semibold rounded transition flex items-center gap-1.5 cursor-pointer ${
                    pendingDecision === "release"
                      ? "bg-risk-green text-void hover:brightness-110"
                      : pendingDecision === "hold"
                      ? "bg-risk-amber text-void hover:brightness-110"
                      : "bg-risk-red text-void hover:brightness-110"
                  } disabled:opacity-50`}
                >
                  {submitting ? (
                    <>
                      <span className="h-3 w-3 border-2 border-void border-t-transparent rounded-full animate-spin" />
                      <span>Recording to Audit Log...</span>
                    </>
                  ) : (
                    <span>Confirm &amp; Record Decision</span>
                  )}
                </button>
              </div>
            </div>
          )}

          {decision && (
            <div className="mt-3 rounded-lg border border-hairline bg-panel-raised p-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs text-ink-muted">Action taken:</span>
                <span
                  className={`text-xs font-semibold uppercase ${
                    decision === "release"
                      ? "text-risk-green"
                      : decision === "hold"
                      ? "text-risk-amber"
                      : "text-risk-red"
                  }`}
                >
                  {DECISION_META[decision].label}
                </span>
              </div>
              <span className="font-data text-[10px] text-ink-faint">
                Logged to Supabase audit trail
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
