import "server-only";
import { statSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { db } from "@/lib/db";
import { auditLog, cloudAccounts, instances } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { count } from "drizzle-orm";

export interface SettingsSnapshot {
  masterKeySet: boolean;
  masterKeyFingerprint: string | null;
  dbPath: string;
  dbAbsolutePath: string;
  dbSizeBytes: number | null;
  syncIntervalMs: number;
  appVersion: string;
  bindAddress: string;
  bindPort: number;
  nodeEnv: string;
  counts: {
    accounts: number;
    instances: number;
    auditEntries: number;
  };
  providers: { id: string; label: string; available: boolean }[];
}

export async function getSettings(): Promise<SettingsSnapshot> {
  const dbPath = env.VMUI_DB_PATH ?? "./vmui.db";
  const abs = path.resolve(dbPath);
  let dbSize: number | null = null;
  try {
    dbSize = statSync(abs).size;
  } catch {
    /* db not created yet */
  }

  let fp: string | null = null;
  if (env.VMUI_MASTER_KEY) {
    // First 8 hex chars of SHA-256 over the key — never expose raw key.
    fp = createHash("sha256")
      .update(env.VMUI_MASTER_KEY, "hex")
      .digest("hex")
      .slice(0, 12);
  }

  // pull pkg version without server-only ts complaining
  let version = "0.0.0";
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    version = (require("../../../package.json") as { version?: string }).version ?? "0.0.0";
  } catch {
    /* ignore */
  }

  const [a] = await db.select({ c: count() }).from(cloudAccounts);
  const [i] = await db.select({ c: count() }).from(instances);
  const [l] = await db.select({ c: count() }).from(auditLog);

  return {
    masterKeySet: !!env.VMUI_MASTER_KEY,
    masterKeyFingerprint: fp,
    dbPath,
    dbAbsolutePath: abs,
    dbSizeBytes: dbSize,
    syncIntervalMs: 15_000,
    appVersion: version,
    bindAddress: "127.0.0.1",
    bindPort: 3737,
    nodeEnv: env.NODE_ENV,
    counts: {
      accounts: a?.c ?? 0,
      instances: i?.c ?? 0,
      auditEntries: l?.c ?? 0,
    },
    providers: [
      { id: "aws", label: "Amazon Web Services", available: true },
      { id: "scaleway", label: "Scaleway", available: true },
      { id: "local-kvm", label: "Local · KVM / Hyper-V", available: true },
      { id: "azure", label: "Microsoft Azure", available: true },
      { id: "gcp", label: "Google Cloud Platform", available: true },
    ],
  };
}
