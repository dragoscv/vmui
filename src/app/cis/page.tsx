import "server-only";
import { db } from "@/lib/db";
import { cisCheckResults, instances, cloudAccounts } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { runCisCheckAction } from "@/server/actions/cis";

export const dynamic = "force-dynamic";

export default async function CisPage(props: { searchParams?: Promise<{ instance?: string }> }) {
  const sp = (await props.searchParams) ?? {};
  const linuxInst = await db.select().from(instances).where(eq(instances.platform, "linux"));
  const accs = await db.select({ id: cloudAccounts.id, name: cloudAccounts.name }).from(cloudAccounts);
  const accNames = new Map(accs.map((a) => [a.id, a.name]));
  const selected = sp.instance ? linuxInst.find((i) => i.id === sp.instance) : null;

  const results = selected
    ? await db.select().from(cisCheckResults)
        .where(eq(cisCheckResults.providerInstanceId, selected.providerInstanceId))
        .orderBy(desc(cisCheckResults.ranAt)).limit(100)
    : [];

  async function run(formData: FormData) {
    "use server";
    const instId = String(formData.get("instance") ?? "");
    const inst = linuxInst.find((i) => i.id === instId);
    if (!inst) return;
    await runCisCheckAction({ accountId: inst.accountId, providerInstanceId: inst.providerInstanceId });
  }

  const groupedLatest = new Map<string, typeof results[0]>();
  for (const r of results) if (!groupedLatest.has(r.checkId)) groupedLatest.set(r.checkId, r);
  const summary = { pass: 0, fail: 0, error: 0, skip: 0 };
  for (const v of groupedLatest.values()) summary[v.result] += 1;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">CIS-Linux compliance</h1>
        <p className="text-sm text-zinc-400">Subset of CIS Linux Benchmark v3 evaluated via SSH probe key. Pass = exit 0; fail = non-zero.</p>
      </header>

      <form action={run} className="flex flex-wrap items-end gap-2 rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs">
        <label className="flex flex-col gap-1">Linux instance
          <select name="instance" defaultValue={selected?.id ?? ""} className="rounded-md bg-zinc-900 border border-zinc-800 px-2 py-1 min-w-[260px]">
            <option value="">— pick one —</option>
            {linuxInst.map((i) => <option key={i.id} value={i.id}>{i.name ?? i.providerInstanceId} ({accNames.get(i.accountId) ?? i.accountId})</option>)}
          </select>
        </label>
        <button className="rounded-md bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1">Run scan</button>
      </form>

      {selected && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
            <Cell label="pass" value={summary.pass} color="text-emerald-300" />
            <Cell label="fail" value={summary.fail} color="text-rose-300" />
            <Cell label="error" value={summary.error} color="text-amber-300" />
            <Cell label="skip" value={summary.skip} color="text-zinc-400" />
          </div>
          <section className="rounded-lg border border-zinc-800 bg-zinc-950 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-zinc-500"><tr>
                <th className="px-3 py-2 text-left">Check</th><th className="px-3 py-2 text-left">Title</th><th className="px-3 py-2 text-left">Result</th><th className="px-3 py-2 text-left">Evidence</th>
              </tr></thead>
              <tbody>
                {[...groupedLatest.values()].map((r) => (
                  <tr key={r.id} className="border-t border-zinc-900">
                    <td className="px-3 py-2 font-mono text-xs">{r.checkId}</td>
                    <td className="px-3 py-2">{r.title}</td>
                    <td className="px-3 py-2 text-xs">
                      <span className={r.result === "pass" ? "text-emerald-300" : r.result === "fail" ? "text-rose-300" : r.result === "error" ? "text-amber-300" : "text-zinc-400"}>{r.result}</span>
                    </td>
                    <td className="px-3 py-2 text-xs text-zinc-400 font-mono truncate max-w-md" title={r.evidence ?? ""}>{r.evidence ?? ""}</td>
                  </tr>
                ))}
                {groupedLatest.size === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-zinc-500 text-sm">No results yet — run a scan.</td></tr>}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}

function Cell({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
      <div className="text-xs text-zinc-500 uppercase">{label}</div>
      <div className={`text-xl font-mono ${color}`}>{value}</div>
    </div>
  );
}
