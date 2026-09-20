import type { PricedRow } from "@/lib/pricing";
import { HOURS_PER_MONTH } from "@/lib/utils";

interface Inst {
  id: string;
  accountId: string;
  state: string;
  provider: string;
}

export interface SpendAccount {
  id: string;
  name: string;
  provider: string;
  monthlyBudgetUsd?: number | null;
}

export interface SpendRow {
  account: SpendAccount;
  runningCount: number;
  monthly: number;
  cap: number | null;
  pct: number | null;
}

export function computeSpendRows(accounts: SpendAccount[], instances: Inst[], priceMap: Record<string, PricedRow | undefined>): SpendRow[] {
  return accounts
    .map((a) => {
      const running = instances.filter((i) => i.accountId === a.id && i.state === "running");
      const hourly = running.reduce((s, i) => s + (priceMap[i.id]?.usdPerHour ?? 0), 0);
      const monthly = hourly * HOURS_PER_MONTH;
      const cap = a.monthlyBudgetUsd ?? null;
      const pct = cap && cap > 0 ? Math.min(200, (monthly / cap) * 100) : null;
      return { account: a, runningCount: running.length, monthly, cap, pct };
    })
    .filter((r) => r.runningCount > 0 || (r.cap ?? 0) > 0);
}
