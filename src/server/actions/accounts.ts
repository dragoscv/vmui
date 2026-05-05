"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { db } from "@/lib/db";
import { cloudAccounts, auditLog } from "@/lib/db/schema";
import { encryptJSON } from "@/lib/crypto";
import { AwsProvider } from "@/lib/providers/aws";
import { ScalewayProvider } from "@/lib/providers/scaleway";
import { LocalKvmProvider, type LocalKvmCredentials } from "@/lib/providers/local-kvm";
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

const localKvmSchema = z.object({
  name: z.string().min(1, "Name is required").max(64),
  distro: z.string().min(1, "WSL distro is required").max(64),
  vmDir: z.string().regex(/^\/[^\0]+$/, "Must be an absolute Linux path"),
  hostLabel: z.string().min(1).max(120),
  vncPort: z.coerce.number().int().min(1).max(65535).default(5900),
  qmpPort: z.coerce.number().int().min(1).max(65535).default(4444),
  sshPort: z.coerce.number().int().min(1).max(65535).default(10022),
  wsPort: z.coerce.number().int().min(1).max(65535).default(6080),
  ramMb: z.coerce.number().int().min(1024).max(1024 * 1024).default(16384),
  cores: z.coerce.number().int().min(1).max(64).default(4),
  threads: z.coerce.number().int().min(1).max(128).default(8),
});

export type LocalKvmAccountFormState = {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  accountId?: string;
};

export async function addLocalKvmAccount(
  _prev: LocalKvmAccountFormState,
  formData: FormData,
): Promise<LocalKvmAccountFormState> {
  const parsed = localKvmSchema.safeParse({
    name: formData.get("name"),
    distro: formData.get("distro"),
    vmDir: formData.get("vmDir"),
    hostLabel: formData.get("hostLabel"),
    vncPort: formData.get("vncPort") || 5900,
    qmpPort: formData.get("qmpPort") || 4444,
    sshPort: formData.get("sshPort") || 10022,
    wsPort: formData.get("wsPort") || 6080,
    ramMb: formData.get("ramMb") || 16384,
    cores: formData.get("cores") || 4,
    threads: formData.get("threads") || 8,
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

  await db.insert(auditLog).values({
    accountId: id,
    action: "account.create",
    target: identity.accountId,
    status: "ok",
    message: `Local KVM host "${name}" connected (${identity.label})`,
  });

  revalidatePath("/accounts");
  revalidatePath("/");
  return { ok: true, accountId: id };
}
