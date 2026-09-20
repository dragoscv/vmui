import { ApiKeysManager } from "@/components/settings/api-keys-manager";
import { PageHeader, PageShell } from "@/components/ui";
import { authEnabled, getCurrentUser, ROLE_RANK } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiKeys } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { Key } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import "server-only";

export const dynamic = "force-dynamic";

export default async function ApiKeysPage() {
  if (await authEnabled()) {
    const me = await getCurrentUser();
    if (!me || ROLE_RANK[me.role] < ROLE_RANK.admin) {
      redirect("/");
    }
  }
  const [rows, t] = await Promise.all([
    db.select().from(apiKeys).orderBy(desc(apiKeys.createdAt)),
    getTranslations("settings.access.apiKeys"),
  ]);

  return (
    <PageShell width="narrow">
      <PageHeader title={t("title")} description={t("description")} icon={<Key />} />
      <ApiKeysManager
        keys={rows.map((k) => ({
          id: k.id,
          name: k.name,
          role: k.role,
          rateLimitPerMinute: k.rateLimitPerMinute,
          createdAt: k.createdAt,
          revokedAt: k.revokedAt,
          lastUsedAt: k.lastUsedAt,
        }))}
      />
      <p className="text-xs text-fg-muted">
        {t.rich("usage", { code: (chunks) => <code className="rounded bg-surface-2 px-1 font-mono">{chunks}</code> })}
      </p>
    </PageShell>
  );
}
