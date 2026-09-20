import { NotificationCenter, type NotificationItem } from "@/components/activity/notification-center";
import { Badge, Button, PageHeader, PageShell } from "@/components/ui";
import { listNotifications } from "@/lib/notifications";
import { Bell, History } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const t = await getTranslations("observe.notifications");
  const rows = await listNotifications({ includeDismissed: true, limit: 200 });
  const items: NotificationItem[] = rows.map((r) => ({
    id: r.id,
    category: r.category,
    severity: r.severity,
    title: r.title,
    body: r.body,
    href: r.href,
    createdAt: new Date(r.createdAt).getTime(),
    seenAt: r.seenAt ? new Date(r.seenAt).getTime() : null,
    dismissedAt: r.dismissedAt ? new Date(r.dismissedAt).getTime() : null,
  }));
  const unread = items.filter((i) => !i.seenAt && !i.dismissedAt).length;

  return (
    <PageShell width="narrow">
      <PageHeader
        title={t("title")}
        description={t("description")}
        icon={<Bell />}
        badge={unread > 0 ? <Badge variant="info" dot>{t("unreadCount", { count: unread })}</Badge> : undefined}
        actions={
          <Button variant="ghost" size="sm" asChild>
            <Link href="/activity">
              <History className="size-4" aria-hidden /> {t("fullRecord")}
            </Link>
          </Button>
        }
      />
      <NotificationCenter items={items} />
    </PageShell>
  );
}
