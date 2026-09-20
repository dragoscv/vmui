"use client";

import { useTranslations } from "next-intl";
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
const DAY_MS = 24 * 60 * 60 * 1000;

export function ProjectionChart({ history, bands, currentHourlyUsd }: Props) {
  const t = useTranslations("cloud.projections.chart");
  const innerW = W - PADDING.left - PADDING.right;
  const innerH = H - PADDING.top - PADDING.bottom;

  const { points, fitPoints, bandPath, sx, sy, yMin, yMax, tLastHist } = useMemo(() => {
    const xMin = history[0]?.t ?? 0;
    const tLastHist = history[history.length - 1]?.t ?? xMin;
    const furthestDays = bands.reduce((m, b) => Math.max(m, b.daysAhead), 0);
    const xMax = tLastHist + furthestDays * DAY_MS;

    const allY = [...history.map((p) => p.hourlyUsd), ...bands.map((b) => b.hourlyHi), ...bands.map((b) => b.hourlyLo), currentHourlyUsd];
    const yMin = 0;
    const yMax = Math.max(...allY) * 1.1 || 1;

    const sx = (x: number) => PADDING.left + ((x - xMin) / Math.max(1, xMax - xMin)) * innerW;
    const sy = (v: number) => PADDING.top + innerH - ((v - yMin) / Math.max(1, yMax - yMin)) * innerH;

    const points = history.map((p) => `${sx(p.t)},${sy(p.hourlyUsd)}`).join(" ");
    const fitPoints = [`${sx(tLastHist)},${sy(currentHourlyUsd)}`, ...bands.map((b) => `${sx(tLastHist + b.daysAhead * DAY_MS)},${sy(b.hourlyUsd)}`)].join(" ");

    const hiPath = bands.map((b, i) => `${i === 0 ? "M" : "L"}${sx(tLastHist + b.daysAhead * DAY_MS)},${sy(b.hourlyHi)}`).join(" ");
    const loPath = [...bands]
      .reverse()
      .map((b) => `L${sx(tLastHist + b.daysAhead * DAY_MS)},${sy(b.hourlyLo)}`)
      .join(" ");
    const bandPath = `M${sx(tLastHist)},${sy(currentHourlyUsd)} ${hiPath} ${loPath} L${sx(tLastHist)},${sy(currentHourlyUsd)} Z`;

    return { points, fitPoints, bandPath, sx, sy, yMin, yMax, tLastHist };
  }, [history, bands, currentHourlyUsd, innerW, innerH]);

  if (history.length === 0) {
    return <p className="text-xs text-muted">{t("noHistory")}</p>;
  }

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => yMin + f * (yMax - yMin));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("ariaLabel")} className="w-full" preserveAspectRatio="xMidYMid meet">
      {ticks.map((y, i) => (
        <g key={i}>
          <line x1={PADDING.left} x2={W - PADDING.right} y1={sy(y)} y2={sy(y)} stroke="var(--color-border)" strokeDasharray="3 3" />
          <text x={PADDING.left - 6} y={sy(y) + 3} textAnchor="end" fontSize="10" fill="var(--color-fg-muted)" fontFamily="monospace">
            ${y.toFixed(2)}
          </text>
        </g>
      ))}

      <path d={bandPath} fill="color-mix(in oklch, var(--color-primary) 14%, transparent)" />
      <polyline points={points} fill="none" stroke="var(--color-fg-muted)" strokeWidth="1.5" />
      <polyline points={fitPoints} fill="none" stroke="var(--color-primary)" strokeWidth="2" strokeDasharray="6 3" />

      {bands.map((b) => {
        const x = sx(tLastHist + b.daysAhead * DAY_MS);
        const y = sy(b.hourlyUsd);
        return (
          <g key={b.daysAhead}>
            <circle cx={x} cy={y} r="4" fill="var(--color-primary)" />
            <text x={x} y={y - 8} textAnchor="middle" fontSize="10" fill="var(--color-fg)">
              {t("horizon", { days: b.daysAhead })}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
