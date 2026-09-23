import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { codaiEnvironments, type CodaiEnvironmentRow } from "@/lib/db/schema";

export async function getCodaiLink(instanceId: string): Promise<CodaiEnvironmentRow | null> {
  return (await db.query.codaiEnvironments.findFirst({ where: eq(codaiEnvironments.instanceId, instanceId) })) ?? null;
}

export async function upsertCodaiLink(row: {
  instanceId: string;
  environmentId: string;
  projectId: string;
  slug: string;
  lastStatus: string;
}): Promise<void> {
  await db
    .insert(codaiEnvironments)
    .values({ ...row, lastCheckedAt: new Date() })
    .onConflictDoUpdate({
      target: codaiEnvironments.instanceId,
      set: {
        environmentId: row.environmentId,
        projectId: row.projectId,
        slug: row.slug,
        lastStatus: row.lastStatus,
        lastCheckedAt: new Date(),
      },
    });
}

export async function updateCodaiLinkStatus(instanceId: string, lastStatus: string): Promise<void> {
  await db.update(codaiEnvironments).set({ lastStatus, lastCheckedAt: new Date() }).where(eq(codaiEnvironments.instanceId, instanceId));
}

export async function deleteCodaiLink(instanceId: string): Promise<void> {
  await db.delete(codaiEnvironments).where(eq(codaiEnvironments.instanceId, instanceId));
}
