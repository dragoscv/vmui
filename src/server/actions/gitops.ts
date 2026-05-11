"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { gitSources, gitApplyHistory, auditLog } from "@/lib/db/schema";
import { requireRole } from "@/lib/auth";
import { encryptGitAuth, syncGitSource, deleteGitSourceCache } from "@/lib/gitops";

const CreateSourceSchema = z.object({
  name: z.string().min(1).max(80),
  url: z.string().url().or(z.string().regex(/^git@/)).or(z.string().regex(/^ssh:\/\//)),
  branch: z.string().min(1).max(120).default("main"),
  authType: z.enum(["none", "token", "ssh"]).default("none"),
  token: z.string().max(4000).optional(),
  sshKey: z.string().max(10000).optional(),
  username: z.string().max(200).optional(),
  composeGlob: z.string().min(1).max(200).default("**/docker-compose.y*ml"),
  targetInstanceId: z.string().optional(),
  pollSeconds: z.number().int().min(15).max(86400).default(60),
});

export async function createGitSourceAction(input: z.infer<typeof CreateSourceSchema>) {
  await requireRole("operator");
  const v = CreateSourceSchema.parse(input);
  const id = randomUUID();
  const authBlob =
    v.authType === "none"
      ? null
      : encryptGitAuth({ token: v.token, sshKey: v.sshKey, username: v.username });
  db.insert(gitSources)
    .values({
      id,
      name: v.name,
      url: v.url,
      branch: v.branch,
      authType: v.authType,
      authBlob,
      composeGlob: v.composeGlob,
      targetInstanceId: v.targetInstanceId ?? null,
      pollSeconds: v.pollSeconds,
      enabled: true,
    })
    .run();
  db.insert(auditLog)
    .values({ action: "gitops.create", target: id, status: "ok", message: v.name })
    .run();
  revalidatePath("/gitops");
  return { ok: true as const, id };
}

export async function deleteGitSourceAction(input: { id: string }) {
  await requireRole("operator");
  db.delete(gitSources).where(eq(gitSources.id, input.id)).run();
  await deleteGitSourceCache(input.id);
  db.insert(auditLog).values({ action: "gitops.delete", target: input.id, status: "ok" }).run();
  revalidatePath("/gitops");
  return { ok: true as const };
}

export async function toggleGitSourceAction(input: { id: string; enabled: boolean }) {
  await requireRole("operator");
  db.update(gitSources).set({ enabled: input.enabled }).where(eq(gitSources.id, input.id)).run();
  revalidatePath("/gitops");
  return { ok: true as const };
}

export async function syncGitSourceNowAction(input: { id: string }) {
  await requireRole("operator");
  const r = await syncGitSource(input.id);
  revalidatePath("/gitops");
  return r;
}

export async function listGitSourcesAction() {
  await requireRole("viewer");
  const rows = db.select().from(gitSources).orderBy(desc(gitSources.createdAt)).all();
  return { ok: true as const, rows: rows.map(({ authBlob, ...r }) => r) };
}

export async function listGitHistoryAction(input: { sourceId?: string }) {
  await requireRole("viewer");
  const q = db.select().from(gitApplyHistory).orderBy(desc(gitApplyHistory.createdAt)).limit(100);
  const rows = input.sourceId
    ? q.where(eq(gitApplyHistory.sourceId, input.sourceId)).all()
    : q.all();
  return { ok: true as const, rows };
}
