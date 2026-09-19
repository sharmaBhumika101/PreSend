import type { AuditEntry } from "@/lib/types";
import { formatINR, formatTimestamp, RISK_BAND_META } from "@/lib/format";

interface AuditLogProps {
  entries: AuditEntry[];
}

const DECISION_STYLE: Record<AuditEntry["decision"], string> = {
  hold: "text-risk-amber",
  release: "text-risk-green",
  escalate: "text-risk-red",
};

export function AuditLog({ entries }: AuditLogProps) {
  return (
    <div className="flex-1 min-h-0 flex flex-col mt-4">
      <div className="px-4 pb-2">
        <h2 className="font-data text-[11px] uppercase tracking-[0.16em] text-ink-faint">
          Audit log
        </h2>
        <p className="font-data text-[10px] text-ink-faint mt-0.5">presend-triage-01 &middot; read-only</p>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
        {entries.length === 0 ? (
          <p className="text-xs text-ink-muted">
            No decisions yet. Every hold, release, and escalation is written here with the score
            and the brief&rsquo;s source.
          </p>
        ) : (
          entries.map((entry) => {
            const bandMeta = RISK_BAND_META[entry.band];
            return (
              <div
                key={entry.id}
                className="rounded-lg border border-hairline bg-panel-raised px-3 py-2 text-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="font-data text-ink-faint">{formatTimestamp(entry.timestamp)}</span>
                  <span className={`uppercase tracking-wide font-medium ${DECISION_STYLE[entry.decision]}`}>
                    {entry.decision}
                  </span>
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-ink truncate pr-2">{entry.payeeName}</span>
                  <span className="font-data text-ink-muted tabular-nums shrink-0">
                    {formatINR(entry.amount)}
                  </span>
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="font-data text-ink-faint">{entry.paymentId}</span>
                  <div className="flex items-center gap-1.5">
                    <span className={`h-1.5 w-1.5 rounded-full ${bandMeta.dot}`} aria-hidden />
                    <span className="font-data tabular-nums text-ink-muted">{entry.score}</span>
                    <span className="text-ink-faint">&middot;</span>
                    <span className="text-ink-faint">{entry.source}</span>
                  </div>
                </div>
                {entry.reason && (
                  <p className="text-[11px] text-ink-muted italic mt-1.5 pt-1.5 border-t border-hairline/60 break-words">
                    &ldquo;{entry.reason}&rdquo;
                  </p>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
