"use server";

import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";
import { requireRole } from "@/lib/auth";
import {
  containerAction,
  inspectContainer,
  listContainersOnInstance,
  containerStats,
  type ContainerListResult,
  type ContainerStats,
} from "@/lib/containers";

const idsSchema = z.object({
  instanceId: z.string().min(1),
  containerId: z.string().min(1).max(128),
});

export async function listContainersAction(
  instanceId: string,
): Promise<{ ok: true; data: ContainerListResult } | { ok: false; error: string }> {
  try {
    await requireRole("viewer");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Not authorized" };
  }
  try {
    const data = await listContainersOnInstance(instanceId);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function containerStatsAction(
  instanceId: string,
): Promise<{ ok: true; data: { rows: ContainerStats[]; runtime: string | null } } | { ok: false; error: string }> {
  try {
    await requireRole("viewer");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Not authorized" };
  }
  try {
    const data = await containerStats(instanceId);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function containerActionAction(input: {
  instanceId: string;
  containerId: string;
  action: "start" | "stop" | "restart" | "remove" | "pull";
}): Promise<{ ok: boolean; output: string; error?: string }> {
  try {
    await requireRole("operator");
  } catch (err) {
    return { ok: false, output: "", error: err instanceof Error ? err.message : "Not authorized" };
  }
  const parsed = idsSchema.safeParse({ instanceId: input.instanceId, containerId: input.containerId });
  if (!parsed.success) return { ok: false, output: "", error: "Bad input" };
  try {
    const r = await containerAction(input.instanceId, input.containerId, input.action);
    await db.insert(auditLog).values({
      action: `container.${input.action}`,
      target: `${input.instanceId}:${input.containerId}`,
      status: r.ok ? "ok" : "error",
      message: r.output.slice(0, 512),
    });
    return r;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed";
    return { ok: false, output: "", error: msg };
  }
}

export async function inspectContainerAction(input: {
  instanceId: string;
  containerId: string;
}): Promise<{ ok: boolean; data: unknown; error?: string }> {
  try {
    await requireRole("viewer");
  } catch (err) {
    return { ok: false, data: null, error: err instanceof Error ? err.message : "Not authorized" };
  }
  const parsed = idsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, data: null, error: "Bad input" };
  try {
    const r = await inspectContainer(input.instanceId, input.containerId);
    if (!r.ok) return { ok: false, data: null, error: r.output };
    return { ok: true, data: r.data };
  } catch (err) {
    return { ok: false, data: null, error: err instanceof Error ? err.message : "Failed" };
  }
}
