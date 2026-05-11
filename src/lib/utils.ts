import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatRelative(date: Date | number | null | undefined): string {
  if (!date) return "never";
  const d = typeof date === "number" ? new Date(date * (date < 1e12 ? 1000 : 1)) : date;
  const diff = Date.now() - d.getTime();
  const sec = Math.round(diff / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

/**
 * Format a USD/hour rate. Picks fractional precision so very cheap
 * instances ("$0.0042/hr") still show useful digits.
 */
export function formatUsdPerHour(n: number): string {
  if (n === 0) return "free";
  if (n < 0.01) return `$${n.toFixed(4)}/hr`;
  if (n < 1) return `$${n.toFixed(3)}/hr`;
  return `$${n.toFixed(2)}/hr`;
}

/** Format a USD amount as currency: $1,234.56 */
export function formatUsd(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: n >= 100 ? 0 : 2,
  });
}

export const HOURS_PER_MONTH = 730;
