import "server-only";
import { db } from "@/lib/db";
import { instanceWebhooks, cloudAccounts } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { upsertInstanceWebhookAction, deleteInstanceWebhookAction } from "@/server/actions/extras";

export const dynamic = "force-dynamic";

async function create(formData: FormData) {
  "use server";
  await upsertInstanceWebhookAction({
    url: String(formData.get("url") ?? ""),
    secret: String(formData.get("secret") ?? "") || null,
    accountId: String(formData.get("accountId") ?? "") || null,
    providerInstanceId: String(formData.get("providerInstanceId") ?? "") || null,
    enabled: true,
  });
}
async function remove(formData: FormData) {
  "use server";
  await deleteInstanceWebhookAction(String(formData.get("id") ?? ""));
}

export default async function WebhooksPage() {
  const [hooks, accs] = await Promise.all([
    db.select().from(instanceWebhooks).orderBy(desc(instanceWebhooks.createdAt)),
    db.select().from(cloudAccounts),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Webhooks</h1>
        <p className="text-sm text-zinc-400">POST JSON to a URL on instance state transitions. Optional <code>x-vmui-signature: sha256=…</code> HMAC header when a secret is set.</p>
      </header>

      <form action={create} className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input name="url" type="url" required placeholder="https://example.com/hook" className="rounded-md bg-zinc-900 border border-zinc-800 px-2 py-1 text-sm sm:col-span-2" />
          <input name="secret" type="text" placeholder="HMAC secret (optional)" className="rounded-md bg-zinc-900 border border-zinc-800 px-2 py-1 text-sm" />
          <select name="accountId" className="rounded-md bg-zinc-900 border border-zinc-800 px-2 py-1 text-sm">
            <option value="">All accounts</option>
            {accs.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <input name="providerInstanceId" type="text" placeholder="Provider instance id (blank = all)" className="rounded-md bg-zinc-900 border border-zinc-800 px-2 py-1 text-sm sm:col-span-2 font-mono" />
        </div>
        <div className="text-right"><button type="submit" className="rounded-md bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1 text-sm">Add webhook</button></div>
      </form>

      <div className="rounded-lg border border-zinc-800 bg-zinc-950 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-zinc-500"><tr><th className="px-3 py-2 text-left">URL</th><th className="px-3 py-2 text-left">Scope</th><th className="px-3 py-2 text-left">Last fire</th><th className="px-3 py-2"></th></tr></thead>
          <tbody>
            {hooks.length === 0 && <tr><td colSpan={4} className="px-3 py-4 text-zinc-500">No webhooks.</td></tr>}
            {hooks.map((h) => (
              <tr key={h.id} className="border-t border-zinc-900">
                <td className="px-3 py-2 font-mono text-xs break-all max-w-xs">{h.url}</td>
                <td className="px-3 py-2 text-xs text-zinc-400">
                  {h.accountId ?? "all accounts"}{h.providerInstanceId ? ` · ${h.providerInstanceId}` : ""}
                </td>
                <td className="px-3 py-2 text-xs">{h.lastFiredAt ? `${h.lastFiredAt.toLocaleString()} · ${h.lastStatus}` : "—"}</td>
                <td className="px-3 py-2 text-right">
                  <form action={remove}><input type="hidden" name="id" value={h.id} /><button type="submit" className="text-rose-300 hover:text-rose-200 text-xs">Delete</button></form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
