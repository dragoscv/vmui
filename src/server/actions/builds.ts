"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { imageBuilds, registryCredentials, auditLog } from "@/lib/db/schema";
import { requireRole } from "@/lib/auth";
import { encryptCreds, runBuild, type RegistryType } from "@/lib/builds";
import { sendPush } from "@/lib/push";

const REGISTRY_TYPES = ["ecr", "gcr", "acr", "dockerhub", "ghcr"] as const;

const CreateRegistrySchema = z.object({
  name: z.string().min(1).max(80),
  type: z.enum(REGISTRY_TYPES),
  registryUrl: z.string().min(1).max(200),
  username: z.string().max(200).optional(),
  password: z.string().max(2000).optional(),
  token: z.string().max(4000).optional(),
  accessKeyId: z.string().max(200).optional(),
  secretAccessKey: z.string().max(2000).optional(),
  region: z.string().max(50).optional(),
  serviceAccountJson: z.string().max(20000).optional(),
});

export async function createRegistryAction(input: z.infer<typeof CreateRegistrySchema>) {
  await requireRole("operator");
  const v = CreateRegistrySchema.parse(input);
  const id = randomUUID();
  const blob = encryptCreds({
    username: v.username,
    password: v.password,
    token: v.token,
    accessKeyId: v.accessKeyId,
    secretAccessKey: v.secretAccessKey,
    region: v.region,
    serviceAccountJson: v.serviceAccountJson,
  });
  db.insert(registryCredentials)
    .values({ id, name: v.name, type: v.type, registryUrl: v.registryUrl, credentials: blob })
    .run();
  db.insert(auditLog)
    .values({ action: "registry.create", target: id, status: "ok", message: `${v.type} ${v.name}` })
    .run();
  revalidatePath("/builds");
  return { ok: true as const, id };
}

export async function deleteRegistryAction(input: { id: string }) {
  await requireRole("operator");
  db.delete(registryCredentials).where(eq(registryCredentials.id, input.id)).run();
  db.insert(auditLog)
    .values({ action: "registry.delete", target: input.id, status: "ok" })
    .run();
  revalidatePath("/builds");
  return { ok: true as const };
}

export async function listRegistriesAction() {
  await requireRole("viewer");
  const rows = db
    .select({
      id: registryCredentials.id,
      name: registryCredentials.name,
      type: registryCredentials.type,
      registryUrl: registryCredentials.registryUrl,
      createdAt: registryCredentials.createdAt,
    })
    .from(registryCredentials)
    .orderBy(desc(registryCredentials.createdAt))
    .all();
  return { ok: true as const, rows };
}

const KickoffBuildSchema = z.object({
  registryId: z.string().min(1),
  imageRef: z.string().min(3).max(300),
  dockerfile: z.string().min(1).max(100_000),
  buildLocation: z.enum(["local", "remote"]),
  instanceId: z.string().optional(),
});

export async function kickoffBuildAction(input: z.infer<typeof KickoffBuildSchema>) {
  await requireRole("operator");
  const v = KickoffBuildSchema.parse(input);
  if (v.buildLocation === "remote" && !v.instanceId) {
    return { ok: false as const, error: "instanceId required for remote build" };
  }
  const id = randomUUID();
  db.insert(imageBuilds)
    .values({
      id,
      registryId: v.registryId,
      imageRef: v.imageRef,
      buildLocation: v.buildLocation,
      instanceId: v.instanceId ?? null,
      dockerfile: v.dockerfile,
      status: "pending",
    })
    .run();
  db.insert(auditLog)
    .values({ action: "build.start", target: id, status: "ok", message: v.imageRef })
    .run();

  // Fire-and-forget — log result to audit when finished.
  void runBuild({
    buildId: id,
    registryId: v.registryId,
    imageRef: v.imageRef,
    dockerfile: v.dockerfile,
    buildLocation: v.buildLocation,
    instanceId: v.instanceId,
  })
    .then(() => {
      const row = db.select().from(imageBuilds).where(eq(imageBuilds.id, id)).get();
      db.insert(auditLog)
        .values({
          action: "build.finish",
          target: id,
          status: row?.status === "success" ? "ok" : "error",
          message: row?.imageRef ?? "",
        })
        .run();
      void sendPush("builds", {
        title: row?.status === "success" ? "Build succeeded" : "Build failed",
        body: row?.imageRef ?? id,
        url: "/builds",
        tag: `build:${id}`,
      });
    })
    .catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : "unknown";
      db.update(imageBuilds)
        .set({ status: "failed", logOutput: msg, finishedAt: new Date() })
        .where(eq(imageBuilds.id, id))
        .run();
    });

  revalidatePath("/builds");
  return { ok: true as const, id };
}

export async function listBuildsAction() {
  await requireRole("viewer");
  const rows = db
    .select()
    .from(imageBuilds)
    .orderBy(desc(imageBuilds.createdAt))
    .limit(50)
    .all();
  return { ok: true as const, rows };
}

export async function getBuildAction(input: { id: string }) {
  await requireRole("viewer");
  const row = db.select().from(imageBuilds).where(eq(imageBuilds.id, input.id)).get();
  return row ? { ok: true as const, row } : { ok: false as const, error: "not found" };
}

export async function listRegistryTypesAction() {
  return { ok: true as const, types: REGISTRY_TYPES as readonly RegistryType[] };
}
