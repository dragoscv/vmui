import "server-only";
import { db } from "@/lib/db";
import { stickyNotes } from "@/lib/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { StickyNotesClient } from "./sticky-notes.client";

interface Props {
  accountId: string;
  providerInstanceId: string;
}

export async function StickyNotesCard({ accountId, providerInstanceId }: Props) {
  const notes = await db.select().from(stickyNotes)
    .where(and(eq(stickyNotes.accountId, accountId), eq(stickyNotes.providerInstanceId, providerInstanceId)))
    .orderBy(desc(stickyNotes.createdAt));

  return (
    <StickyNotesClient
      accountId={accountId}
      providerInstanceId={providerInstanceId}
      notes={notes.map((n) => ({
        id: n.id,
        body: n.body,
        color: n.color,
        createdAt: n.createdAt.toISOString(),
        createdBy: n.createdBy ?? null,
      }))}
    />
  );
}
