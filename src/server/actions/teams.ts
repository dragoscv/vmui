"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";
import { requireRole, getCurrentUser } from "@/lib/auth";
import { createTeam, listTeamsForUser, inviteToTeam, acceptInvitation, removeMember } from "@/lib/teams";

const createSchema = z.object({
  name: z.string().min(2).max(80),
  slug: z.string().regex(/^[a-z0-9-]+$/).min(2).max(40),
});

export async function createTeamAction(input: z.infer<typeof createSchema>) {
  const user = await requireRole("admin");
  if (!user) return { ok: false as const, error: "auth required" };
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "invalid" };
  try {
    const t = createTeam(parsed.data.name, parsed.data.slug, user.id);
    db.insert(auditLog).values({ action: "team.create", target: t.id, status: "ok", message: parsed.data.name }).run();
    revalidatePath("/teams");
    return { ok: true as const, id: t.id };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function listMyTeamsAction() {
  const user = await getCurrentUser();
  if (!user) return [];
  return await listTeamsForUser(user.id);
}

const inviteSchema = z.object({
  teamId: z.string().min(1),
  email: z.string().email(),
  role: z.enum(["admin", "operator", "viewer", "member"]).default("member"),
});

export async function inviteToTeamAction(input: z.infer<typeof inviteSchema>) {
  const user = await requireRole("operator");
  if (!user) return { ok: false as const, error: "auth required" };
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "invalid" };
  const r = inviteToTeam(parsed.data.teamId, parsed.data.email, parsed.data.role, user.id);
  db.insert(auditLog).values({ action: "team.invite", target: parsed.data.teamId, status: "ok", message: parsed.data.email }).run();
  revalidatePath("/teams");
  return { ok: true as const, ...r };
}

const acceptSchema = z.object({ token: z.string().min(8) });

export async function acceptInvitationAction(input: z.infer<typeof acceptSchema>) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "auth required" };
  const parsed = acceptSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "invalid" };
  const r = acceptInvitation(parsed.data.token, user.id);
  if (r.ok) {
    db.insert(auditLog).values({ action: "team.accept", target: r.teamId, status: "ok", message: user.email }).run();
    revalidatePath("/teams");
  }
  return r;
}

const removeSchema = z.object({ teamId: z.string().min(1), userId: z.string().min(1) });

export async function removeMemberAction(input: z.infer<typeof removeSchema>) {
  await requireRole("admin");
  const parsed = removeSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "invalid" };
  removeMember(parsed.data.teamId, parsed.data.userId);
  db.insert(auditLog).values({ action: "team.remove_member", target: parsed.data.teamId, status: "ok", message: parsed.data.userId }).run();
  revalidatePath("/teams");
  return { ok: true as const };
}
