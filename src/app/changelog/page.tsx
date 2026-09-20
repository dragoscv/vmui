import "server-only";
import { ChangelogView, type ChangelogDay } from "@/components/activity/changelog-view";
import { Badge, PageHeader, PageShell } from "@/components/ui";
import { db } from "@/lib/db";
import { auditLog, cloudAccounts } from "@/lib/db/schema";
import { desc, gte } from "drizzle-orm";
import { ScrollText } from "lucide-react";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

const NOTABLE = new Set([
  "instance.start",
  "instance.stop",
  "instance.terminate",
  "instance.reboot",
  "instance.create",
  "snapshot.create",
  "snapshot.delete",
  "snapshot.restore",
  "drift.remediate",
  "maintenance.window.create",
  "policy.create",
  "policy.delete",
  "team.create",
  "account.create",
  "account.delete",
]);

export default async function ChangelogPage(props: { searchParams?: Promise<{ days?: string }> }) {
  const sp = (await props.searchParams) ?? {};
  const t = await getTranslations("observe.changelog");
  const days = Math.max(1, Math.min(60, Number(sp.days ?? "7") || 7));
  const since = new Date(Date.now() - days * 86_400_000);

  const [rows, accs] = await Promise.all([
    db.select().from(auditLog).where(gte(auditLog.createdAt, since)).orderBy(desc(auditLog.createdAt)),
    db.select({ id: cloudAccounts.id, name: cloudAccounts.name }).from(cloudAccounts),
  ]);
  const accNames = new Map(accs.map((a) => [a.id, a.name]));
  const filtered = rows.filter((r) => NOTABLE.has(r.action));

  const byDay = new Map<string, ChangelogDay["items"]>();
  for (const r of filtered) {
    const k = r.createdAt.toISOString().slice(0, 10);
    const arr = byDay.get(k) ?? [];
    arr.push({
      id: r.id,
      action: r.action,
      ok: r.status === "ok",
      account: r.accountId ? (accNames.get(r.accountId) ?? r.accountId) : null,
      target: r.target,
      message: r.message,
      at: r.createdAt.getTime(),
    });
    byDay.set(k, arr);
  }
  const groups: ChangelogDay[] = [...byDay.entries()].map(([day, items]) => ({ day, items }));

  const md: string[] = [`# vmui changelog — ${t("mdHeader", { days })}`, ""];
  for (const g of groups) {
    md.push(`## ${g.day}`, "");
    for (const it of g.items) {
      md.push(`- **${it.action}**${it.ok ? "" : " ❌"} · _${it.account ?? "system"}_ · ${it.target ?? ""}${it.message ? ` — ${it.message}` : ""}`);
    }
    md.push("");
  }
  if (filtered.length === 0) md.push(`_${t("empty.title")}_`);

  return (
    <PageShell width="narrow">
      <PageHeader
        title={t("title")}
        description={t("description")}
        icon={<ScrollText />}
        badge={<Badge variant="muted">{t("eventCount", { count: filtered.length })}</Badge>}
      />
      <ChangelogView days={days} groups={groups} markdown={md.join("\n")} />
    </PageShell>
  );
}
