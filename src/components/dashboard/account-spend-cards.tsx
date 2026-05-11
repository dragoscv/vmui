import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatUsd, HOURS_PER_MONTH } from "@/lib/utils";
import type { PricedRow } from "@/lib/pricing";

interface Inst {
  id: string;
  accountId: string;
  state: string;
  provider: string;
}

interface Account {
  id: string;
  name: string;
  provider: string;
  monthlyBudgetUsd?: number | null;
}

export function AccountSpendCards({
  accounts,
  instances,
  priceMap,
}: {
  accounts: Account[];
  instances: Inst[];
  priceMap: Record<string, PricedRow | undefined>;
}) {
  if (accounts.length === 0) return null;

  const rows = accounts
    .map((a) => {
      const running = instances.filter((i) => i.accountId === a.id && i.state === "running");
      const hourly = running.reduce((s, i) => s + (priceMap[i.id]?.usdPerHour ?? 0), 0);
      const monthly = hourly * HOURS_PER_MONTH;
      const cap = a.monthlyBudgetUsd ?? null;
      const pct = cap && cap > 0 ? Math.min(200, (monthly / cap) * 100) : null;
      return { account: a, runningCount: running.length, hourly, monthly, cap, pct };
    })
    .filter((r) => r.runningCount > 0 || (r.cap ?? 0) > 0);

  if (rows.length === 0) return null;

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Spend by account</h2>
        <Link href="/costs" className="text-xs text-muted hover:text-[var(--color-primary)]">
          full cost view →
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((r) => {
          const overBudget = r.pct != null && r.pct >= 100;
          const nearBudget = r.pct != null && r.pct >= 80 && r.pct < 100;
          return (
            <Card key={r.account.id} className="overflow-hidden">
              <CardContent className="space-y-2 p-4">
                <div className="flex items-center justify-between gap-2">
                  <Link
                    href={`/accounts/${r.account.id}`}
                    className="truncate text-sm font-medium hover:text-[var(--color-primary)]"
                  >
                    {r.account.name}
                  </Link>
                  <Badge variant="muted">{r.account.provider}</Badge>
                </div>
                <div className="flex items-end justify-between gap-2">
                  <div>
                    <div className="text-2xl font-semibold tabular-nums">
                      {formatUsd(r.monthly)}
                    </div>
                    <div className="text-[11px] text-muted">
                      projected / month · {r.runningCount} running
                    </div>
                  </div>
                  {r.cap != null && (
                    <div className="text-right text-[11px] text-muted">
                      cap {formatUsd(r.cap)}
                      <div
                        className={
                          overBudget
                            ? "font-medium text-[var(--color-destructive)]"
                            : nearBudget
                              ? "font-medium text-[var(--color-warning)]"
                              : "text-muted"
                        }
                      >
                        {r.pct!.toFixed(0)}%
                      </div>
                    </div>
                  )}
                </div>
                {r.cap != null && (
                  <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-border)]">
                    <div
                      className="h-full transition-[width]"
                      style={{
                        width: `${Math.min(100, r.pct ?? 0)}%`,
                        background: overBudget
                          ? "var(--color-destructive)"
                          : nearBudget
                            ? "var(--color-warning)"
                            : "var(--color-primary)",
                      }}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
