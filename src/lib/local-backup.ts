import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync } from "node:fs";
import { readdir, stat, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { requireMasterKey } from "./env";

const MAGIC = Buffer.from("vmuibak1\n", "utf8");
const ALGO = "aes-256-gcm";
const CHUNK_BYTES = 64 * 1024;

/**
 * vmuibak file format (resumable streaming):
 *
 *   MAGIC ("vmuibak1\n") | header_chunk | data_chunk* | EOF
 *
 * Each chunk is encrypted independently with a fresh 12-byte IV and stored as
 *   [len:u32-be][iv:12][tag:16][ciphertext:len]
 *
 * - header_chunk = encrypted JSON {createdAt, originalName, totalChunks?, sha256?}
 * - data_chunk(s) = up to 64 KiB plaintext each
 *
 * A truncated file (partial chunk at the end) decodes everything up to the
 * last fully-written chunk — so resumable writes are safe.
 */

export function backupsDir(): string {
  const dir = join(homedir(), ".vmui", "backups");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function encryptChunk(plaintext: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, requireMasterKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const len = Buffer.alloc(4);
  len.writeUInt32BE(ct.length, 0);
  return Buffer.concat([len, iv, tag, ct]);
}

function decryptChunk(iv: Buffer, tag: Buffer, ct: Buffer): Buffer {
  const decipher = createDecipheriv(ALGO, requireMasterKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

/**
 * Write a `.vmuibak` file by encrypting the input bytes in 64 KiB chunks.
 * Returns absolute path. Atomic: writes to a `.partial` and renames at EOF.
 */
export async function writeBackupFile(
  filename: string,
  payload: Buffer,
  meta: { originalName?: string; tag?: string } = {},
): Promise<{ path: string; bytes: number; chunks: number }> {
  const dir = backupsDir();
  const finalPath = join(dir, filename.endsWith(".vmuibak") ? filename : `${filename}.vmuibak`);
  const partialPath = `${finalPath}.partial`;
  const ws = createWriteStream(partialPath);
  let chunks = 0;

  const writeBuf = (b: Buffer) =>
    new Promise<void>((resolve, reject) => {
      ws.write(b, (err) => (err ? reject(err) : resolve()));
    });

  await writeBuf(MAGIC);
  const header = JSON.stringify({
    createdAt: new Date().toISOString(),
    originalName: meta.originalName ?? filename,
    tag: meta.tag,
  });
  await writeBuf(encryptChunk(Buffer.from(header, "utf8")));
  chunks++;

  for (let off = 0; off < payload.length; off += CHUNK_BYTES) {
    const slice = payload.subarray(off, Math.min(off + CHUNK_BYTES, payload.length));
    await writeBuf(encryptChunk(slice));
    chunks++;
  }

  await new Promise<void>((resolve, reject) => ws.end((err?: Error | null) => (err ? reject(err) : resolve())));

  // Atomic rename
  const { rename } = await import("node:fs/promises");
  await rename(partialPath, finalPath);

  const bytes = statSync(finalPath).size;
  return { path: finalPath, bytes, chunks };
}

interface BackupReadResult {
  header: { createdAt: string; originalName?: string; tag?: string };
  payload: Buffer;
  truncated: boolean;
}

/**
 * Read & decrypt a `.vmuibak` file. Tolerates a final partial chunk
 * (returns `truncated: true` and stops at the last full chunk).
 */
export async function readBackupFile(path: string): Promise<BackupReadResult> {
  const rs = createReadStream(path);
  const chunks: Buffer[] = [];
  for await (const c of rs as unknown as Readable) chunks.push(c as Buffer);
  const buf = Buffer.concat(chunks);
  if (buf.subarray(0, MAGIC.length).compare(MAGIC) !== 0) {
    throw new Error("Not a .vmuibak file (bad magic)");
  }
  let off = MAGIC.length;
  let header: BackupReadResult["header"] | null = null;
  const out: Buffer[] = [];
  let truncated = false;
  while (off < buf.length) {
    if (off + 4 + 12 + 16 > buf.length) {
      truncated = true;
      break;
    }
    const len = buf.readUInt32BE(off);
    const headerEnd = off + 4 + 12 + 16 + len;
    if (headerEnd > buf.length) {
      truncated = true;
      break;
    }
    const iv = buf.subarray(off + 4, off + 4 + 12);
    const tag = buf.subarray(off + 4 + 12, off + 4 + 12 + 16);
    const ct = buf.subarray(off + 4 + 12 + 16, headerEnd);
    let pt: Buffer;
    try {
      pt = decryptChunk(iv, tag, ct);
    } catch (err) {
      throw new Error(
        `Decryption failed at chunk offset ${off}: ${
          err instanceof Error ? err.message : String(err)
        }. Backup may have been written with a different VMUI_MASTER_KEY.`,
      );
    }
    if (header === null) {
      header = JSON.parse(pt.toString("utf8")) as BackupReadResult["header"];
    } else {
      out.push(pt);
    }
    off = headerEnd;
  }
  if (!header) throw new Error("Backup contains no header chunk");
  return { header, payload: Buffer.concat(out), truncated };
}

export interface BackupFileSummary {
  name: string;
  path: string;
  bytes: number;
  modifiedAt: string;
  partial: boolean;
}

export async function listBackupFiles(): Promise<BackupFileSummary[]> {
  const dir = backupsDir();
  const names = await readdir(dir);
  const out: BackupFileSummary[] = [];
  for (const name of names) {
    if (!name.endsWith(".vmuibak") && !name.endsWith(".vmuibak.partial")) continue;
    const path = join(dir, name);
    const s = await stat(path);
    out.push({
      name,
      path,
      bytes: s.size,
      modifiedAt: s.mtime.toISOString(),
      partial: name.endsWith(".partial"),
    });
  }
  return out.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

export async function deleteBackupFile(name: string): Promise<void> {
  if (name.includes("/") || name.includes("\\") || name.includes("..")) {
    throw new Error("Invalid backup name");
  }
  if (!name.endsWith(".vmuibak") && !name.endsWith(".vmuibak.partial")) {
    throw new Error("Refusing to delete non-vmuibak file");
  }
  await unlink(join(backupsDir(), name));
}
