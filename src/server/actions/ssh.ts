"use server";

import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { instances, cloudAccounts } from "@/lib/db/schema";
import { decryptJSON } from "@/lib/crypto";
import {
  issueSshSession,
  redeemSshSession,
  revokeSshSession,
  SSH_TTL_BOUNDS,
  type SshProfile,
} from "@/lib/ssh-bridge/server";
import { getSshPrivateKey } from "@/server/actions/ssh-keys";
import type { LocalKvmCredentials } from "@/lib/providers/local-kvm";

const ttlSchema = z
  .number()
  .int()
  .min(SSH_TTL_BOUNDS.min)
  .max(SSH_TTL_BOUNDS.max)
  .optional();

const localKvmInputSchema = z.object({
  accountId: z.string().min(1),
  providerInstanceId: z.string().min(1),
  ttlMs: ttlSchema,
});

const customInputSchema = z.object({
  accountId: z.string().min(1),
  providerInstanceId: z.string().min(1),
  username: z.string().min(1).max(64),
  privateKey: z.string().min(20).optional(),
  passphrase: z.string().optional(),
  password: z.string().optional(),
  ttlMs: ttlSchema,
});

export type OpenSshResult =
  | { ok: true; wsUrl: string; sessionId: string; expiresAt: number }
  | { ok: false; error: string };

/**
 * Open a browser-SSH session for a local-kvm instance using the credentials
 * stored alongside the account (osUsername/osPassword set at provisioning time).
 */
export async function openLocalKvmSshAction(input: {
  accountId: string;
  providerInstanceId: string;
  ttlMs?: number;
}): Promise<OpenSshResult> {
  const parsed = localKvmInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };

  const account = (
    await db.select().from(cloudAccounts).where(eq(cloudAccounts.id, parsed.data.accountId)).limit(1)
  )[0];
  if (!account) return { ok: false, error: "Account not found." };
  if (account.provider !== "local-kvm") {
    return { ok: false, error: "openLocalKvmSshAction only supports local-kvm accounts." };
  }

  const inst = (
    await db
      .select()
      .from(instances)
      .where(
        and(
          eq(instances.accountId, parsed.data.accountId),
          eq(instances.providerInstanceId, parsed.data.providerInstanceId),
        ),
      )
      .limit(1)
  )[0];
  if (!inst) return { ok: false, error: "Instance not found." };

  const creds = decryptJSON<LocalKvmCredentials>(account.credentialsEnc);
  if (creds.kind === "hyperv-win") {
    return { ok: false, error: "Browser SSH for Hyper-V Windows VMs is not supported (use RDP)." };
  }
  if (!creds.osPassword) {
    return {
      ok: false,
      error: "This local-kvm account has no stored OS password. Set osUsername/osPassword on the account.",
    };
  }

  const profile: SshProfile = {
    host: "127.0.0.1",
    port: creds.sshPort,
    username: creds.osUsername?.trim() || "vmui",
    password: creds.osPassword,
    label: inst.name ?? inst.providerInstanceId,
  };
  const { wsUrl, sessionId, expiresAt } = issueSshSession(profile, parsed.data.ttlMs);
  return { ok: true, wsUrl, sessionId, expiresAt };
}

/**
 * Open a browser-SSH session for a remote (AWS / Azure / GCP) instance using
 * a private key + username supplied by the user. Credentials are kept in
 * memory only — never persisted to disk.
 */
export async function openCustomSshAction(input: {
  accountId: string;
  providerInstanceId: string;
  username: string;
  privateKey?: string;
  passphrase?: string;
  password?: string;
  ttlMs?: number;
}): Promise<OpenSshResult> {
  const parsed = customInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  if (!parsed.data.privateKey && !parsed.data.password) {
    return { ok: false, error: "Provide either a private key or a password." };
  }

  const inst = (
    await db
      .select()
      .from(instances)
      .where(
        and(
          eq(instances.accountId, parsed.data.accountId),
          eq(instances.providerInstanceId, parsed.data.providerInstanceId),
        ),
      )
      .limit(1)
  )[0];
  if (!inst) return { ok: false, error: "Instance not found." };
  const host = inst.publicIp ?? inst.publicDns ?? "";
  if (!host) return { ok: false, error: "Instance has no public IP / DNS." };

  const profile: SshProfile = {
    host,
    port: 22,
    username: parsed.data.username,
    password: parsed.data.password,
    privateKey: parsed.data.privateKey,
    passphrase: parsed.data.passphrase,
    label: inst.name ?? inst.providerInstanceId,
  };
  const { wsUrl, sessionId, expiresAt } = issueSshSession(profile, parsed.data.ttlMs);
  return { ok: true, wsUrl, sessionId, expiresAt };
}

/**
 * Open an SSH session using a saved key from the SSH key manager. The user
 * picks the key id; we decrypt the private key + passphrase server-side and
 * never expose them to the client.
 */
const savedKeyInputSchema = z.object({
  accountId: z.string().min(1),
  providerInstanceId: z.string().min(1),
  username: z.string().min(1).max(64),
  sshKeyId: z.string().min(1),
  ttlMs: ttlSchema,
});

export async function openSavedKeySshAction(input: {
  accountId: string;
  providerInstanceId: string;
  username: string;
  sshKeyId: string;
  ttlMs?: number;
}): Promise<OpenSshResult> {
  const parsed = savedKeyInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };

  const { key, passphrase } = await getSshPrivateKey(parsed.data.sshKeyId);
  if (!key) return { ok: false, error: "Saved key has no private half stored." };

  const inst = (
    await db
      .select()
      .from(instances)
      .where(
        and(
          eq(instances.accountId, parsed.data.accountId),
          eq(instances.providerInstanceId, parsed.data.providerInstanceId),
        ),
      )
      .limit(1)
  )[0];
  if (!inst) return { ok: false, error: "Instance not found." };
  const host = inst.publicIp ?? inst.publicDns ?? "";
  if (!host) return { ok: false, error: "Instance has no public IP / DNS." };

  const profile: SshProfile = {
    host,
    port: 22,
    username: parsed.data.username,
    privateKey: key,
    passphrase: passphrase ?? undefined,
    label: inst.name ?? inst.providerInstanceId,
  };
  const { wsUrl, sessionId, expiresAt } = issueSshSession(profile, parsed.data.ttlMs);
  return { ok: true, wsUrl, sessionId, expiresAt };
}

/**
 * Mint a fresh redemption token for an existing session — used by the
 * Reconnect button so the user doesn't have to refill credentials.
 */
const reconnectInputSchema = z.object({ sessionId: z.string().min(1).max(128) });

export async function reconnectSshSessionAction(
  input: { sessionId: string },
): Promise<OpenSshResult> {
  const parsed = reconnectInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  const fresh = redeemSshSession(parsed.data.sessionId);
  if (!fresh) {
    return { ok: false, error: "Session expired or not found. Please re-enter credentials." };
  }
  return { ok: true, wsUrl: fresh.wsUrl, sessionId: parsed.data.sessionId, expiresAt: fresh.expiresAt };
}

export async function revokeSshSessionAction(
  input: { sessionId: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = reconnectInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  revokeSshSession(parsed.data.sessionId);
  return { ok: true };
}