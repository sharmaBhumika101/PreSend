"use client";

import type { Decision, Payment, ScoreResult } from "@/lib/types";
import { formatINR, merchantBadge, RISK_BAND_META } from "@/lib/format";

export interface QueueItem {
  payment: Payment;
  score: ScoreResult;
  decision: Decision | null;
}

interface PaymentQueueProps {
  items: QueueItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const DECISION_LABEL: Record<Decision, string> = {
  hold: "Held",
  release: "Released",
  escalate: "Escalated",
};

export function PaymentQueue({ items, selectedId, onSelect }: PaymentQueueProps) {
  const pendingCount = items.filter((i) => !i.decision).length;

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 pt-4 pb-3">
        <h2 className="font-data text-[11px] uppercase tracking-[0.16em] text-ink-faint">
          Pre-send queue
        </h2>
        <p className="text-xs text-ink-muted mt-1">
          {pendingCount} awaiting review, sorted by risk
        </p>
      </div>
      <ul className="flex-1 overflow-y-auto px-2 pb-4 space-y-1">
        {items.map(({ payment, score, decision }) => {
          const meta = RISK_BAND_META[score.band];
          const isSelected = payment.id === selectedId;
          return (
            <li key={payment.id}>
              <button
                onClick={() => onSelect(payment.id)}
                aria-current={isSelected}
                className={`w-full text-left rounded-lg border px-3 py-2.5 transition-colors ${
                  isSelected
                    ? "border-accent bg-accent-dim"
                    : "border-transparent hover:border-hairline hover:bg-panel-raised"
                } ${decision ? "opacity-60" : ""}`}
              >
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} aria-hidden />
                  <span className="font-data text-[10px] text-ink-faint border border-hairline rounded px-1 shrink-0">
                    {merchantBadge(payment.merchant)}
                  </span>
                  <span className="text-sm font-medium text-ink truncate flex-1">
                    {payment.payeeName}
                  </span>
                  <span className="font-data text-xs text-ink-muted tabular-nums shrink-0">
                    {score.score}
                  </span>
                </div>
                <div className="pl-4 mt-1">
                  <span className="text-[11px] text-ink-faint">
                    {payment.channel} &middot; from {payment.initiatedBy}
                  </span>
                </div>
                <div className="flex items-center justify-between mt-1 pl-4">
                  <span className="font-data text-[11px] text-ink-faint">{payment.id}</span>
                  <span className="font-data text-xs text-ink-muted tabular-nums">
                    {formatINR(payment.amount)}
                  </span>
                </div>
                {decision && (
                  <div className="pl-4 mt-1">
                    <span className="text-[10px] uppercase tracking-wide text-ink-faint">
                      {DECISION_LABEL[decision]}
                    </span>
                  </div>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
