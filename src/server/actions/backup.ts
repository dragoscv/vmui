"use server";

import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { cloudAccounts, sshKeys, auditLog } from "@/lib/db/schema";
import { requireMasterKey } from "@/lib/env";

const VERSION = 1;

interface BackupBlob {
  version: number;
  exportedAt: string;
  accounts: (typeof cloudAccounts.$inferSelect)[];
  sshKeys: (typeof sshKeys.$inferSelect)[];
}

function sign(payload: string): string {
  return createHmac("sha256", requireMasterKey()).update(payload).digest("base64");
}

/**
 * Export accounts + ssh keys as a signed JSON blob. The credentials inside
 * accounts.credentialsEnc remain ciphertext; restoration on a different host
 * requires the same VMUI_MASTER_KEY, which is by design.
 */
export async function exportBackup(): Promise<{ json: string; signature: string }> {
  const [accs, keys] = await Promise.all([db.select().from(cloudAccounts), db.select().from(sshKeys)]);
  const blob: BackupBlob = {
    version: VERSION,
    exportedAt: new Date().toISOString(),
    accounts: accs,
    sshKeys: keys,
  };
  const json = JSON.stringify(blob);
  const signature = sign(json);
  await db.insert(auditLog).values({
    action: "backup.export",
    status: "ok",
    message: `${accs.length} accounts, ${keys.length} keys`,
  });
  return { json, signature };
}

const restoreSchema = z.object({
  json: z.string(),
  signature: z.string(),
  /** When false, skip rows that already exist by id. When true, overwrite. */
  overwrite: z.boolean().default(false),
});

export async function importBackup(input: {
  json: string;
  signature: string;
  overwrite?: boolean;
}): Promise<{ accounts: number; sshKeys: number; error?: string }> {
  const parsed = restoreSchema.safeParse(input);
  if (!parsed.success) {
    return { accounts: 0, sshKeys: 0, error: "Invalid input" };
  }
  const expected = sign(parsed.data.json);
  const a = Buffer.from(expected);
  const b = Buffer.from(parsed.data.signature);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    await db.insert(auditLog).values({
      action: "backup.import",
      status: "error",
      message: "Signature mismatch",
    });
    return { accounts: 0, sshKeys: 0, error: "Signature mismatch — was this exported with a different VMUI_MASTER_KEY?" };
  }

  let blob: BackupBlob;
  try {
    blob = JSON.parse(parsed.data.json) as BackupBlob;
  } catch {
    return { accounts: 0, sshKeys: 0, error: "Malformed JSON" };
  }
  if (blob.version !== VERSION) {
    return { accounts: 0, sshKeys: 0, error: `Unknown backup version: ${blob.version}` };
  }

  let accountsRestored = 0;
  let keysRestored = 0;

  for (const a of blob.accounts) {
    try {
      if (parsed.data.overwrite) {
        await db.insert(cloudAccounts).values(a).onConflictDoUpdate({
          target: cloudAccounts.id,
          set: a,
        });
      } else {
        await db.insert(cloudAccounts).values(a).onConflictDoNothing();
      }
      accountsRestored++;
    } catch {
      // Skip rows that fail to insert.
    }
  }

  for (const k of blob.sshKeys) {
    try {
      if (parsed.data.overwrite) {
        await db.insert(sshKeys).values(k).onConflictDoUpdate({ target: sshKeys.id, set: k });
      } else {
        await db.insert(sshKeys).values(k).onConflictDoNothing();
      }
      keysRestored++;
    } catch {
      // Skip
    }
  }

  await db.insert(auditLog).values({
    action: "backup.import",
    status: "ok",
    message: `${accountsRestored} accounts, ${keysRestored} keys`,
  });
  return { accounts: accountsRestored, sshKeys: keysRestored };
}
