import "server-only";
import { db } from "@/lib/db";
import { cloudAccounts, instanceTags, instances } from "@/lib/db/schema";

export interface TagGovernanceSummary {
  perKey: { key: string; instances: number; uniqueValues: number }[];
  totalInstances: number;
  taggedInstances: number;
  untaggedInstances: number;
  accountCoverage: {
    accountId: string;
    accountName: string;
    provider: string;
    requiredKeys: string[];
    totalInstances: number;
    fullyCompliant: number;
    coveragePct: number; // 0-100
  }[];
}

function parseRequiredKeys(json: string | null): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    if (Array.isArray(v)) return v.filter((s): s is string => typeof s === "string" && s.length > 0);
  } catch {
    /* ignore */
  }
  return [];
}

export async function getTagGovernance(): Promise<TagGovernanceSummary> {
  const [allInstances, allTags, allAccounts] = await Promise.all([
    db.select().from(instances),
    db.select().from(instanceTags),
    db.select().from(cloudAccounts),
  ]);

  const tagsByInstance = new Map<string, Map<string, Set<string>>>();
  for (const t of allTags) {
    let m = tagsByInstance.get(t.instanceId);
    if (!m) {
      m = new Map();
      tagsByInstance.set(t.instanceId, m);
    }
    let vs = m.get(t.key);
    if (!vs) {
      vs = new Set();
      m.set(t.key, vs);
    }
    vs.add(t.value);
  }

  const perKeyMap = new Map<string, { instances: Set<string>; values: Set<string> }>();
  for (const t of allTags) {
    let entry = perKeyMap.get(t.key);
    if (!entry) {
      entry = { instances: new Set(), values: new Set() };
      perKeyMap.set(t.key, entry);
    }
    entry.instances.add(t.instanceId);
    entry.values.add(t.value);
  }
  const perKey = [...perKeyMap.entries()]
    .map(([key, v]) => ({ key, instances: v.instances.size, uniqueValues: v.values.size }))
    .sort((a, b) => b.instances - a.instances);

  const totalInstances = allInstances.length;
  const taggedInstances = tagsByInstance.size;
  const untaggedInstances = Math.max(0, totalInstances - taggedInstances);

  const accountCoverage = allAccounts
    .map((acc) => {
      const requiredKeys = parseRequiredKeys(acc.requiredTags ?? null);
      const accountInstances = allInstances.filter((i) => i.accountId === acc.id);
      let fully = 0;
      if (requiredKeys.length > 0) {
        for (const inst of accountInstances) {
          const tagMap = tagsByInstance.get(inst.id);
          const ok =
            tagMap != null &&
            requiredKeys.every((k) => {
              const vs = tagMap.get(k);
              return vs && vs.size > 0;
            });
          if (ok) fully += 1;
        }
      }
      const coverage =
        requiredKeys.length === 0
          ? 100
          : accountInstances.length === 0
            ? 100
            : (fully / accountInstances.length) * 100;
      return {
        accountId: acc.id,
        accountName: acc.name,
        provider: acc.provider,
        requiredKeys,
        totalInstances: accountInstances.length,
        fullyCompliant: fully,
        coveragePct: Math.round(coverage),
      };
    })
    .sort((a, b) => a.coveragePct - b.coveragePct);

  return { perKey, totalInstances, taggedInstances, untaggedInstances, accountCoverage };
}
