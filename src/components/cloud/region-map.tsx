import { Stat } from "@/components/ui";

export interface RegionBucketPoint {
  label: string;
  x: number;
  y: number;
  n: number;
}

const W = 900;
const H = 460;

export function RegionMap({
  points,
  max,
  counts,
  ariaLabel,
}: {
  points: RegionBucketPoint[];
  max: number;
  counts: { label: string; n: number }[];
  ariaLabel: string;
}) {
  return (
    <div className="space-y-4">
      <div className="surface overflow-x-auto p-4">
        <svg
          role="img"
          aria-label={ariaLabel}
          viewBox={`0 0 ${W} ${H}`}
          className="mx-auto block h-auto w-full min-w-[36rem] max-w-[56rem] rounded-[var(--radius-md)]"
        >
          <rect width={W} height={H} fill="var(--color-surface-muted)" />
          <g stroke="var(--color-border)" strokeWidth="0.5" fill="none">
            {Array.from({ length: 7 }, (_, i) => (
              <line key={`h${i}`} x1={0} y1={(H / 6) * i} x2={W} y2={(H / 6) * i} />
            ))}
            {Array.from({ length: 13 }, (_, i) => (
              <line key={`v${i}`} x1={(W / 12) * i} y1={0} x2={(W / 12) * i} y2={H} />
            ))}
          </g>
          {points.map((p) => {
            const r = 8 + Math.sqrt(p.n / max) * 36;
            return (
              <g key={p.label}>
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={r}
                  fill="color-mix(in oklch, var(--color-primary) 25%, transparent)"
                  stroke="var(--color-primary)"
                  strokeWidth={1.5}
                />
                <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize={11} fill="var(--color-fg)" fontWeight={600}>
                  {p.n}
                </text>
                <text x={p.x} y={p.y + r + 12} textAnchor="middle" fontSize={9} fill="var(--color-fg-muted)">
                  {p.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {counts.map((c) => (
          <Stat key={c.label} label={c.label} value={c.n} />
        ))}
      </div>
    </div>
  );
}

export { H as REGION_MAP_HEIGHT, W as REGION_MAP_WIDTH };
