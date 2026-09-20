import { Badge, PageSection, Progress } from "@/components/ui";
import { db } from "@/lib/db";
import { instances, instanceTags } from "@/lib/db/schema";
import { priceInstances } from "@/lib/pricing";
import { formatUsd, formatUsdPerHour, HOURS_PER_MONTH } from "@/lib/utils";
import { getTranslations } from "next-intl/server";
import "server-only";

interface TagBucket {
  key: string;
  value: string;
  hourlyUsd: number;
  count: number;
}

function TagRow({
  label,
  hourly,
  max,
  muted,
  monthly,
  vms,
}: {
  label: string;
  hourly: number;
  max: number;
  muted?: boolean;
  monthly: string;
  vms: string;
}) {
  return (
    <li className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1 text-sm sm:grid-cols-[minmax(0,10rem)_1fr_6rem_5rem_4rem]">
      <Badge variant={muted ? "muted" : "info"} className="max-w-full truncate">
        {label}
      </Badge>
      <Progress value={(hourly / max) * 100} size="sm" className={muted ? "opacity-60" : undefined} />
      <span className="text-right text-xs tabular-nums">{formatUsdPerHour(hourly)}</span>
      <span className="col-start-3 text-right text-xs tabular-nums text-muted sm:col-start-auto">{monthly}</span>
      <span className="hidden text-right text-[11px] text-muted sm:inline">{vms}</span>
    </li>
  );
}

/**
 * Running-instance hourly burn by tag key=value. A VM with several tags lands
 * in every bucket, so totals intentionally exceed the global burn; untagged
 * VMs roll into one synthetic bucket so 100% of spend is visible somewhere.
 */
export async function CostByTagCard() {
  const [instanceList, tagRows] = await Promise.all([db.select().from(instances), db.select().from(instanceTags)]);

  const tagsByInstance = new Map<string, { key: string; value: string }[]>();
  for (const tag of tagRows) {
    const arr = tagsByInstance.get(tag.instanceId) ?? [];
    arr.push({ key: tag.key, value: tag.value });
    tagsByInstance.set(tag.instanceId, arr);
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

  const t = await getTranslations("cloud.costs.byTag");
  const tc = await getTranslations("cloud.costs");
  const max = Math.max(untaggedHourly, ...sorted.map((b) => b.hourlyUsd), 0.0001);
  const monthly = (hourly: number) => tc("perMonth", { amount: formatUsd(hourly * HOURS_PER_MONTH) });

  return (
    <PageSection title={t("title")} description={t("description")}>
      <ul className="space-y-2">
        {sorted.map((b) => (
          <TagRow
            key={`${b.key}=${b.value}`}
            label={b.value ? `${b.key}=${b.value}` : b.key}
            hourly={b.hourlyUsd}
            max={max}
            monthly={monthly(b.hourlyUsd)}
            vms={t("vmCount", { count: b.count })}
          />
        ))}
        {untaggedCount > 0 && (
          <li className="border-t border-border pt-2">
            <ul>
              <TagRow
                label={t("untagged")}
                hourly={untaggedHourly}
                max={max}
                muted
                monthly={monthly(untaggedHourly)}
                vms={t("vmCount", { count: untaggedCount })}
              />
            </ul>
          </li>
        )}
      </ul>
    </PageSection>
  );
}
