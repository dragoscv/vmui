import { db } from "@/lib/db";
import { instanceRunbooks } from "@/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { RunbookEditorClient } from "./runbook-editor.client";

export async function RunbookEditor({ accountId, providerInstanceId }: { accountId: string; providerInstanceId: string }) {
  const rows = await db.select().from(instanceRunbooks)
    .where(and(eq(instanceRunbooks.accountId, accountId), eq(instanceRunbooks.providerInstanceId, providerInstanceId)))
    .orderBy(desc(instanceRunbooks.updatedAt));
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
      <RunbookEditorClient accountId={accountId} providerInstanceId={providerInstanceId} initial={rows} />
    </div>
  );
}
