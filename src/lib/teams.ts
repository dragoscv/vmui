import "server-only";
import { randomBytes } from "node:crypto";
import { eq, desc, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { teams, teamMembers, teamInvitations, users } from "@/lib/db/schema";

export interface TeamWithMembers {
  id: string;
  name: string;
  slug: string;
  members: Array<{ userId: string; email: string; displayName: string; role: string; joinedAt: Date }>;
  invitations: Array<{ id: string; email: string; role: string; expiresAt: Date; accepted: boolean }>;
}

export function createTeam(name: string, slug: string, ownerUserId: string): { id: string } {
  const id = `tm_${randomBytes(8).toString("hex")}`;
  db.insert(teams).values({ id, name, slug }).run();
  db.insert(teamMembers).values({ teamId: id, userId: ownerUserId, role: "owner" }).run();
  return { id };
}

export async function listTeamsForUser(userId: string): Promise<TeamWithMembers[]> {
  const memberships = await db
    .select({ team: teams })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(eq(teamMembers.userId, userId));

  const result: TeamWithMembers[] = [];
  for (const { team } of memberships) {
    const rows = await db
      .select({ tm: teamMembers, u: users })
      .from(teamMembers)
      .innerJoin(users, eq(users.id, teamMembers.userId))
      .where(eq(teamMembers.teamId, team.id));
    const invs = await db
      .select()
      .from(teamInvitations)
      .where(eq(teamInvitations.teamId, team.id))
      .orderBy(desc(teamInvitations.createdAt));
    result.push({
      id: team.id,
      name: team.name,
      slug: team.slug,
      members: rows.map((r) => ({ userId: r.u.id, email: r.u.email, displayName: r.u.displayName, role: r.tm.role, joinedAt: r.tm.joinedAt })),
      invitations: invs.map((i) => ({ id: i.id, email: i.email, role: i.role, expiresAt: i.expiresAt, accepted: i.acceptedAt != null })),
    });
  }
  return result;
}

export function inviteToTeam(teamId: string, email: string, role: "admin" | "operator" | "viewer" | "member", invitedBy: string, ttlHours = 168): { id: string; token: string; expiresAt: Date } {
  const id = `inv_${randomBytes(8).toString("hex")}`;
  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
  db.insert(teamInvitations).values({ id, teamId, email, token, role, invitedBy, expiresAt }).run();
  return { id, token, expiresAt };
}

export function acceptInvitation(token: string, userId: string): { ok: true; teamId: string } | { ok: false; error: string } {
  const inv = db.select().from(teamInvitations).where(eq(teamInvitations.token, token)).get();
  if (!inv) return { ok: false, error: "invitation not found" };
  if (inv.acceptedAt) return { ok: false, error: "already accepted" };
  if (inv.expiresAt.getTime() < Date.now()) return { ok: false, error: "expired" };
  const existing = db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, inv.teamId), eq(teamMembers.userId, userId)))
    .get();
  if (!existing) {
    db.insert(teamMembers).values({ teamId: inv.teamId, userId, role: inv.role }).run();
  }
  db.update(teamInvitations).set({ acceptedAt: new Date() }).where(eq(teamInvitations.id, inv.id)).run();
  return { ok: true, teamId: inv.teamId };
}

export function removeMember(teamId: string, userId: string): void {
  db.delete(teamMembers).where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId))).run();
}
