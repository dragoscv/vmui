"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import {
  cloudAccounts,
  sshKeys,
  instances,
  instanceTags,
  schedules,
  snapshotHistory,
  cachedResources,
  auditLog,
} from "@/lib/db/schema";
import { requireRole } from "@/lib/auth";
import {
  writeBackupFile,
  listBackupFiles,
  deleteBackupFile,
  readBackupFile,
  type BackupFileSummary,
} from "@/lib/local-backup";
import { revalidatePath } from "next/cache";

const VERSION = 1;

interface FullBackupBlob {
  version: number;
  exportedAt: string;
  accounts: (typeof cloudAccounts.$inferSelect)[];
  sshKeys: (typeof sshKeys.$inferSelect)[];
  instances: (typeof instances.$inferSelect)[];
  instanceTags: (typeof instanceTags.$inferSelect)[];
  schedules: (typeof schedules.$inferSelect)[];
  snapshotHistory: (typeof snapshotHistory.$inferSelect)[];
  cachedResources: (typeof cachedResources.$inferSelect)[];
}

/**
 * Bundle the entire vmui state (accounts, ssh keys, instances, tags,
 * schedules, history, cached resources) into a `.vmuibak` file in
 * `~/.vmui/backups/`. Account credentials remain encrypted with the master
 * key; the backup file adds an outer streaming AES-256-GCM envelope.
 */
export async function writeLocalBackupAction(): Promise<{
  ok: boolean;
  file?: BackupFileSummary;
  error?: string;
}> {
  try {
    await requireRole("admin");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Not authorized" };
  }
  const [accs, keys, ins, tags, schs, snaps, res] = await Promise.all([
    db.select().from(cloudAccounts),
    db.select().from(sshKeys),
    db.select().from(instances),
    db.select().from(instanceTags),
    db.select().from(schedules),
    db.select().from(snapshotHistory),
    db.select().from(cachedResources),
  ]);
  const blob: FullBackupBlob = {
    version: VERSION,
    exportedAt: new Date().toISOString(),
    accounts: accs,
    sshKeys: keys,
    instances: ins,
    instanceTags: tags,
    schedules: schs,
    snapshotHistory: snaps,
    cachedResources: res,
  };
  const payload = Buffer.from(JSON.stringify(blob), "utf8");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `vmui-backup-${stamp}.vmuibak`;
  try {
    const { path, bytes } = await writeBackupFile(filename, payload, {
      originalName: filename,
      tag: `accounts=${accs.length},instances=${ins.length}`,
    });
    await db.insert(auditLog).values({
      action: "backup.local.write",
      target: filename,
      status: "ok",
      message: `${bytes} bytes, ${accs.length} accounts, ${ins.length} instances → ${path}`,
    });
    revalidatePath("/backups");
    return {
      ok: true,
      file: {
        name: filename,
        path,
        bytes,
        modifiedAt: new Date().toISOString(),
        partial: false,
      },
    };
  } catch (err) {
    await db.insert(auditLog).values({
      action: "backup.local.write",
      target: filename,
      status: "error",
      message: err instanceof Error ? err.message : "unknown",
    });
    return { ok: false, error: err instanceof Error ? err.message : "Backup failed" };
  }
}

export async function listLocalBackupsAction(): Promise<BackupFileSummary[]> {
  try {
    await requireRole("admin");
  } catch {
    return [];
  }
  return listBackupFiles();
}

const deleteSchema = z.object({ name: z.string().min(1).max(256) });

export async function deleteLocalBackupAction(
  input: z.infer<typeof deleteSchema>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireRole("admin");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Not authorized" };
  }
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid name" };
  try {
    await deleteBackupFile(parsed.data.name);
    await db.insert(auditLog).values({
      action: "backup.local.delete",
      target: parsed.data.name,
      status: "ok",
    });
    revalidatePath("/backups");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Delete failed" };
  }
}

const verifySchema = z.object({ name: z.string().min(1).max(256) });

/**
 * Verify the integrity of a `.vmuibak` file by decrypting it. Reports the
 * row counts found in the payload (without applying anything to the DB).
 */
export async function verifyLocalBackupAction(
  input: z.infer<typeof verifySchema>,
): Promise<{
  ok: boolean;
  truncated?: boolean;
  counts?: Record<string, number>;
  exportedAt?: string;
  error?: string;
}> {
  try {
    await requireRole("admin");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Not authorized" };
  }
  const parsed = verifySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid name" };
  const summaries = await listBackupFiles();
  const target = summaries.find((s) => s.name === parsed.data.name);
  if (!target) return { ok: false, error: "Backup not found" };
  try {
    const { header, payload, truncated } = await readBackupFile(target.path);
    const blob = JSON.parse(payload.toString("utf8")) as FullBackupBlob;
    return {
      ok: true,
      truncated,
      exportedAt: header.createdAt ?? blob.exportedAt,
      counts: {
        accounts: blob.accounts?.length ?? 0,
        sshKeys: blob.sshKeys?.length ?? 0,
        instances: blob.instances?.length ?? 0,
        schedules: blob.schedules?.length ?? 0,
        snapshotHistory: blob.snapshotHistory?.length ?? 0,
        cachedResources: blob.cachedResources?.length ?? 0,
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Verify failed" };
  }
}
