import "server-only";
import { db } from "@/lib/db";
import { autoTagRules } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { upsertAutoTagRuleAction, deleteAutoTagRuleAction } from "@/server/actions/sticky-and-tags";

export const dynamic = "force-dynamic";

async function createRule(formData: FormData) {
  "use server";
  await upsertAutoTagRuleAction({
    namePattern: String(formData.get("namePattern") ?? ""),
    tagKey: String(formData.get("tagKey") ?? ""),
    tagValue: String(formData.get("tagValue") ?? ""),
    priority: Number(formData.get("priority") ?? 100),
    enabled: true,
  });
}

async function removeRule(formData: FormData) {
  "use server";
  await deleteAutoTagRuleAction(String(formData.get("id") ?? ""));
}

export default async function AutoTagPage() {
  const rules = await db.select().from(autoTagRules).orderBy(desc(autoTagRules.priority));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Auto-tag rules</h1>
        <p className="text-sm text-zinc-400">VMs whose name matches the regex get the given tag applied at sync time.</p>
      </header>

      <form action={createRule} className="grid gap-3 sm:grid-cols-5 rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-sm">
        <input name="namePattern" placeholder="Regex (e.g. ^prod-)" className="rounded-md bg-zinc-900 border border-zinc-800 px-2 py-1.5 sm:col-span-2" required />
        <input name="tagKey" placeholder="tag key (env)" className="rounded-md bg-zinc-900 border border-zinc-800 px-2 py-1.5" required />
        <input name="tagValue" placeholder="tag value (prod)" className="rounded-md bg-zinc-900 border border-zinc-800 px-2 py-1.5" required />
        <button type="submit" className="rounded-md bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5">Add rule</button>
      </form>

      <div className="rounded-lg border border-zinc-800 bg-zinc-950 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-zinc-500">
            <tr><th className="px-4 py-2 text-left">Pattern</th><th className="px-4 py-2 text-left">Tag</th><th className="px-4 py-2 text-left">Priority</th><th className="px-4 py-2 text-left">Enabled</th><th className="px-4 py-2"></th></tr>
          </thead>
          <tbody>
            {rules.length === 0 && (
              <tr><td className="px-4 py-6 text-zinc-500" colSpan={5}>No rules yet.</td></tr>
            )}
            {rules.map((r) => (
              <tr key={r.id} className="border-t border-zinc-900">
                <td className="px-4 py-2 font-mono text-xs">{r.namePattern}</td>
                <td className="px-4 py-2"><span className="rounded bg-zinc-800 px-2 py-0.5 text-xs">{r.tagKey}={r.tagValue}</span></td>
                <td className="px-4 py-2">{r.priority}</td>
                <td className="px-4 py-2">{r.enabled === 1 ? "yes" : "no"}</td>
                <td className="px-4 py-2 text-right">
                  <form action={removeRule}>
                    <input type="hidden" name="id" value={r.id} />
                    <button type="submit" className="text-rose-300 hover:text-rose-200 text-xs">Delete</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
