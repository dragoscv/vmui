import "server-only";
import { randomUUID, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { secrets, secretReveals, instances, cloudAccounts, auditLog, type SecretRow } from "@/lib/db/schema";
import { encryptJSON, decryptJSON } from "@/lib/crypto";
import { sshExec } from "@/lib/ssh-exec";
import type { ProbeKey } from "@/lib/probe";

export type SecretKind = "db" | "api-key" | "password" | "generic";

export interface SecretValue {
  value: string;
  meta?: Record<string, string>;
}

export function encryptSecretValue(v: SecretValue): string {
  return encryptJSON(v);
}

export function readSecretValue(row: SecretRow): SecretValue {
  return decryptJSON<SecretValue>(row.valueEnc);
}

/**
 * Reveal a secret: record an audit/reveal entry, return decrypted value. The
 * caller is expected to have re-authed when `sealed === true`.
 */
export function revealSecret(
  id: string,
  ctx: { userId?: string | null; ip?: string | null },
): SecretValue | null {
  const row = db.select().from(secrets).where(eq(secrets.id, id)).get();
  if (!row) return null;
  db.insert(secretReveals).values({
    secretId: id,
    userId: ctx.userId ?? null,
    ip: ctx.ip ?? null,
  }).run();
  db.insert(auditLog).values({
    action: "secret.reveal",
    target: id,
    status: "ok",
    message: row.name,
  }).run();
  return readSecretValue(row);
}

/**
 * Rotate a secret: generates a new high-entropy value (length depends on kind),
 * re-encrypts, and bumps lastRotatedAt. Returns the new value once.
 */
export function rotateSecret(id: string): SecretValue | null {
  const row = db.select().from(secrets).where(eq(secrets.id, id)).get();
  if (!row) return null;
  const length = row.kind === "api-key" ? 48 : row.kind === "db" ? 32 : 24;
  const value = randomBytes(length).toString("base64url").slice(0, length);
  const old = readSecretValue(row);
  const next: SecretValue = { value, meta: old.meta };
  db.update(secrets)
    .set({ valueEnc: encryptSecretValue(next), lastRotatedAt: new Date() })
    .where(eq(secrets.id, id))
    .run();
  db.insert(auditLog).values({
    action: "secret.rotate",
    target: id,
    status: "ok",
    message: row.name,
  }).run();
  return next;
}

/**
 * Push a secret to an instance as a single line in a .env file
 * (`KEY=value` where KEY is the secret's `name` upper-cased + sanitized).
 * Existing matching key is replaced atomically.
 */
export async function pushSecretToInstance(
  secretId: string,
  instanceId: string,
  envFilePath: string,
): Promise<{ ok: boolean; message: string }> {
  const row = db.select().from(secrets).where(eq(secrets.id, secretId)).get();
  if (!row) return { ok: false, message: "secret not found" };
  const inst = db.select().from(instances).where(eq(instances.id, instanceId)).get();
  if (!inst || (!inst.publicIp && !inst.publicDns)) return { ok: false, message: "instance unreachable" };
  const acc = db.select().from(cloudAccounts).where(eq(cloudAccounts.id, inst.accountId)).get();
  if (!acc?.probeKeyEnc) return { ok: false, message: "no probe key" };
  const key = decryptJSON<ProbeKey>(acc.probeKeyEnc);
  const val = readSecretValue(row);
  const envKey = row.name.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  const b64 = Buffer.from(`${envKey}=${val.value}\n`, "utf8").toString("base64");
  const safe = envFilePath.replace(/'/g, "'\\''");
  const script = [
    `set -e`,
    `sudo touch '${safe}'`,
    `sudo grep -v '^${envKey}=' '${safe}' | sudo tee '${safe}.tmp' > /dev/null`,
    `echo '${b64}' | base64 -d | sudo tee -a '${safe}.tmp' > /dev/null`,
    `sudo mv '${safe}.tmp' '${safe}'`,
    `sudo chmod 600 '${safe}'`,
  ].join(" && ");
  const r = await sshExec({
    host: inst.publicIp ?? inst.publicDns!,
    port: 22,
    user: key.defaultUser ?? (inst.provider === "aws" ? "ec2-user" : "ubuntu"),
    key,
    command: script,
    timeoutMs: 30_000,
  });
  db.insert(auditLog).values({
    action: "secret.push",
    target: secretId,
    status: r.code === 0 ? "ok" : "error",
    message: `${envKey} -> ${instanceId}:${envFilePath}`,
  }).run();
  return { ok: r.code === 0, message: r.code === 0 ? "pushed" : `${r.stderr.slice(-200)}` };
}

/**
 * Export a "sealed" secret blob: AES-256-GCM-encrypted JSON of the value
 * encoded as base64. Caller decrypts client-side with a shared passphrase
 * derived via scrypt. Returns an object the client can render as a file.
 */
export function exportSealedSecret(id: string, passphrase: string): { filename: string; body: string } | null {
  const row = db.select().from(secrets).where(eq(secrets.id, id)).get();
  if (!row) return null;
  const val = readSecretValue(row);
  // scrypt-derived key, salt random, written as JSON envelope
  const { scryptSync, randomBytes: rb, createCipheriv } = require("node:crypto") as typeof import("node:crypto");
  const salt = rb(16);
  const iv = rb(12);
  const dk = scryptSync(passphrase, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", dk, iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(val), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const envelope = {
    v: 1,
    name: row.name,
    kind: row.kind,
    kdf: "scrypt",
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ct: enc.toString("base64"),
  };
  db.insert(auditLog).values({
    action: "secret.export",
    target: id,
    status: "ok",
    message: row.name,
  }).run();
  return {
    filename: `${row.name.replace(/[^a-zA-Z0-9_-]/g, "_")}.vmui-secret.json`,
    body: JSON.stringify(envelope, null, 2),
  };
}

export function createSecret(input: { name: string; kind: SecretKind; value: string; rotationDays?: number; sealed?: boolean; meta?: Record<string, string> }): string {
  const id = randomUUID();
  db.insert(secrets).values({
    id,
    name: input.name,
    kind: input.kind,
    valueEnc: encryptSecretValue({ value: input.value, meta: input.meta }),
    rotationDays: input.rotationDays ?? null,
    sealed: input.sealed ?? false,
  }).run();
  db.insert(auditLog).values({
    action: "secret.create",
    target: id,
    status: "ok",
    message: input.name,
  }).run();
  return id;
}
