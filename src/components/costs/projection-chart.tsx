"use client";

import { useMemo } from "react";

interface HistoryPoint {
  t: number;
  hourlyUsd: number;
}
interface Band {
  daysAhead: number;
  hourlyUsd: number;
  hourlyLo: number;
  hourlyHi: number;
}

interface Props {
  history: HistoryPoint[];
  bands: Band[];
  sigma: number;
  slopeUsdPerDay: number;
  currentHourlyUsd: number;
}

const W = 800;
const H = 240;
const PADDING = { top: 20, right: 20, bottom: 28, left: 56 };

export function ProjectionChart({ history, bands, currentHourlyUsd }: Props) {
  const { points, fitPoints, bandPath, xMin, xMax, yMin, yMax } = useMemo(() => {
    if (history.length === 0) {
      return { points: "", fitPoints: "", bandPath: "", xMin: 0, xMax: 0, yMin: 0, yMax: 0 };
    }
    const xMin = history[0]?.t ?? 0;
    // Extend x to the furthest band horizon.
    const furthestDays = bands.reduce((m, b) => Math.max(m, b.daysAhead), 0);
    const xMax = (history[history.length - 1]?.t ?? 0) + furthestDays * 24 * 60 * 60 * 1000;

    const allY = [
      ...history.map((p) => p.hourlyUsd),
      ...bands.map((b) => b.hourlyHi),
      ...bands.map((b) => b.hourlyLo),
      currentHourlyUsd,
    ];
    const yMin = 0;
    const yMax = Math.max(...allY) * 1.1 || 1;

    const innerW = W - PADDING.left - PADDING.right;
    const innerH = H - PADDING.top - PADDING.bottom;
    const sx = (t: number) => PADDING.left + ((t - xMin) / Math.max(1, xMax - xMin)) * innerW;
    const sy = (v: number) => PADDING.top + innerH - ((v - yMin) / Math.max(1, yMax - yMin)) * innerH;

    const points = history.map((p) => `${sx(p.t)},${sy(p.hourlyUsd)}`).join(" ");

    const tLastHist = history[history.length - 1]?.t ?? xMin;
    const fitNodes = [
      `${sx(tLastHist)},${sy(currentHourlyUsd)}`,
      ...bands.map((b) => {
        const t = tLastHist + b.daysAhead * 24 * 60 * 60 * 1000;
        return `${sx(t)},${sy(b.hourlyUsd)}`;
      }),
    ];
    const fitPoints = fitNodes.join(" ");

    const hiPath = bands
      .map((b, i) => {
        const t = tLastHist + b.daysAhead * 24 * 60 * 60 * 1000;
        return `${i === 0 ? "M" : "L"}${sx(t)},${sy(b.hourlyHi)}`;
      })
      .join(" ");
    const loPath = [...bands]
      .reverse()
      .map((b) => {
        const t = tLastHist + b.daysAhead * 24 * 60 * 60 * 1000;
        return `L${sx(t)},${sy(b.hourlyLo)}`;
      })
      .join(" ");
    const bandPath = `M${sx(tLastHist)},${sy(currentHourlyUsd)} ${hiPath} ${loPath} L${sx(tLastHist)},${sy(currentHourlyUsd)} Z`;

    return { points, fitPoints, bandPath, xMin, xMax, yMin, yMax };
  }, [history, bands, currentHourlyUsd]);

  if (history.length === 0) {
    return <div className="text-xs text-muted">No history yet.</div>;
  }

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => yMin + f * (yMax - yMin));

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Cost projection chart"
      className="w-full"
      preserveAspectRatio="xMidYMid meet"
    >
      {ticks.map((y, i) => {
        const innerH = H - PADDING.top - PADDING.bottom;
        const sy = PADDING.top + innerH - ((y - yMin) / Math.max(1, yMax - yMin)) * innerH;
        return (
          <g key={i}>
            <line
              x1={PADDING.left}
              x2={W - PADDING.right}
              y1={sy}
              y2={sy}
              stroke="var(--color-border)"
              strokeDasharray="3 3"
              strokeOpacity="0.4"
            />
            <text
              x={PADDING.left - 6}
              y={sy + 3}
              textAnchor="end"
              fontSize="10"
              fill="var(--color-muted)"
              fontFamily="monospace"
            >
              ${y.toFixed(2)}
            </text>
          </g>
        );
      })}

      {/* Confidence band */}
      <path d={bandPath} fill="var(--color-primary)" fillOpacity="0.12" />

      {/* History */}
      <polyline
        points={points}
        fill="none"
        stroke="var(--color-fg)"
        strokeOpacity="0.7"
        strokeWidth="1.5"
      />

      {/* Fit / forecast */}
      <polyline
        points={fitPoints}
        fill="none"
        stroke="var(--color-primary)"
        strokeWidth="2"
        strokeDasharray="6 3"
      />

      {/* Band horizons as dots */}
      {bands.map((b, i) => {
        const tLast = history[history.length - 1]?.t ?? 0;
        const t = tLast + b.daysAhead * 24 * 60 * 60 * 1000;
        const innerW = W - PADDING.left - PADDING.right;
        const innerH = H - PADDING.top - PADDING.bottom;
        const sx = PADDING.left + ((t - xMin) / Math.max(1, xMax - xMin)) * innerW;
        const sy = PADDING.top + innerH - ((b.hourlyUsd - yMin) / Math.max(1, yMax - yMin)) * innerH;
        return (
          <g key={i}>
            <circle cx={sx} cy={sy} r="4" fill="var(--color-primary)" />
            <text x={sx} y={sy - 8} textAnchor="middle" fontSize="10" fill="var(--color-fg)">
              {b.daysAhead}d
            </text>
          </g>
        );
      })}
    </svg>
  );
}
