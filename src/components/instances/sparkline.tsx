"use client";

import { motion } from "motion/react";

/**
 * Lightweight, dependency-free sparkline with smoothed area + line.
 * Animates the most-recent point using framer-motion path interpolation.
 *
 * - `values`: ordered samples, oldest first.
 * - `max`: clamps the chart range. If undefined, auto-scales to data max
 *          (with a small floor so a flat-zero series renders as a baseline).
 */
export function Sparkline({
  values,
  width = 96,
  height = 28,
  color = "var(--color-primary)",
  fill = true,
  max,
  className,
  strokeWidth = 1.5,
  showDot = true,
}: {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  fill?: boolean;
  max?: number;
  className?: string;
  strokeWidth?: number;
  showDot?: boolean;
}) {
  const n = values.length;
  if (n === 0) {
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className={className}
        aria-hidden
      >
        <line
          x1={0}
          y1={height - 1}
          x2={width}
          y2={height - 1}
          stroke="var(--color-border)"
          strokeDasharray="2 3"
          strokeWidth={1}
        />
      </svg>
    );
  }

  const peak = Math.max(max ?? 0, ...values);
  const range = peak <= 0 ? 1 : peak;
  const stepX = n > 1 ? width / (n - 1) : 0;
  const padY = 1.5;

  function y(v: number) {
    const t = Math.max(0, Math.min(1, v / range));
    return height - padY - t * (height - padY * 2);
  }

  const pts = values.map((v, i) => [i * stepX, y(v)] as const);
  const linePath = pts
    .map(([x, yy], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${yy.toFixed(2)}`)
    .join(" ");
  const areaPath = `${linePath} L${(width).toFixed(2)},${height} L0,${height} Z`;

  const last = pts[pts.length - 1];
  const id = `spark-${color.replace(/[^a-z0-9]/gi, "")}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      aria-hidden
    >
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.35} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {fill && <path d={areaPath} fill={`url(#${id})`} />}
      <motion.path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
        initial={false}
        animate={{ d: linePath }}
        transition={{ duration: 0.3, ease: "easeOut" }}
      />
      {showDot && last && (
        <motion.circle
          cx={last[0]}
          cy={last[1]}
          r={2}
          fill={color}
          initial={false}
          animate={{ cx: last[0], cy: last[1] }}
          transition={{ duration: 0.3, ease: "easeOut" }}
        />
      )}
    </svg>
  );
}
