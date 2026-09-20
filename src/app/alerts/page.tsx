import { AlertChannelsPanel } from "@/components/alerts/alert-channels-panel";
import { AlertFiringsList } from "@/components/alerts/alert-firings-list";
import { AlertRulesPanel } from "@/components/alerts/alert-rules-panel";
import { Alert, Badge, PageHeader, PageSection, PageShell, Stat, StatGrid } from "@/components/ui";
import { db } from "@/lib/db";
import { alertChannels, alertFirings, alertRules } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { Bell, BellRing, Radio, ShieldCheck } from "lucide-react";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export default async function AlertsPage() {
  const t = await getTranslations("observe.alerts");
  const [rules, channels, firings] = await Promise.all([
    db.select().from(alertRules).orderBy(desc(alertRules.createdAt)),
    db.select().from(alertChannels).orderBy(desc(alertChannels.createdAt)),
    db.select().from(alertFirings).orderBy(desc(alertFirings.firedAt)).limit(50),
  ]);
  const firing = firings.filter((f) => f.status === "firing");
  const enabledRules = rules.filter((r) => r.enabled).length;

  return (
    <PageShell>
      <PageHeader
        title={t("title")}
        description={t("description")}
        icon={<Bell />}
        badge={
          firing.length > 0 ? (
            <Badge variant="danger" dot>
              {t("firingCount", { count: firing.length })}
            </Badge>
          ) : (
            <Badge variant="success">{t("allQuiet")}</Badge>
          )
        }
      />

      {firing.length > 0 && (
        <Alert tone="danger" title={t("firingBanner.title", { count: firing.length })}>
          <ul className="mt-1 space-y-0.5 font-mono text-xs">
            {firing.slice(0, 5).map((f) => (
              <li key={f.id} className="truncate">
                {f.metric} = {f.value} · {f.instanceId ?? "—"}
              </li>
            ))}
            {firing.length > 5 && <li>{t("firingBanner.more", { count: firing.length - 5 })}</li>}
          </ul>
        </Alert>
      )}

      <StatGrid cols={3}>
        <Stat label={t("stats.rules")} value={rules.length} hint={t("stats.enabled", { count: enabledRules })} icon={<BellRing />} />
        <Stat label={t("stats.channels")} value={channels.length} icon={<Radio />} />
        <Stat label={t("stats.firing")} value={firing.length} tone={firing.length > 0 ? "danger" : "success"} icon={<ShieldCheck />} />
      </StatGrid>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <PageSection title={t("rules.title")} description={t("rules.description")}>
          <AlertRulesPanel rules={rules} channels={channels} />
        </PageSection>
        <PageSection title={t("channels.title")} description={t("channels.description")}>
          <AlertChannelsPanel channels={channels} />
        </PageSection>
      </div>

      <PageSection title={t("firings.title")} description={t("firings.description")}>
        <AlertFiringsList firings={firings} />
      </PageSection>
    </PageShell>
  );
}
