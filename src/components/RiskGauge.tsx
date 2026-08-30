import type { RiskBand } from "@/lib/types";
import { RISK_BAND_META } from "@/lib/format";

interface RiskGaugeProps {
  score: number;
  band: RiskBand;
}

const CENTER = 100;
const RADIUS = 78;
const TICKS = [0, 20, 40, 60, 80, 100];

function pointOnArc(radius: number, valueOf100: number) {
  // 0 -> 180deg (left), 100 -> 0deg (right), sweeping through the top.
  const angleDeg = 180 - valueOf100 * 1.8;
  const angleRad = (angleDeg * Math.PI) / 180;
  return {
    x: CENTER + radius * Math.cos(angleRad),
    y: CENTER - radius * Math.sin(angleRad),
  };
}

export function RiskGauge({ score, band }: RiskGaugeProps) {
  const meta = RISK_BAND_META[band];
  const start = pointOnArc(RADIUS, 0);
  const end = pointOnArc(RADIUS, 100);
  const arcPath = `M ${start.x} ${start.y} A ${RADIUS} ${RADIUS} 0 0 1 ${end.x} ${end.y}`;

  return (
    <div className="relative flex flex-col items-center">
      <svg viewBox="0 0 200 112" className="w-56 sm:w-64" role="img" aria-label={`Risk score ${score} out of 100, ${meta.label}`}>
        <path
          d={arcPath}
          fill="none"
          stroke="var(--color-hairline)"
          strokeWidth={10}
          strokeLinecap="round"
        />
        <path
          d={arcPath}
          fill="none"
          className={meta.ring}
          stroke="currentColor"
          strokeWidth={10}
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray={100}
          strokeDashoffset={100 - score}
          style={{ transition: "stroke-dashoffset 500ms ease" }}
        />
        {TICKS.map((t) => {
          const inner = pointOnArc(RADIUS - 14, t);
          const outer = pointOnArc(RADIUS - 6, t);
          return (
            <line
              key={t}
              x1={inner.x}
              y1={inner.y}
              x2={outer.x}
              y2={outer.y}
              stroke="var(--color-ink-faint)"
              strokeWidth={2}
            />
          );
        })}
      </svg>
      <div className="absolute top-[48px] sm:top-[54px] flex flex-col items-center">
        <span className="font-data text-4xl sm:text-5xl font-semibold tabular-nums" style={{ color: `var(--color-risk-${band})` }}>
          {score}
        </span>
        <span className="text-[10px] uppercase tracking-[0.18em] text-ink-faint mt-0.5">/ 100</span>
      </div>
    </div>
  );
}
