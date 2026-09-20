import { TagDriftTable, type DriftRow } from "@/components/tags/tag-drift-table";
import { PageHeader, PageShell } from "@/components/ui";
import { db } from "@/lib/db";
import { instances, instanceTags } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { GitCompareArrows } from "lucide-react";
import { getTranslations } from "next-intl/server";
import "server-only";

export const dynamic = "force-dynamic";

function extractProviderTags(rawJson: string | null): Record<string, string> {
  if (!rawJson) return {};
  try {
    const raw = JSON.parse(rawJson) as Record<string, unknown>;
    // AWS shape: Tags = [{Key, Value}]
    if (Array.isArray(raw.Tags)) {
      const out: Record<string, string> = {};
      for (const t of raw.Tags) {
        const obj = t as { Key?: string; Value?: string };
        if (obj.Key) out[obj.Key] = obj.Value ?? "";
      }
      return out;
    }
    // Azure / generic: tags object
    if (raw.tags && typeof raw.tags === "object" && !Array.isArray(raw.tags)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(raw.tags as Record<string, unknown>)) {
        out[k] = typeof v === "string" ? v : v == null ? "" : String(v);
      }
      return out;
    }
    // GCP labels object
    if (raw.labels && typeof raw.labels === "object" && !Array.isArray(raw.labels)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(raw.labels as Record<string, unknown>)) {
        out[k] = typeof v === "string" ? v : v == null ? "" : String(v);
      }
      return out;
    }
    return {};
  } catch { return {}; }
}

export default async function TagDriftPage() {
  const [all, t] = await Promise.all([db.select().from(instances), getTranslations("govern.tagDrift")]);
  const drifts: DriftRow[] = [];

  for (const i of all) {
    const localRows = await db.select().from(instanceTags).where(eq(instanceTags.instanceId, i.id));
    const local: Record<string, string> = {};
    for (const r of localRows.filter((r) => r.source === "local")) local[r.key] = r.value;
    const provider = extractProviderTags(i.rawJson);

    const onlyProvider: { key: string; value: string }[] = [];
    const onlyLocal: { key: string; value: string }[] = [];
    const conflicting: { key: string; provider: string; local: string }[] = [];

    for (const [k, v] of Object.entries(provider)) {
      if (!(k in local)) onlyProvider.push({ key: k, value: v });
      else if (local[k] !== v) conflicting.push({ key: k, provider: v, local: local[k] ?? "" });
    }
    for (const [k, v] of Object.entries(local)) {
      if (!(k in provider)) onlyLocal.push({ key: k, value: v });
    }

    if (onlyProvider.length + onlyLocal.length + conflicting.length === 0) continue;
    drifts.push({
      id: i.id,
      name: i.name ?? i.providerInstanceId,
      provider: i.provider,
      region: i.region,
      onlyProvider, onlyLocal, conflicting,
    });
  }

  drifts.sort((a, b) => (b.onlyProvider.length + b.onlyLocal.length + b.conflicting.length) - (a.onlyProvider.length + a.onlyLocal.length + a.conflicting.length));

  return (
    <PageShell>
      <PageHeader title={t("title")} description={t("description")} icon={<GitCompareArrows />} />
      <TagDriftTable drifts={drifts} />
    </PageShell>
  );
}
