import "server-only";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLog, cloudAccounts, instances } from "@/lib/db/schema";
import { decryptJSON } from "@/lib/crypto";

export async function listAccounts() {
  const rows = await db.select().from(cloudAccounts).orderBy(desc(cloudAccounts.createdAt));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    provider: r.provider,
    defaultRegion: r.defaultRegion,
    createdAt: r.createdAt,
    meta: r.metadataEnc
      ? decryptJSON<{ accountId: string; label: string }>(r.metadataEnc)
      : null,
  }));
}

export async function listInstances() {
  return db.select().from(instances).orderBy(desc(instances.lastSyncedAt));
}

export async function getInstanceById(id: string) {
  const rows = await db.select().from(instances).where(eq(instances.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function listAuditLog(limit = 25) {
  return db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(limit);
}
