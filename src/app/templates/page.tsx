import "server-only";
import { db } from "@/lib/db";
import { launchTemplates, cloudAccounts } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import Link from "next/link";
import { deleteLaunchTemplateAction } from "@/server/actions/templates-and-budgets";

export const dynamic = "force-dynamic";

async function remove(formData: FormData) {
  "use server";
  await deleteLaunchTemplateAction(String(formData.get("id") ?? ""));
}

export default async function TemplatesPage() {
  const tpls = await db.select().from(launchTemplates).orderBy(desc(launchTemplates.createdAt));
  const accs = await db.select().from(cloudAccounts);
  const accMap = new Map(accs.map((a) => [a.id, a.name]));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Launch templates</h1>
        <p className="text-sm text-zinc-400">
          Saved VM configurations. Create one from any instance via &ldquo;Save as template&rdquo; on the detail page.
        </p>
      </header>

      <div className="rounded-lg border border-zinc-800 bg-zinc-950 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-zinc-500"><tr><th className="px-3 py-2 text-left">Name</th><th className="px-3 py-2 text-left">Account</th><th className="px-3 py-2 text-left">Region</th><th className="px-3 py-2 text-left">Type</th><th className="px-3 py-2 text-left">Created</th><th className="px-3 py-2"></th></tr></thead>
          <tbody>
            {tpls.length === 0 && (
              <tr><td className="px-3 py-6 text-zinc-500" colSpan={6}>No templates yet.</td></tr>
            )}
            {tpls.map((t) => {
              const launchHref = `/instances/new?accountId=${encodeURIComponent(t.accountId)}&region=${encodeURIComponent(t.region)}&instanceType=${encodeURIComponent(t.instanceType)}&platform=${t.platform}&fromTemplate=${t.id}`;
              return (
                <tr key={t.id} className="border-t border-zinc-900">
                  <td className="px-3 py-2">
                    <div className="font-medium">{t.name}</div>
                    {t.description && <div className="text-xs text-zinc-500">{t.description}</div>}
                  </td>
                  <td className="px-3 py-2 text-xs">{accMap.get(t.accountId) ?? t.accountId.slice(0, 8)}</td>
                  <td className="px-3 py-2 text-xs">{t.region}</td>
                  <td className="px-3 py-2 font-mono text-xs">{t.instanceType}</td>
                  <td className="px-3 py-2 text-xs text-zinc-400">{t.createdAt.toLocaleDateString()}</td>
                  <td className="px-3 py-2 text-right space-x-2">
                    <Link href={launchHref} className="rounded-md bg-emerald-600 hover:bg-emerald-500 text-white px-2 py-1 text-xs">Launch</Link>
                    <form action={remove} className="inline">
                      <input type="hidden" name="id" value={t.id} />
                      <button type="submit" className="text-rose-300 hover:text-rose-200 text-xs">Delete</button>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
