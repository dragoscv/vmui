"use client";

import { useFormatter } from "next-intl";

/** USD formatting for client leaves; per-hour keeps extra digits so cheap VMs stay legible. */
export function useMoney() {
  const format = useFormatter();
  const usd = (n: number) =>
    format.number(n, { style: "currency", currency: "USD", maximumFractionDigits: n >= 100 ? 0 : 2 });
  const usdRate = (n: number) =>
    format.number(n, {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: n < 0.01 ? 4 : n < 1 ? 3 : 2,
    });
  return { usd, usdRate };
}
