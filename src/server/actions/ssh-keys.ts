"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { createPrivateKey, createHash } from "node:crypto";
import { utils as ssh2Utils } from "ssh2";
import { z } from "zod";
import { db } from "@/lib/db";
import { sshKeys, auditLog } from "@/lib/db/schema";
import { encryptJSON, decryptJSON } from "@/lib/crypto";
import { requireRole } from "@/lib/auth";

const PUBKEY_RE = /^(ssh-(rsa|ed25519|dss)|ecdsa-sha2-\S+)\s+\S+/;

function fingerprintFromPublicKey(pub: string): string | null {
  try {
    const b64 = pub.trim().split(/\s+/)[1];
    if (!b64) return null;
    const raw = Buffer.from(b64, "base64");
    const hash = createHash("sha256").update(raw).digest("base64").replace(/=+$/, "");
    return `SHA256:${hash}`;
  } catch {
    return null;
  }
}

const importSchema = z.object({
  name: z.string().min(1).max(64),
  publicKey: z.string().min(1).regex(PUBKEY_RE, "Must be an OpenSSH public key (ssh-rsa, ssh-ed25519, …)"),
  privateKey: z.string().optional(),
  passphrase: z.string().optional(),
  notes: z.string().max(512).optional(),
});

export type ImportSshKeyState = { ok?: boolean; error?: string; id?: string };

export async function importSshKeyAction(
  _prev: ImportSshKeyState,
  formData: FormData,
): Promise<ImportSshKeyState> {
  try { await requireRole("admin"); } catch (err) { return { error: err instanceof Error ? err.message : "Not authorized" }; }
  const parsed = importSchema.safeParse({
    name: formData.get("name"),
    publicKey: formData.get("publicKey"),
    privateKey: formData.get("privateKey") || undefined,
    passphrase: formData.get("passphrase") || undefined,
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  const { name, publicKey, privateKey, passphrase, notes } = parsed.data;
  const algo = publicKey.split(/\s+/)[0]?.replace("ssh-", "") ?? "imported";
  const id = nanoid();

  // Validate the private key actually parses if provided.
  if (privateKey) {
    try {
      createPrivateKey({ key: privateKey, ...(passphrase ? { passphrase } : {}) });
    } catch (err) {
      return { error: `Private key did not parse: ${err instanceof Error ? err.message : "unknown"}` };
    }
  }

  await db.insert(sshKeys).values({
    id,
    name,
    algo,
    publicKey,
    privateKeyEnc: privateKey ? encryptJSON({ key: privateKey }) : null,
    passphraseEnc: passphrase ? encryptJSON({ passphrase }) : null,
    fingerprint: fingerprintFromPublicKey(publicKey),
    notes: notes ?? null,
  });
  await db.insert(auditLog).values({
    action: "ssh-key.import",
    target: name,
    status: "ok",
  });
  revalidatePath("/settings/ssh-keys");
  return { ok: true, id };
}

const generateSchema = z.object({
  name: z.string().min(1).max(64),
  algo: z.enum(["ed25519", "rsa"]),
  passphrase: z.string().optional(),
  notes: z.string().max(512).optional(),
});

export type GenerateSshKeyState = { ok?: boolean; error?: string; id?: string; publicKey?: string };

export async function generateSshKeyAction(
  _prev: GenerateSshKeyState,
  formData: FormData,
): Promise<GenerateSshKeyState> {
  try { await requireRole("admin"); } catch (err) { return { error: err instanceof Error ? err.message : "Not authorized" }; }
  const parsed = generateSchema.safeParse({
    name: formData.get("name"),
    algo: formData.get("algo"),
    passphrase: formData.get("passphrase") || undefined,
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  const { name, algo, passphrase, notes } = parsed.data;

  const opts: { bits?: number; comment?: string; passphrase?: string; cipher?: string } = {
    comment: name,
  };
  if (algo === "rsa") opts.bits = 4096;
  if (passphrase) {
    opts.passphrase = passphrase;
    opts.cipher = "aes256-cbc";
  }

  const kp = ssh2Utils.generateKeyPairSync(algo, opts);
  // ssh2 returns OpenSSH wire-format public key in `public` and PEM/OpenSSH
  // private key in `private`.
  const publicKey: string = kp.public;
  const privateKey: string = kp.private;

  const id = nanoid();
  await db.insert(sshKeys).values({
    id,
    name,
    algo,
    publicKey,
    privateKeyEnc: encryptJSON({ key: privateKey }),
    passphraseEnc: passphrase ? encryptJSON({ passphrase }) : null,
    fingerprint: fingerprintFromPublicKey(publicKey),
    notes: notes ?? null,
  });
  await db.insert(auditLog).values({
    action: "ssh-key.generate",
    target: name,
    status: "ok",
    message: algo,
  });
  revalidatePath("/settings/ssh-keys");
  return { ok: true, id, publicKey };
}

export async function deleteSshKeyAction(id: string): Promise<{ ok: boolean }> {
  try { await requireRole("admin"); } catch { return { ok: false }; }
  await db.delete(sshKeys).where(eq(sshKeys.id, id));
  await db.insert(auditLog).values({ action: "ssh-key.delete", target: id, status: "ok" });
  revalidatePath("/settings/ssh-keys");
  return { ok: true };
}

/** Decrypt and return a private key for use by the SSH bridge. */
export async function getSshPrivateKey(id: string): Promise<{ key: string | null; passphrase: string | null }> {
  try { await requireRole("operator"); } catch { return { key: null, passphrase: null }; }
  const rows = await db.select().from(sshKeys).where(eq(sshKeys.id, id)).limit(1);
  const k = rows[0];
  if (!k) return { key: null, passphrase: null };
  return {
    key: k.privateKeyEnc ? decryptJSON<{ key: string }>(k.privateKeyEnc).key : null,
    passphrase: k.passphraseEnc ? decryptJSON<{ passphrase: string }>(k.passphraseEnc).passphrase : null,
  };
}
