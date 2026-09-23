"use server";

import "server-only";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";
import { requireRole } from "@/lib/auth";
import { err, fromZod, ok, type ActionResult } from "@/lib/action-result";
import { CodaiClient, type CodaiProject } from "@/lib/codai/client";
import { deleteCodaiLink, getCodaiLink } from "@/lib/codai/links";
import { mintInstallCommand, provisionCodaiEnvironment, refreshCodaiStatus, type ProvisionResult } from "@/lib/codai/provision";
import { clearCodaiApiKey, getCodaiSettingsPublic, getCodaiSettingsSecret, saveCodaiSettings, type CodaiSettingsPublic } from "@/lib/codai/settings";

const settingsSchema = z.object({
  gatewayUrl: z.url().max(200),
  apiKey: z
    .string()
    .trim()
    .regex(/^codai_[A-Za-z0-9_-]{16,}$/, "Expected a codai API key (codai_…)")
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

const provisionSchema = z.object({
  instanceId: z.string().min(1),
  projectId: z.string().uuid().optional(),
  projectName: z.string().trim().min(1).max(80).optional(),
  environmentName: z.string().trim().min(1).max(80),
});

function fail(e: unknown): ActionResult<never> {
  return err(e instanceof Error ? e.message : String(e));
}

export async function getCodaiSettingsAction(): Promise<ActionResult<CodaiSettingsPublic>> {
  try {
    await requireRole("viewer");
    return ok(await getCodaiSettingsPublic());
  } catch (e) {
    return fail(e);
  }
}

export async function saveCodaiSettingsAction(input: { gatewayUrl: string; apiKey?: string }): Promise<ActionResult<CodaiSettingsPublic>> {
  try {
    await requireRole("admin");
  } catch (e) {
    return fail(e);
  }
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);
  try {
    await saveCodaiSettings({ gatewayUrl: parsed.data.gatewayUrl, apiKey: parsed.data.apiKey });
    await db.insert(auditLog).values({ action: "codai.settings.save", target: parsed.data.gatewayUrl, status: "ok", message: parsed.data.apiKey ? "api key updated" : "gateway url updated" });
    revalidatePath("/settings");
    return ok(await getCodaiSettingsPublic());
  } catch (e) {
    return fail(e);
  }
}

export async function clearCodaiApiKeyAction(): Promise<ActionResult> {
  try {
    await requireRole("admin");
    await clearCodaiApiKey();
    await db.insert(auditLog).values({ action: "codai.settings.clearKey", status: "ok" });
    revalidatePath("/settings");
    return ok();
  } catch (e) {
    return fail(e);
  }
}

export async function testCodaiConnectionAction(): Promise<ActionResult<{ projects: number }>> {
  try {
    await requireRole("operator");
    const s = await getCodaiSettingsSecret();
    return ok(await new CodaiClient({ gatewayUrl: s.gatewayUrl, apiKey: s.apiKey }).ping());
  } catch (e) {
    return fail(e);
  }
}

export async function listCodaiProjectsAction(): Promise<ActionResult<CodaiProject[]>> {
  try {
    await requireRole("operator");
    const s = await getCodaiSettingsSecret();
    return ok(await new CodaiClient({ gatewayUrl: s.gatewayUrl, apiKey: s.apiKey }).listProjects());
  } catch (e) {
    return fail(e);
  }
}

export interface CodaiLinkView {
  environmentId: string;
  projectId: string;
  slug: string;
  state: string;
  lastCheckedAt: Date | null;
}

export async function getCodaiLinkAction(instanceId: string): Promise<ActionResult<CodaiLinkView | null>> {
  try {
    await requireRole("viewer");
    const link = await getCodaiLink(instanceId);
    if (!link) return ok(null);
    return ok({ environmentId: link.environmentId, projectId: link.projectId, slug: link.slug, state: link.lastStatus, lastCheckedAt: link.lastCheckedAt });
  } catch (e) {
    return fail(e);
  }
}

export async function refreshCodaiStatusAction(instanceId: string): Promise<ActionResult<CodaiLinkView | null>> {
  try {
    await requireRole("viewer");
    const r = await refreshCodaiStatus(instanceId);
    return ok(r ? { ...r, lastCheckedAt: new Date() } : null);
  } catch (e) {
    return fail(e);
  }
}

/**
 * Non-streaming variant (MCP / API). The UI uses the SSE route
 * `/api/instances/:id/codai/provision/stream` for live installer output.
 */
export async function provisionCodaiEnvironmentAction(input: {
  instanceId: string;
  projectId?: string;
  projectName?: string;
  environmentName: string;
}): Promise<ActionResult<ProvisionResult>> {
  let user;
  try {
    user = await requireRole("operator");
  } catch (e) {
    return fail(e);
  }
  const parsed = provisionSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);
  try {
    const r = await provisionCodaiEnvironment(parsed.data, () => {}, { by: user?.email ?? undefined });
    revalidatePath(`/instances/${encodeURIComponent(parsed.data.instanceId)}`);
    return ok(r);
  } catch (e) {
    return fail(e);
  }
}

export async function mintCodaiInstallCommandAction(instanceId: string): Promise<ActionResult<{ command: string; expiresAt: string }>> {
  try {
    await requireRole("operator");
    const r = await mintInstallCommand(instanceId);
    await db.insert(auditLog).values({ action: "codai.enrollToken.mint", target: instanceId, status: "ok", message: `expires ${r.expiresAt}` });
    return ok(r);
  } catch (e) {
    return fail(e);
  }
}

/** Removes the local link only; the environment keeps existing in codai. */
export async function unlinkCodaiEnvironmentAction(instanceId: string): Promise<ActionResult> {
  try {
    await requireRole("operator");
    const link = await getCodaiLink(instanceId);
    await deleteCodaiLink(instanceId);
    await db.insert(auditLog).values({ action: "codai.unlink", target: instanceId, status: "ok", message: link ? `environment ${link.slug} (${link.environmentId})` : "no link" });
    revalidatePath(`/instances/${encodeURIComponent(instanceId)}`);
    return ok();
  } catch (e) {
    return fail(e);
  }
}
