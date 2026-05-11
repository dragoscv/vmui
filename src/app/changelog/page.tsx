import "server-only";
import { db } from "@/lib/db";
import { auditLog, cloudAccounts } from "@/lib/db/schema";
import { gte, desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

const NOTABLE = new Set([
  "instance.start", "instance.stop", "instance.terminate", "instance.reboot",
  "instance.create", "snapshot.create", "snapshot.delete", "snapshot.restore",
  "drift.remediate", "maintenance.window.create", "policy.create", "policy.delete",
  "team.create", "account.create", "account.delete",
]);

export default async function ChangelogPage(props: { searchParams?: Promise<{ days?: string }> }) {
  const sp = (await props.searchParams) ?? {};
  const days = Math.max(1, Math.min(60, Number(sp.days ?? "7") || 7));
  const since = new Date(Date.now() - days * 86_400_000);

  const [rows, accs] = await Promise.all([
    db.select().from(auditLog).where(gte(auditLog.createdAt, since)).orderBy(desc(auditLog.createdAt)),
    db.select({ id: cloudAccounts.id, name: cloudAccounts.name }).from(cloudAccounts),
  ]);
  const accNames = new Map(accs.map((a) => [a.id, a.name]));
  const filtered = rows.filter((r) => NOTABLE.has(r.action));

  const byDay = new Map<string, typeof filtered>();
  for (const r of filtered) {
    const k = r.createdAt.toISOString().slice(0, 10);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k)!.push(r);
  }

  const md: string[] = [`# vmui changelog — last ${days} days`, ""];
  for (const [day, items] of byDay) {
    md.push(`## ${day}`, "");
    for (const r of items) {
      const acc = r.accountId ? accNames.get(r.accountId) ?? r.accountId : "system";
      const status = r.status === "ok" ? "" : " ❌";
      md.push(`- **${r.action}**${status} · _${acc}_ · ${r.target ?? ""}${r.message ? ` — ${r.message}` : ""}`);
    }
    md.push("");
  }
  if (filtered.length === 0) md.push("_No notable events in this window._");
  const markdown = md.join("\n");

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Changelog</h1>
          <p className="text-sm text-zinc-400">Markdown view of notable audit events. Copy or pipe to release notes.</p>
        </div>
        <form method="GET" className="flex items-center gap-2 text-xs">
          <select name="days" defaultValue={String(days)} className="rounded-md bg-zinc-900 border border-zinc-800 px-2 py-1">
            <option value="1">1 day</option><option value="7">7 days</option><option value="30">30 days</option><option value="60">60 days</option>
          </select>
          <button className="rounded-md bg-emerald-600 hover:bg-emerald-500 text-white px-2 py-1">Reload</button>
        </form>
      </header>

      <pre className="whitespace-pre-wrap rounded-lg border border-zinc-800 bg-zinc-950 p-4 font-mono text-xs leading-relaxed">{markdown}</pre>
    </div>
  );
}
