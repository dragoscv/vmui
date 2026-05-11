"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { sessions, users, auditLog, type SessionRow } from "@/lib/db/schema";
import { getCurrentUser, ROLE_RANK } from "@/lib/auth";

export interface SessionListItem {
  id: string;
  userId: string;
  email: string;
  displayName: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  isCurrent: boolean;
}

export async function listSessionsAction(): Promise<SessionListItem[]> {
  const me = await getCurrentUser();
  if (!me) return [];
  const isAdmin = ROLE_RANK[me.role] >= ROLE_RANK.admin;
  const jar = await cookies();
  const currentSid = jar.get("vmui_session")?.value ?? null;
  const rows = await db
    .select({
      session: sessions,
      user: users,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId));
  const filtered = isAdmin ? rows : rows.filter((r) => r.user.id === me.id);
  return filtered
    .map(({ session, user }) => ({
      id: session.id,
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
      createdAt: session.createdAt,
      lastSeenAt: session.lastSeenAt,
      expiresAt: session.expiresAt,
      isCurrent: session.id === currentSid,
    }))
    .sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime());
}

export async function revokeSessionAction(sessionId: string): Promise<{ ok: boolean; error?: string }> {
  const me = await getCurrentUser();
  if (!me) return { ok: false, error: "Not authenticated" };
  const row: SessionRow | undefined = (await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1))[0];
  if (!row) return { ok: false, error: "Session not found" };
  const isAdmin = ROLE_RANK[me.role] >= ROLE_RANK.admin;
  if (!isAdmin && row.userId !== me.id) {
    return { ok: false, error: "You can only revoke your own sessions" };
  }
  await db.delete(sessions).where(eq(sessions.id, sessionId));
  await db.insert(auditLog).values({
    action: "auth.session.revoke",
    target: row.userId,
    status: "ok",
    message: row.id === (await cookies()).get("vmui_session")?.value ? "self (current)" : "other",
  });
  revalidatePath("/settings/users");
  return { ok: true };
}

export async function revokeAllOtherSessionsAction(): Promise<{ ok: boolean; count: number }> {
  const me = await getCurrentUser();
  if (!me) return { ok: false, count: 0 };
  const jar = await cookies();
  const currentSid = jar.get("vmui_session")?.value ?? "";
  const before = (await db.select().from(sessions).where(eq(sessions.userId, me.id))).length;
  await db
    .delete(sessions)
    .where(and(eq(sessions.userId, me.id), ne(sessions.id, currentSid)));
  const removed = Math.max(0, before - 1);
  await db.insert(auditLog).values({
    action: "auth.session.revoke-all",
    target: me.id,
    status: "ok",
    message: `${removed} session(s) revoked`,
  });
  revalidatePath("/settings/users");
  return { ok: true, count: removed };
}
