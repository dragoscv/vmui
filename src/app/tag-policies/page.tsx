import "server-only";
import { db } from "@/lib/db";
import { tagPolicies } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { upsertTagPolicyAction, deleteTagPolicyAction } from "@/server/actions/extras-2";
import { evaluateTagPolicies } from "@/lib/tag-policy";
import Link from "next/link";

export const dynamic = "force-dynamic";

async function create(formData: FormData) {
  "use server";
  const requireKeys = String(formData.get("requireKeys") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  await upsertTagPolicyAction({
    name: String(formData.get("name") ?? ""),
    condition: String(formData.get("condition") ?? ""),
    requireKeys,
    enabled: true,
  });
}

async function remove(formData: FormData) {
  "use server";
  await deleteTagPolicyAction(String(formData.get("id") ?? ""));
}

export default async function TagPoliciesPage() {
  const [policies, violations] = await Promise.all([
    db.select().from(tagPolicies).orderBy(desc(tagPolicies.createdAt)),
    evaluateTagPolicies(),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Tag policies</h1>
        <p className="text-sm text-zinc-400">DSL: <code className="text-xs bg-zinc-900 px-1 rounded">provider=aws AND region~^eu AND tag.team!=&quot;&quot;</code> · operators <code>=, !=, ~, !~</code> · joiners AND/OR.</p>
      </header>

      <form action={create} className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input name="name" required placeholder="Policy name" className="rounded-md bg-zinc-900 border border-zinc-800 px-2 py-1 text-sm" />
          <input name="requireKeys" required placeholder="required tag keys (comma-separated)" className="rounded-md bg-zinc-900 border border-zinc-800 px-2 py-1 text-sm" />
        </div>
        <input name="condition" required placeholder="provider=aws AND region~^eu" className="w-full rounded-md bg-zinc-900 border border-zinc-800 px-2 py-1 text-sm font-mono" />
        <div className="text-right"><button type="submit" className="rounded-md bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1 text-sm">Add policy</button></div>
      </form>

      <div className="rounded-lg border border-zinc-800 bg-zinc-950 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-zinc-500"><tr><th className="px-3 py-2 text-left">Name</th><th className="px-3 py-2 text-left">Condition</th><th className="px-3 py-2 text-left">Required</th><th className="px-3 py-2 text-left">Enabled</th><th className="px-3 py-2"></th></tr></thead>
          <tbody>
            {policies.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-zinc-500">No policies.</td></tr>}
            {policies.map((p) => {
              let req: string[] = [];
              try { req = JSON.parse(p.requireKeysJson) as string[]; } catch { /* ignore */ }
              return (
                <tr key={p.id} className="border-t border-zinc-900">
                  <td className="px-3 py-2">{p.name}</td>
                  <td className="px-3 py-2 font-mono text-xs">{p.condition}</td>
                  <td className="px-3 py-2 font-mono text-xs">{req.join(", ")}</td>
                  <td className="px-3 py-2 text-xs">{p.enabled ? "✓" : "—"}</td>
                  <td className="px-3 py-2 text-right">
                    <form action={remove}><input type="hidden" name="id" value={p.id} /><button type="submit" className="text-rose-300 hover:text-rose-200 text-xs">Delete</button></form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Current violations ({violations.length})</h2>
        {violations.length === 0 && <div className="rounded border border-emerald-500/30 bg-emerald-950/20 p-3 text-sm text-emerald-300">✓ Compliant.</div>}
        {violations.length > 0 && (
          <div className="rounded-lg border border-zinc-800 bg-zinc-950 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-zinc-500"><tr><th className="px-3 py-2 text-left">Instance</th><th className="px-3 py-2 text-left">Policy</th><th className="px-3 py-2 text-left">Missing</th></tr></thead>
              <tbody>
                {violations.map((v, i) => (
                  <tr key={i} className="border-t border-zinc-900">
                    <td className="px-3 py-2"><Link href={`/instances/${encodeURIComponent(v.instanceId)}`} className="text-emerald-300 hover:text-emerald-200">{v.instanceName}</Link></td>
                    <td className="px-3 py-2 text-xs">{v.policyName}</td>
                    <td className="px-3 py-2 font-mono text-xs text-rose-300">{v.missingKeys.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
