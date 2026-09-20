import "server-only";

import { createUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { auditLog, homeInvites, homeMembers, pairedDevices, users, type HomeInviteRow, type HomeMemberRow } from "@/lib/db/schema";
import { and, desc, eq, isNull } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { parseGrants, type FamilyRole, type RoomGrants } from "./access";

const INVITE_TTL_MS = 7 * 86_400_000;
const hash = (t: string) => createHash("sha256").update(t).digest("hex");

export type FamilyMember = {
  userId: string;
  email: string;
  displayName: string;
  role: FamilyRole;
  rooms: RoomGrants;
  expiresAt: Date | null;
  lastLoginAt: Date | null;
  devices: Array<{ id: string; name: string; platform: string; lastSeenAt: Date | null }>;
};

export type FamilyInvite = Omit<HomeInviteRow, "tokenHash" | "rooms"> & { rooms: RoomGrants };

async function audit(action: string, target: string, message: string, status: "ok" | "error" = "ok") {
  await db.insert(auditLog).values({ accountId: "home", action, target, status, message });
}

export async function listMembers(): Promise<FamilyMember[]> {
  const rows = await db
    .select({ m: homeMembers, u: users })
    .from(homeMembers)
    .innerJoin(users, eq(users.id, homeMembers.userId))
    .orderBy(homeMembers.createdAt);
  const devs = await db.select().from(pairedDevices).where(eq(pairedDevices.status, "approved"));
  return rows.map(({ m, u }) => ({
    userId: u.id,
    email: u.email,
    displayName: u.displayName,
    role: m.role,
    rooms: parseGrants(m.rooms),
    expiresAt: m.expiresAt,
    lastLoginAt: u.lastLoginAt,
    devices: devs.filter((d) => d.userId === u.id).map((d) => ({ id: d.id, name: d.name, platform: d.platform, lastSeenAt: d.lastSeenAt })),
  }));
}

/** Users with an account but no household membership — candidates for "add existing user". */
export async function nonMembers(): Promise<Array<{ id: string; email: string; displayName: string }>> {
  const rows = await db
    .select({ id: users.id, email: users.email, displayName: users.displayName, m: homeMembers.userId })
    .from(users)
    .leftJoin(homeMembers, eq(homeMembers.userId, users.id));
  return rows.filter((r) => r.m === null).map(({ id, email, displayName }) => ({ id, email, displayName }));
}

export async function upsertMember(input: { userId: string; role: FamilyRole; rooms: RoomGrants; expiresAt: Date | null }, by: string): Promise<HomeMemberRow> {
  const rooms = JSON.stringify(input.role === "owner" ? {} : input.rooms);
  const expiresAt = input.role === "guest" ? input.expiresAt : null;
  await db
    .insert(homeMembers)
    .values({ userId: input.userId, role: input.role, rooms, expiresAt, createdBy: by })
    .onConflictDoUpdate({ target: homeMembers.userId, set: { role: input.role, rooms, expiresAt, updatedAt: new Date() } });
  await audit("family.member.upsert", input.userId, `${input.role} · ${Object.keys(input.rooms).length} rooms · by ${by}`);
  return (await db.select().from(homeMembers).where(eq(homeMembers.userId, input.userId)).get())!;
}

/** Removes household access only; the account (and any VM role) stays. Devices bound to them are revoked. */
export async function removeMember(userId: string, by: string): Promise<void> {
  await db.delete(homeMembers).where(eq(homeMembers.userId, userId));
  await db.update(pairedDevices).set({ status: "revoked" }).where(and(eq(pairedDevices.userId, userId), eq(pairedDevices.status, "approved")));
  await audit("family.member.remove", userId, `by ${by}`);
}

export async function ownerCount(): Promise<number> {
  return (await db.select({ id: homeMembers.userId }).from(homeMembers).where(eq(homeMembers.role, "owner"))).length;
}

/** Owner creates the account directly (child without a phone, temporary password told in person). */
export async function createMemberAccount(input: { email: string; displayName: string; password: string; role: Exclude<FamilyRole, "owner">; rooms: RoomGrants; expiresAt: Date | null }, by: string): Promise<FamilyMember> {
  const u = await createUser({ email: input.email, displayName: input.displayName, password: input.password, role: "viewer" });
  await upsertMember({ userId: u.id, role: input.role, rooms: input.rooms, expiresAt: input.expiresAt }, by);
  await audit("family.member.create", u.id, `${input.email} as ${input.role} by ${by}`);
  return (await listMembers()).find((m) => m.userId === u.id)!;
}

export async function createInvite(input: { name: string; role: Exclude<FamilyRole, "owner">; rooms: RoomGrants; accessExpiresAt: Date | null }, by: string): Promise<{ id: string; token: string; expiresAt: Date }> {
  const id = randomBytes(8).toString("hex");
  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  await db.insert(homeInvites).values({
    id,
    tokenHash: hash(token),
    name: input.name.slice(0, 64),
    role: input.role,
    rooms: JSON.stringify(input.rooms),
    accessExpiresAt: input.role === "guest" ? input.accessExpiresAt : null,
    expiresAt,
    createdBy: by,
  });
  await audit("family.invite.create", id, `${input.name} as ${input.role} by ${by}`);
  return { id, token, expiresAt };
}

export async function listInvites(): Promise<FamilyInvite[]> {
  const rows = await db.select().from(homeInvites).where(isNull(homeInvites.acceptedAt)).orderBy(desc(homeInvites.createdAt));
  return rows
    .filter((r) => r.expiresAt.getTime() > Date.now())
    .map(({ tokenHash: _t, rooms, ...rest }) => ({ ...rest, rooms: parseGrants(rooms) }));
}

export async function revokeInvite(id: string, by: string): Promise<void> {
  await db.delete(homeInvites).where(and(eq(homeInvites.id, id), isNull(homeInvites.acceptedAt)));
  await audit("family.invite.revoke", id, `by ${by}`);
}

/** The invite behind a link, if still valid. Returned to the public /invite page, so no ids leak beyond what the link already carries. */
export async function inviteByToken(token: string): Promise<FamilyInvite | null> {
  if (!token || token.length > 128) return null;
  const r = await db.select().from(homeInvites).where(eq(homeInvites.tokenHash, hash(token))).get();
  if (!r || r.acceptedAt || r.expiresAt.getTime() < Date.now()) return null;
  const { tokenHash: _t, rooms, ...rest } = r;
  return { ...rest, rooms: parseGrants(rooms) };
}

/** Invitee picks their credentials; the account is created with the invite's role and rooms, and the link is burnt. */
export async function acceptInvite(token: string, input: { email: string; displayName: string; password: string }): Promise<{ ok: true; userId: string } | { ok: false; error: "invalid" | "email_taken" }> {
  const inv = await inviteByToken(token);
  if (!inv) return { ok: false, error: "invalid" };
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email.toLowerCase())).get();
  if (existing) return { ok: false, error: "email_taken" };
  const u = await createUser({ email: input.email, displayName: input.displayName, password: input.password, role: "viewer" });
  await upsertMember({ userId: u.id, role: inv.role, rooms: inv.rooms, expiresAt: inv.accessExpiresAt }, `invite:${inv.id}`);
  await db.update(homeInvites).set({ acceptedAt: new Date(), acceptedBy: u.id }).where(eq(homeInvites.id, inv.id));
  await audit("family.invite.accept", inv.id, `${input.email} joined as ${inv.role}`);
  return { ok: true, userId: u.id };
}

/** Bind an approved device to a member so its token carries that member's permissions. */
export async function bindDevice(deviceId: string, userId: string | null, by: string): Promise<void> {
  await db.update(pairedDevices).set({ userId }).where(eq(pairedDevices.id, deviceId));
  await audit("family.device.bind", deviceId, `${userId ?? "unbound"} by ${by}`);
}
