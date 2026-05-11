import { db } from "@/lib/db";
import { alertRules, alertChannels, alertFirings } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { AlertChannelsPanel } from "@/components/alerts/alert-channels-panel";
import { AlertRulesPanel } from "@/components/alerts/alert-rules-panel";
import { AlertFiringsList } from "@/components/alerts/alert-firings-list";
import { Bell, Activity as ActivityIcon } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AlertsPage() {
  const [rules, channels, firings] = await Promise.all([
    db.select().from(alertRules).orderBy(desc(alertRules.createdAt)),
    db.select().from(alertChannels).orderBy(desc(alertChannels.createdAt)),
    db.select().from(alertFirings).orderBy(desc(alertFirings.firedAt)).limit(50),
  ]);

  return (
    <div className="space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Bell className="h-6 w-6" /> Alerts
        </h1>
        <p className="text-sm text-muted">
          Threshold rules over live probe metrics, fanned out to Discord, Slack, ntfy, email, webhooks or browser toasts.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <AlertChannelsPanel channels={channels} />
        <AlertRulesPanel rules={rules} channels={channels} />
      </div>

      <section>
        <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
          <ActivityIcon className="h-4 w-4" /> Recent firings
        </h2>
        <AlertFiringsList firings={firings} />
      </section>
    </div>
  );
}
