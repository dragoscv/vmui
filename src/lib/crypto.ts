import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { requireMasterKey } from "./env";

const ALGO = "aes-256-gcm";

/**
 * Encrypts a plaintext string using AES-256-GCM with the master key.
 * Returns a self-contained string: base64( iv | tag | ciphertext ).
 */
export function encrypt(plaintext: string): string {
  const key = requireMasterKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

export function decrypt(payload: string): string {
  const key = requireMasterKey();
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

export function encryptJSON(value: unknown): string {
  return encrypt(JSON.stringify(value));
}

export function decryptJSON<T = unknown>(payload: string): T {
  return JSON.parse(decrypt(payload)) as T;
}
