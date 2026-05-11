import "server-only";
import { db } from "@/lib/db";
import { instances, instanceTags } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import Link from "next/link";

export const dynamic = "force-dynamic";

interface DriftRow {
  id: string;
  name: string;
  provider: string;
  region: string;
  onlyProvider: { key: string; value: string }[];
  onlyLocal: { key: string; value: string }[];
  conflicting: { key: string; provider: string; local: string }[];
}

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
  const all = await db.select().from(instances);
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
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Tag drift report</h1>
        <p className="text-sm text-zinc-400">VMs whose vmui-local tags don&rsquo;t match the provider&rsquo;s native tags / labels.</p>
      </header>

      {drifts.length === 0 && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/20 p-5 text-emerald-300 text-sm">
          ✓ No drift detected.
        </div>
      )}

      <div className="space-y-3">
        {drifts.map((d) => (
          <div key={d.id} className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
            <div className="flex items-center justify-between">
              <Link href={`/instances/${encodeURIComponent(d.id)}`} className="text-emerald-300 hover:text-emerald-200 font-medium">{d.name}</Link>
              <span className="text-xs text-zinc-500">{d.provider} · {d.region}</span>
            </div>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <Box title="Only in provider" tone="amber" items={d.onlyProvider} />
              <Box title="Only in vmui-local" tone="sky" items={d.onlyLocal} />
              <ConflictBox items={d.conflicting} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Box({ title, tone, items }: { title: string; tone: "amber" | "sky"; items: { key: string; value: string }[] }) {
  const color = tone === "amber" ? "text-amber-400" : "text-sky-400";
  return (
    <div className="rounded border border-zinc-800 bg-zinc-900 p-2">
      <div className={`text-[10px] uppercase ${color} font-medium`}>{title} ({items.length})</div>
      {items.length === 0 ? <div className="mt-1 text-zinc-600">—</div> : (
        <ul className="mt-1 space-y-0.5">
          {items.map((i) => <li key={i.key} className="font-mono">{i.key}={i.value || <em className="text-zinc-600">empty</em>}</li>)}
        </ul>
      )}
    </div>
  );
}

function ConflictBox({ items }: { items: { key: string; provider: string; local: string }[] }) {
  return (
    <div className="rounded border border-rose-500/30 bg-rose-950/30 p-2">
      <div className="text-[10px] uppercase text-rose-400 font-medium">Conflicting ({items.length})</div>
      {items.length === 0 ? <div className="mt-1 text-zinc-600">—</div> : (
        <ul className="mt-1 space-y-0.5 font-mono">
          {items.map((i) => <li key={i.key}><strong>{i.key}</strong>: <span className="text-amber-300">{i.provider}</span> ≠ <span className="text-sky-300">{i.local}</span></li>)}
        </ul>
      )}
    </div>
  );
}
