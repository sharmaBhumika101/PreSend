import { formatINR } from "@/lib/format";

interface MetricsStripProps {
  pending: number;
  held: number;
  escalated: number;
  released: number;
  amountProtected: number;
}

export function MetricsStrip({
  pending,
  held,
  escalated,
  released,
  amountProtected,
}: MetricsStripProps) {
  const tiles = [
    { label: "Pending", value: pending.toString() },
    { label: "Held", value: held.toString() },
    { label: "Escalated", value: escalated.toString() },
    { label: "Released", value: released.toString() },
  ];

  return (
    <div className="px-4 pt-4 space-y-2">
      <p className="text-[10px] uppercase tracking-wide text-ink-faint">This session</p>
      <div className="rounded-lg border border-hairline bg-panel-raised px-4 py-3">
        <p className="font-data text-2xl font-semibold text-ink tabular-nums">
          {formatINR(amountProtected)}
        </p>
        <p className="text-[11px] text-ink-faint mt-0.5">stopped before settlement</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-lg border border-hairline bg-panel-raised px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-ink-faint">{t.label}</p>
            <p className="font-data text-base font-semibold text-ink tabular-nums mt-0.5">{t.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
