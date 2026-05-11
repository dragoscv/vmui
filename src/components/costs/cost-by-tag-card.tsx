import "server-only";
import { db } from "@/lib/db";
import { instances, instanceTags } from "@/lib/db/schema";
import { priceInstances } from "@/lib/pricing";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tags } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatUsd, formatUsdPerHour, HOURS_PER_MONTH } from "@/lib/utils";

interface TagBucket {
  key: string;
  value: string;
  hourlyUsd: number;
  count: number;
}

/**
 * Aggregates running-instance hourly burn by tag key=value. An instance with
 * multiple tags contributes to every bucket it belongs to (so totals can
 * exceed the global burn — that's expected when slicing by tag). Untagged
 * running VMs roll into a synthetic "(untagged)" bucket so the user always
 * sees 100% of spend accounted for somewhere.
 */
export async function CostByTagCard() {
  const [instanceList, tagRows] = await Promise.all([
    db.select().from(instances),
    db.select().from(instanceTags),
  ]);

  const tagsByInstance = new Map<string, { key: string; value: string }[]>();
  for (const t of tagRows) {
    const arr = tagsByInstance.get(t.instanceId) ?? [];
    arr.push({ key: t.key, value: t.value });
    tagsByInstance.set(t.instanceId, arr);
  }

  const running = instanceList.filter((i) => i.state === "running");
  if (running.length === 0) return null;

  const priceMap = await priceInstances(
    running.map((i) => ({
      id: i.id,
      provider: i.provider,
      region: i.region,
      instanceType: i.instanceType,
      platform: i.platform,
      accountId: i.accountId,
    })),
  );

  const buckets = new Map<string, TagBucket>();
  let untaggedCount = 0;
  let untaggedHourly = 0;

  for (const inst of running) {
    const hourly = priceMap[inst.id]?.usdPerHour ?? 0;
    const tags = tagsByInstance.get(inst.id) ?? [];
    if (tags.length === 0) {
      untaggedCount++;
      untaggedHourly += hourly;
      continue;
    }
    for (const tag of tags) {
      const id = `${tag.key}=${tag.value}`;
      const cur = buckets.get(id) ?? { key: tag.key, value: tag.value, hourlyUsd: 0, count: 0 };
      cur.hourlyUsd += hourly;
      cur.count++;
      buckets.set(id, cur);
    }
  }

  const sorted = [...buckets.values()].sort((a, b) => b.hourlyUsd - a.hourlyUsd).slice(0, 12);
  if (sorted.length === 0 && untaggedCount === 0) return null;

  const max = Math.max(
    untaggedHourly,
    ...sorted.map((b) => b.hourlyUsd),
    0.0001,
  );

  return (
    <Card className="surface">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Tags className="h-4 w-4 text-[var(--color-primary)]" />
          Cost by tag
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-muted">
          Running burn grouped by tag key=value. An instance with multiple tags appears in each bucket — totals
          intentionally over-count so every slice is honest.
        </p>
        <ul className="space-y-1.5">
          {sorted.map((b) => {
            const id = `${b.key}=${b.value}`;
            const pct = (b.hourlyUsd / max) * 100;
            return (
              <li key={id} className="flex items-center gap-3 text-sm">
                <Badge variant="info" className="shrink-0 text-[10px]">
                  {b.key}
                  {b.value ? `=${b.value}` : ""}
                </Badge>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
                  <div
                    className="h-full rounded-full bg-[var(--color-primary)]"
                    style={{ width: `${Math.min(100, pct)}%` }}
                  />
                </div>
                <div className="w-24 text-right tabular-nums text-xs">{formatUsdPerHour(b.hourlyUsd)}</div>
                <div className="w-20 text-right tabular-nums text-xs text-muted">
                  {formatUsd(b.hourlyUsd * HOURS_PER_MONTH)}/mo
                </div>
                <div className="hidden w-12 text-right text-[11px] text-muted sm:inline">
                  {b.count} VM{b.count === 1 ? "" : "s"}
                </div>
              </li>
            );
          })}
          {untaggedCount > 0 && (
            <li className="flex items-center gap-3 border-t border-[var(--color-border)] pt-2 text-sm">
              <Badge variant="muted" className="shrink-0 text-[10px]">
                (untagged)
              </Badge>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
                <div
                  className="h-full rounded-full bg-[var(--color-muted)]"
                  style={{ width: `${Math.min(100, (untaggedHourly / max) * 100)}%` }}
                />
              </div>
              <div className="w-24 text-right tabular-nums text-xs">{formatUsdPerHour(untaggedHourly)}</div>
              <div className="w-20 text-right tabular-nums text-xs text-muted">
                {formatUsd(untaggedHourly * HOURS_PER_MONTH)}/mo
              </div>
              <div className="hidden w-12 text-right text-[11px] text-muted sm:inline">
                {untaggedCount} VM{untaggedCount === 1 ? "" : "s"}
              </div>
            </li>
          )}
        </ul>
      </CardContent>
    </Card>
  );
}
