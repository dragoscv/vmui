"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { randomBytes, randomInt } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { cloudAccounts, auditLog, instanceTags, instances } from "@/lib/db/schema";
import { encryptJSON } from "@/lib/crypto";
import { getProvider } from "@/lib/providers/registry";
import { AwsProvider } from "@/lib/providers/aws";
import { ScalewayProvider } from "@/lib/providers/scaleway";
import { LocalKvmProvider, type LocalKvmCredentials } from "@/lib/providers/local-kvm";
import { AzureProvider } from "@/lib/providers/azure";
import { GcpProvider } from "@/lib/providers/gcp";
import { DigitalOceanProvider } from "@/lib/providers/digitalocean";
import {
  hasAwsCli,
  listAwsProfiles,
  resolveProfileViaCli,
  type AwsProfile,
} from "@/lib/providers/aws-profiles";

const awsCredentialsSchema = z.object({
  name: z.string().min(1, "Name is required").max(64),
  accessKeyId: z.string().regex(/^[A-Z0-9]{16,32}$/, "Invalid AWS Access Key ID"),
  secretAccessKey: z.string().min(20, "Invalid AWS Secret Access Key"),
  sessionToken: z.string().optional(),
  defaultRegion: z.string().regex(/^[a-z0-9-]+$/, "Invalid region"),
});

export type AwsAccountFormState = {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  accountId?: string;
};

export async function addAwsAccount(
  _prev: AwsAccountFormState,
  formData: FormData,
): Promise<AwsAccountFormState> {
  const parsed = awsCredentialsSchema.safeParse({
    name: formData.get("name"),
    accessKeyId: formData.get("accessKeyId"),
    secretAccessKey: formData.get("secretAccessKey"),
    sessionToken: formData.get("sessionToken") || undefined,
    defaultRegion: formData.get("defaultRegion"),
  });
  if (!parsed.success) {
    const fe: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const k = issue.path[0];
      if (typeof k === "string" && !fe[k]) fe[k] = issue.message;
    }
    return { error: "Please fix the highlighted fields.", fieldErrors: fe };
  }

  const { name, defaultRegion, ...creds } = parsed.data;
  const provider = new AwsProvider({ ...creds, defaultRegion });

  let identity;
  try {
    identity = await provider.verify();
  } catch (err) {
    return {
      error:
        err instanceof Error ? `Verification failed: ${err.message}` : "Failed to verify credentials.",
    };
  }

  const id = nanoid(12);
  await db.insert(cloudAccounts).values({
    id,
    provider: "aws",
    name,
    defaultRegion,
    credentialsEnc: encryptJSON(creds),
    metadataEnc: encryptJSON({ accountId: identity.accountId, label: identity.label }),
  });

  await db.insert(auditLog).values({
    accountId: id,
    action: "account.create",
    target: identity.accountId,
    status: "ok",
    message: `AWS account "${name}" connected (${identity.accountId})`,
  });

  revalidatePath("/accounts");
  revalidatePath("/");
  return { ok: true, accountId: id };
}

export async function deleteAccount(accountId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireRole("admin");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Not authorized" };
  }
  await db.delete(cloudAccounts).where(eq(cloudAccounts.id, accountId));
  await db.insert(auditLog).values({
    accountId,
    action: "account.delete",
    status: "ok",
  });
  revalidatePath("/accounts");
  revalidatePath("/");
  return { ok: true };
}

/**
 * Replace the list of regions to sync for an account.
 * Pass an empty array to fall back to the account's default region.
 */
export async function updateAccountRegions(
  accountId: string,
  regions: string[],
): Promise<{ ok: boolean; error?: string }> {
  const cleaned = Array.from(new Set(regions.map((r) => r.trim()).filter(Boolean)));
  await db
    .update(cloudAccounts)
    .set({
      regions: cleaned.length ? JSON.stringify(cleaned) : null,
      updatedAt: new Date(),
    })
    .where(eq(cloudAccounts.id, accountId));
  await db.insert(auditLog).values({
    accountId,
    action: "account.regions.update",
    status: "ok",
    message: cleaned.join(",") || "(default only)",
  });
  revalidatePath("/accounts");
  revalidatePath("/resources");
  return { ok: true };
}

const tagSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9._:/=+@-]+$/u, "Tag keys may use letters, digits, and . _ : / = + @ -"),
  value: z.string().max(256),
});

/**
 * Replace the account-level default tag map. New instances created via vmui
 * inherit these tags both as local rows and (best-effort) as provider tags.
 */
export async function updateAccountDefaultTags(
  accountId: string,
  tags: { key: string; value: string }[],
): Promise<{ ok: boolean; error?: string }> {
  const seen = new Set<string>();
  const cleaned: Record<string, string> = {};
  for (const raw of tags) {
    const parsed = tagSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
    }
    if (seen.has(parsed.data.key)) {
      return { ok: false, error: `Duplicate tag key: ${parsed.data.key}` };
    }
    seen.add(parsed.data.key);
    cleaned[parsed.data.key] = parsed.data.value;
  }
  const json = Object.keys(cleaned).length ? JSON.stringify(cleaned) : null;
  await db
    .update(cloudAccounts)
    .set({ defaultTags: json, updatedAt: new Date() })
    .where(eq(cloudAccounts.id, accountId));
  await db.insert(auditLog).values({
    accountId,
    action: "account.default-tags.update",
    status: "ok",
    message: Object.keys(cleaned).join(",") || "(none)",
  });
  revalidatePath("/accounts");
  return { ok: true };
}

/**
 * Apply the account's current default tags to every existing instance — both
 * local rows (idempotent ON CONFLICT-ish via prior cleanup) and provider
 * tags when supported. Useful when you set defaults after the fleet already
 * exists. Each row is independent; partial failures are reported per-id.
 */
export async function backfillAccountDefaultTags(
  accountId: string,
): Promise<{ ok: boolean; updated: number; failed: { id: string; error: string }[]; error?: string }> {
  const acc = await db.query.cloudAccounts.findFirst({ where: eq(cloudAccounts.id, accountId) });
  if (!acc) return { ok: false, updated: 0, failed: [], error: "Account not found" };
  let tags: Record<string, string> = {};
  if (acc.defaultTags) {
    try {
      const obj = JSON.parse(acc.defaultTags) as Record<string, unknown>;
      for (const [k, v] of Object.entries(obj)) {
        tags[k] = typeof v === "string" ? v : String(v ?? "");
      }
    } catch {
      return { ok: false, updated: 0, failed: [], error: "Default tags JSON is malformed" };
    }
  }
  if (Object.keys(tags).length === 0) {
    return { ok: false, updated: 0, failed: [], error: "No default tags set on this account" };
  }
  const rows = await db.select().from(instances).where(eq(instances.accountId, accountId));
  if (rows.length === 0) return { ok: true, updated: 0, failed: [] };

  let provider;
  try {
    ({ provider } = await getProvider(accountId));
  } catch (e) {
    return { ok: false, updated: 0, failed: [], error: e instanceof Error ? e.message : "provider error" };
  }

  const failed: { id: string; error: string }[] = [];
  let updated = 0;
  for (const row of rows) {
    try {
      // Replace local rows for each key/value pair without duplicating.
      const existing = await db
        .select()
        .from(instanceTags)
        .where(eq(instanceTags.instanceId, row.id));
      const existingByKey = new Map(existing.map((e) => [e.key, e]));
      for (const [k, v] of Object.entries(tags)) {
        const prior = existingByKey.get(k);
        if (prior) {
          if (prior.value !== v) {
            await db
              .update(instanceTags)
              .set({ value: v })
              .where(eq(instanceTags.id, prior.id));
          }
        } else {
          await db.insert(instanceTags).values({
            id: nanoid(),
            instanceId: row.id,
            key: k,
            value: v,
            source: "local",
          });
        }
      }
      if (provider.applyTags) {
        await provider.applyTags(row.region, row.providerInstanceId, tags);
      }
      updated++;
    } catch (err) {
      failed.push({ id: row.id, error: err instanceof Error ? err.message : "failed" });
    }
  }
  await db.insert(auditLog).values({
    accountId,
    action: "account.default-tags.backfill",
    status: failed.length === 0 ? "ok" : "error",
    message: `updated=${updated} failed=${failed.length}`,
  });
  revalidatePath("/");
  revalidatePath("/instances");
  return { ok: failed.length === 0, updated, failed };
}

export interface AwsProfileInfo {
  name: string;
  region: string | null;
  isSso: boolean;
  hasStaticKeys: boolean;
  ssoStartUrl: string | null;
  ssoAccountId: string | null;
}

export async function listAwsProfilesAction(): Promise<{ cliInstalled: boolean; profiles: AwsProfileInfo[] }> {
  const cliInstalled = await hasAwsCli();
  const profiles: AwsProfile[] = listAwsProfiles();
  return {
    cliInstalled,
    profiles: profiles.map((p) => ({
      name: p.name,
      region: p.config.region ?? null,
      isSso: p.isSso,
      hasStaticKeys: p.hasStaticKeys,
      ssoStartUrl: p.config.sso_start_url ?? null,
      ssoAccountId: p.config.sso_account_id ?? null,
    })),
  };
}

const importProfileSchema = z.object({
  profile: z.string().min(1),
  name: z.string().min(1).max(64),
  region: z.string().regex(/^[a-z0-9-]+$/),
});

export async function importAwsProfile(
  _prev: AwsAccountFormState,
  formData: FormData,
): Promise<AwsAccountFormState> {
  const parsed = importProfileSchema.safeParse({
    profile: formData.get("profile"),
    name: formData.get("name"),
    region: formData.get("region"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join("; ") };
  }

  const resolved = await resolveProfileViaCli(parsed.data.profile);
  if (!resolved) {
    return {
      error:
        `Couldn't resolve credentials for profile "${parsed.data.profile}". ` +
        `If it's an SSO profile, run \`aws sso login --profile ${parsed.data.profile}\` first.`,
    };
  }

  const provider = new AwsProvider({
    accessKeyId: resolved.accessKeyId,
    secretAccessKey: resolved.secretAccessKey,
    sessionToken: resolved.sessionToken,
    defaultRegion: parsed.data.region,
  });

  let identity;
  try {
    identity = await provider.verify();
  } catch (err) {
    return { error: err instanceof Error ? `Verification failed: ${err.message}` : "Verification failed." };
  }

  const id = nanoid(12);
  await db.insert(cloudAccounts).values({
    id,
    provider: "aws",
    name: parsed.data.name,
    defaultRegion: parsed.data.region,
    credentialsEnc: encryptJSON({
      accessKeyId: resolved.accessKeyId,
      secretAccessKey: resolved.secretAccessKey,
      sessionToken: resolved.sessionToken,
      // Tag so we can later refresh from CLI on SSO profiles
      _sourceProfile: parsed.data.profile,
    }),
    metadataEnc: encryptJSON({ accountId: identity.accountId, label: identity.label }),
  });

  await db.insert(auditLog).values({
    accountId: id,
    action: "account.create",
    target: identity.accountId,
    status: "ok",
    message: `Imported AWS profile "${parsed.data.profile}" as "${parsed.data.name}" (${identity.accountId})`,
  });

  revalidatePath("/accounts");
  revalidatePath("/");
  return { ok: true, accountId: id };
}

// ===== Scaleway =====

const scalewayCredentialsSchema = z.object({
  name: z.string().min(1, "Name is required").max(64),
  secretKey: z
    .string()
    .regex(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      "Invalid Scaleway secret key (UUID format)",
    ),
  projectId: z
    .string()
    .regex(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      "Invalid Scaleway project ID (UUID format)",
    ),
  defaultZone: z.enum(["fr-par-1", "fr-par-3"], {
    message: "Zone must be fr-par-1 (M2/M2-Pro/M4) or fr-par-3 (M1)",
  }),
});

export type ScalewayAccountFormState = {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  accountId?: string;
};

export async function addScalewayAccount(
  _prev: ScalewayAccountFormState,
  formData: FormData,
): Promise<ScalewayAccountFormState> {
  const parsed = scalewayCredentialsSchema.safeParse({
    name: formData.get("name"),
    secretKey: formData.get("secretKey"),
    projectId: formData.get("projectId"),
    defaultZone: formData.get("defaultZone"),
  });
  if (!parsed.success) {
    const fe: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const k = issue.path[0];
      if (typeof k === "string" && !fe[k]) fe[k] = issue.message;
    }
    return { error: "Please fix the highlighted fields.", fieldErrors: fe };
  }

  const { name, defaultZone, secretKey, projectId } = parsed.data;
  const provider = new ScalewayProvider({ secretKey, projectId, defaultZone });

  let identity;
  try {
    identity = await provider.verify();
  } catch (err) {
    return {
      error:
        err instanceof Error
          ? `Verification failed: ${err.message}`
          : "Failed to verify Scaleway credentials.",
    };
  }

  const id = nanoid(12);
  await db.insert(cloudAccounts).values({
    id,
    provider: "scaleway",
    name,
    defaultRegion: defaultZone,
    credentialsEnc: encryptJSON({ secretKey, projectId }),
    metadataEnc: encryptJSON({ accountId: identity.accountId, label: identity.label }),
  });

  await db.insert(auditLog).values({
    accountId: id,
    action: "account.create",
    target: identity.accountId,
    status: "ok",
    message: `Scaleway project "${name}" connected (${identity.label})`,
  });

  revalidatePath("/accounts");
  revalidatePath("/");
  return { ok: true, accountId: id };
}

// ===== Local KVM (WSL2) =====

const localKvmSchema = z
  .object({
    name: z.string().min(1, "Name is required").max(64),
    kind: z.enum(["mac", "win", "ubuntu", "hyperv-win"], {
      message: "Pick a guest kind: mac, win, ubuntu or hyperv-win",
    }),
    distro: z.string().min(1, "WSL distro is required").max(64),
    // For "hyperv-win" vmDir is unused; the form posts an empty string and
    // we relax the regex below via .superRefine().
    vmDir: z.string().max(512),
    hostLabel: z.string().min(1).max(120),
    vncPort: z.coerce.number().int().min(0).max(65535),
    qmpPort: z.coerce.number().int().min(0).max(65535),
    sshPort: z.coerce.number().int().min(0).max(65535),
    wsPort: z.coerce.number().int().min(0).max(65535),
    ramMb: z.coerce.number().int().min(1024).max(1024 * 1024),
    cores: z.coerce.number().int().min(1).max(64),
    threads: z.coerce.number().int().min(1).max(128),
    osUsername: z
      .string()
      .trim()
      .regex(/^[a-z_][a-z0-9_-]{0,31}$/, "Lowercase letters, digits, _ and - only (max 32 chars)")
      .optional()
      .or(z.literal("").transform(() => undefined)),
    osPassword: z
      .string()
      .min(4, "Password must be at least 4 characters")
      .max(128)
      .optional()
      .or(z.literal("").transform(() => undefined)),
    hypervVmName: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9._-]{1,64}$/, "Hyper-V VM name: A-Z, 0-9, ., _ or - (max 64)")
      .optional()
      .or(z.literal("").transform(() => undefined)),
  })
  .superRefine((v, ctx) => {
    // KVM kinds need a real Linux path. Hyper-V doesn't.
    if (v.kind !== "hyperv-win" && !/^\/[^\0]+$/.test(v.vmDir)) {
      ctx.addIssue({
        code: "custom",
        path: ["vmDir"],
        message: "Must be an absolute Linux path",
      });
    }
    if (v.kind !== "hyperv-win") {
      for (const f of ["vncPort", "qmpPort", "sshPort", "wsPort"] as const) {
        if (!v[f] || v[f] < 1) {
          ctx.addIssue({
            code: "custom",
            path: [f],
            message: "Required for KVM guests",
          });
        }
      }
    }
  });

export type LocalKvmAccountFormState = {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  accountId?: string;
  /** Auto-generated guest credentials, surfaced to the user on success. */
  generatedCreds?: { username: string; password: string };
};

/**
 * Generate a random guest password. 20 chars, base64url alphabet (no
 * problematic shell metacharacters), ~120 bits of entropy.
 */
function generatePassword(): string {
  return randomBytes(15).toString("base64url");
}

/**
 * Generate a random POSIX-friendly username: "vmui-XXXXXX" where XXXXXX
 * is 6 lowercase hex chars. Matches the schema regex `^[a-z_][a-z0-9_-]{0,31}$`.
 */
function generateUsername(): string {
  const suffix = Array.from({ length: 6 }, () =>
    "abcdefghijklmnopqrstuvwxyz0123456789".charAt(randomInt(0, 36)),
  ).join("");
  return `vmui-${suffix}`;
}

export async function addLocalKvmAccount(
  _prev: LocalKvmAccountFormState,
  formData: FormData,
): Promise<LocalKvmAccountFormState> {
  // Resolve per-kind defaults so blank numeric/path fields fall back sensibly
  // depending on which guest the user picked.
  const { KIND_DEFAULTS } = await import("@/lib/providers/local-kvm");
  const rawKind = (formData.get("kind") as string) || "mac";
  const d = KIND_DEFAULTS[rawKind as keyof typeof KIND_DEFAULTS] ?? KIND_DEFAULTS.mac;

  const parsed = localKvmSchema.safeParse({
    name: formData.get("name"),
    kind: rawKind,
    distro: formData.get("distro"),
    vmDir: formData.get("vmDir") || d.vmDir,
    hostLabel: formData.get("hostLabel"),
    vncPort: formData.get("vncPort") || d.vncPort,
    qmpPort: formData.get("qmpPort") || d.qmpPort,
    sshPort: formData.get("sshPort") || d.sshPort,
    wsPort: formData.get("wsPort") || d.wsPort,
    ramMb: formData.get("ramMb") || d.ramMb,
    cores: formData.get("cores") || d.cores,
    threads: formData.get("threads") || d.threads,
    osUsername: formData.get("osUsername") ?? undefined,
    osPassword: formData.get("osPassword") ?? undefined,
    hypervVmName: formData.get("hypervVmName") ?? undefined,
  });
  if (!parsed.success) {
    const fe: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const k = issue.path[0];
      if (typeof k === "string" && !fe[k]) fe[k] = issue.message;
    }
    return { error: "Please fix the highlighted fields.", fieldErrors: fe };
  }

  const { name, ...rest } = parsed.data;

  // For Linux/Windows guests, generate fallback credentials when the user
  // didn't supply them. This avoids baking a single shared default
  // (dragos/REDACTED_GUEST_PASSWORD) across every VM the user creates.
  let generatedCreds: { username: string; password: string } | undefined;
  if (rest.kind !== "mac") {
    if (!rest.osUsername || !rest.osPassword) {
      generatedCreds = {
        username: rest.osUsername || generateUsername(),
        password: rest.osPassword || generatePassword(),
      };
      rest.osUsername = generatedCreds.username;
      rest.osPassword = generatedCreds.password;
    }
  }

  const creds: LocalKvmCredentials = rest;
  const provider = new LocalKvmProvider(creds);

  let identity;
  try {
    identity = await provider.verify();
  } catch (err) {
    return {
      error:
        err instanceof Error ? `Verification failed: ${err.message}` : "Failed to verify local KVM host.",
    };
  }

  const id = nanoid(12);
  await db.insert(cloudAccounts).values({
    id,
    provider: "local-kvm",
    name,
    defaultRegion: "wsl-local",
    credentialsEnc: encryptJSON(creds),
    metadataEnc: encryptJSON({ accountId: identity.accountId, label: identity.label }),
  });

  // Persist OS credentials into the WSL distro so the unattended-install
  // setup script picks them up the next time the user runs it. Failure
  // here is non-fatal — the account row is already saved.
  try {
    await provider.writeOsCredsFile();
  } catch (err) {
    console.warn("[local-kvm] writeOsCredsFile failed:", err);
  }

  await db.insert(auditLog).values({
    accountId: id,
    action: "account.create",
    target: identity.accountId,
    status: "ok",
    message: `Local KVM host "${name}" connected (${identity.label})`,
  });

  revalidatePath("/accounts");
  revalidatePath("/");
  return { ok: true, accountId: id, generatedCreds };
}

// ===== Azure =====

const azureSchema = z.object({
  name: z.string().min(1).max(64),
  tenantId: z.string().regex(/^[0-9a-f-]{32,40}$/i, "Tenant ID looks malformed"),
  clientId: z.string().regex(/^[0-9a-f-]{32,40}$/i, "Client ID looks malformed"),
  clientSecret: z.string().min(8, "Client secret looks too short"),
  subscriptionId: z.string().regex(/^[0-9a-f-]{32,40}$/i, "Subscription ID looks malformed"),
  defaultLocation: z.string().regex(/^[a-z0-9-]+$/, "Location must be lowercase, e.g. westeurope"),
});

export type AzureAccountFormState = {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  accountId?: string;
};

export async function addAzureAccount(
  _prev: AzureAccountFormState,
  formData: FormData,
): Promise<AzureAccountFormState> {
  const parsed = azureSchema.safeParse({
    name: formData.get("name"),
    tenantId: formData.get("tenantId"),
    clientId: formData.get("clientId"),
    clientSecret: formData.get("clientSecret"),
    subscriptionId: formData.get("subscriptionId"),
    defaultLocation: formData.get("defaultLocation"),
  });
  if (!parsed.success) {
    const fe: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const k = issue.path[0];
      if (typeof k === "string" && !fe[k]) fe[k] = issue.message;
    }
    return { error: "Please fix the highlighted fields.", fieldErrors: fe };
  }

  const { name, defaultLocation, tenantId, clientId, clientSecret, subscriptionId } = parsed.data;
  const provider = new AzureProvider({ tenantId, clientId, clientSecret, subscriptionId, defaultLocation });

  let identity;
  try {
    identity = await provider.verify();
  } catch (err) {
    return {
      error: err instanceof Error ? `Verification failed: ${err.message}` : "Failed to verify Azure credentials.",
    };
  }

  const id = nanoid(12);
  await db.insert(cloudAccounts).values({
    id,
    provider: "azure",
    name,
    defaultRegion: defaultLocation,
    credentialsEnc: encryptJSON({ tenantId, clientId, clientSecret, subscriptionId }),
    metadataEnc: encryptJSON({ accountId: identity.accountId, label: identity.label }),
  });

  await db.insert(auditLog).values({
    accountId: id,
    action: "account.create",
    target: identity.accountId,
    status: "ok",
    message: `Azure subscription "${name}" connected (${identity.label})`,
  });

  revalidatePath("/accounts");
  revalidatePath("/");
  return { ok: true, accountId: id };
}

// ===== GCP =====

const gcpSchema = z.object({
  name: z.string().min(1).max(64),
  keyJson: z.string().min(1, "Paste the full service-account JSON"),
  defaultZone: z.string().regex(/^[a-z0-9-]+$/, "Zone must be lowercase, e.g. us-central1-a"),
});

export type GcpAccountFormState = {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  accountId?: string;
};

export async function addGcpAccount(
  _prev: GcpAccountFormState,
  formData: FormData,
): Promise<GcpAccountFormState> {
  const parsed = gcpSchema.safeParse({
    name: formData.get("name"),
    keyJson: formData.get("keyJson"),
    defaultZone: formData.get("defaultZone"),
  });
  if (!parsed.success) {
    const fe: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const k = issue.path[0];
      if (typeof k === "string" && !fe[k]) fe[k] = issue.message;
    }
    return { error: "Please fix the highlighted fields.", fieldErrors: fe };
  }

  let parsedKey: { project_id: string; client_email: string; private_key: string };
  try {
    const obj = JSON.parse(parsed.data.keyJson);
    if (!obj.project_id || !obj.client_email || !obj.private_key) {
      throw new Error("Missing project_id, client_email, or private_key");
    }
    parsedKey = obj;
  } catch (err) {
    return {
      error: err instanceof Error ? `Invalid key JSON: ${err.message}` : "Invalid service-account JSON.",
      fieldErrors: { keyJson: "Paste the full JSON downloaded from GCP IAM" },
    };
  }

  const provider = new GcpProvider({ keyJson: parsedKey, defaultZone: parsed.data.defaultZone });

  let identity;
  try {
    identity = await provider.verify();
  } catch (err) {
    return {
      error: err instanceof Error ? `Verification failed: ${err.message}` : "Failed to verify GCP credentials.",
    };
  }

  const id = nanoid(12);
  await db.insert(cloudAccounts).values({
    id,
    provider: "gcp",
    name: parsed.data.name,
    defaultRegion: parsed.data.defaultZone,
    credentialsEnc: encryptJSON({ keyJson: parsedKey }),
    metadataEnc: encryptJSON({ accountId: identity.accountId, label: identity.label }),
  });

  await db.insert(auditLog).values({
    accountId: id,
    action: "account.create",
    target: identity.accountId,
    status: "ok",
    message: `GCP project "${parsed.data.name}" connected (${identity.label})`,
  });

  revalidatePath("/accounts");
  revalidatePath("/");
  return { ok: true, accountId: id };
}

// ===== DigitalOcean =====

const digitalOceanCredentialsSchema = z.object({
  name: z.string().min(1, "Name is required").max(64),
  token: z
    .string()
    .min(40, "DigitalOcean tokens are 64+ characters")
    .max(255)
    .regex(/^[A-Za-z0-9_-]+$/, "Invalid token format"),
  defaultRegion: z
    .string()
    .regex(/^[a-z]{2,4}\d{1,2}$/i, "Region slug like nyc3, fra1, sgp1"),
});

export type DigitalOceanAccountFormState = {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  accountId?: string;
};

export async function addDigitalOceanAccount(
  _prev: DigitalOceanAccountFormState,
  formData: FormData,
): Promise<DigitalOceanAccountFormState> {
  const parsed = digitalOceanCredentialsSchema.safeParse({
    name: formData.get("name"),
    token: formData.get("token"),
    defaultRegion: formData.get("defaultRegion"),
  });
  if (!parsed.success) {
    const fe: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const k = issue.path[0];
      if (typeof k === "string" && !fe[k]) fe[k] = issue.message;
    }
    return { error: "Please fix the highlighted fields.", fieldErrors: fe };
  }

  const { name, token, defaultRegion } = parsed.data;
  const provider = new DigitalOceanProvider({ token, defaultRegion });

  let identity;
  try {
    identity = await provider.verify();
  } catch (err) {
    return {
      error:
        err instanceof Error
          ? `Verification failed: ${err.message}`
          : "Failed to verify DigitalOcean token.",
    };
  }

  const id = nanoid(12);
  await db.insert(cloudAccounts).values({
    id,
    provider: "digitalocean",
    name,
    defaultRegion,
    credentialsEnc: encryptJSON({ token }),
    metadataEnc: encryptJSON({ accountId: identity.accountId, label: identity.label }),
  });

  await db.insert(auditLog).values({
    accountId: id,
    action: "account.create",
    target: identity.accountId,
    status: "ok",
    message: `DigitalOcean account "${name}" connected (${identity.label})`,
  });

  revalidatePath("/accounts");
  revalidatePath("/");
  return { ok: true, accountId: id };
}
