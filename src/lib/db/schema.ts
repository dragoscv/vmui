import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const cloudAccounts = sqliteTable("cloud_accounts", {
  id: text("id").primaryKey(),
  provider: text("provider", { enum: ["aws", "azure", "gcp", "scaleway", "local-kvm"] }).notNull(),
  name: text("name").notNull(),
  /** Default region used when the provider needs one. */
  defaultRegion: text("default_region"),
  /** Encrypted JSON blob of provider credentials (AES-256-GCM, base64). */
  credentialsEnc: text("credentials_enc").notNull(),
  /** Cached display info (account id, email, etc.) — encrypted JSON. */
  metadataEnc: text("metadata_enc"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const instances = sqliteTable("instances", {
  /** Synthetic id: `${accountId}:${region}:${providerInstanceId}` */
  id: text("id").primaryKey(),
  accountId: text("account_id")
    .notNull()
    .references(() => cloudAccounts.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  region: text("region").notNull(),
  providerInstanceId: text("provider_instance_id").notNull(),
  name: text("name"),
  /** Normalized state: pending | running | stopping | stopped | terminated | unknown */
  state: text("state").notNull().default("unknown"),
  /** "windows" | "macos" | "linux" */
  platform: text("platform").notNull().default("linux"),
  instanceType: text("instance_type"),
  publicIp: text("public_ip"),
  publicDns: text("public_dns"),
  privateIp: text("private_ip"),
  keyName: text("key_name"),
  rawJson: text("raw_json"),
  lastSyncedAt: integer("last_synced_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const auditLog = sqliteTable("audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accountId: text("account_id"),
  action: text("action").notNull(),
  target: text("target"),
  status: text("status", { enum: ["ok", "error"] }).notNull(),
  message: text("message"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type CloudAccountRow = typeof cloudAccounts.$inferSelect;
export type InstanceRow = typeof instances.$inferSelect;
