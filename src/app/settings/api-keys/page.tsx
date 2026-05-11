import "server-only";
import { redirect } from "next/navigation";
import { Key } from "lucide-react";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { apiKeys } from "@/lib/db/schema";
import { getCurrentUser, ROLE_RANK, authEnabled } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ApiKeysManager } from "@/components/settings/api-keys-manager";

export const dynamic = "force-dynamic";

export default async function ApiKeysPage() {
  if (await authEnabled()) {
    const me = await getCurrentUser();
    if (!me || ROLE_RANK[me.role] < ROLE_RANK.admin) {
      redirect("/");
    }
  }
  const rows = await db.select().from(apiKeys).orderBy(desc(apiKeys.createdAt));

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">API keys</h1>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Key className="h-4 w-4" /> Public /api/v1 keys
          </CardTitle>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>
      <p className="text-xs text-muted">
        Use as <code className="rounded bg-[var(--color-surface-2)] px-1">Authorization: Bearer &lt;key&gt;</code>.{" "}
        <Badge variant="info">operator</Badge> can mutate, <Badge variant="muted">viewer</Badge> read-only.
      </p>
    </div>
  );
}
