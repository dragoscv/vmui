import "server-only";
import { AuditChainView } from "@/components/audit-chain/audit-chain-view";
import { PageHeader, PageShell } from "@/components/ui";
import { verifyAuditChain } from "@/lib/audit-chain";
import { db } from "@/lib/db";
import { auditChain } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { ShieldCheck } from "lucide-react";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export default async function AuditChainPage() {
  const [verify, segs, t] = await Promise.all([
    verifyAuditChain(),
    db.select().from(auditChain).orderBy(desc(auditChain.id)).limit(50),
    getTranslations("govern.auditChain"),
  ]);

  return (
    <PageShell>
      <PageHeader title={t("title")} description={t("description")} icon={<ShieldCheck />} />
      <AuditChainView verify={verify} segments={segs.map((s) => ({ id: s.id, fromAuditId: s.fromAuditId, toAuditId: s.toAuditId, hash: s.hash, hmac: s.hmac, computedAt: s.computedAt }))} />
    </PageShell>
  );
}
