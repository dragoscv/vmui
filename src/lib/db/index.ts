import "server-only";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { env } from "../env";
import * as schema from "./schema";

const dbPath = resolve(process.cwd(), env.VMUI_DB_PATH);
const dir = dirname(dbPath);
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

declare global {
  // eslint-disable-next-line no-var
  var __vmui_sqlite__: Database.Database | undefined;
}

const sqlite =
  globalThis.__vmui_sqlite__ ??
  (globalThis.__vmui_sqlite__ = new Database(dbPath));

sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

// Bootstrap schema (no migrations needed for v1)
sqlite.exec(`
CREATE TABLE IF NOT EXISTS cloud_accounts (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  name TEXT NOT NULL,
  default_region TEXT,
  credentials_enc TEXT NOT NULL,
  metadata_enc TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS instances (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES cloud_accounts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  region TEXT NOT NULL,
  provider_instance_id TEXT NOT NULL,
  name TEXT,
  state TEXT NOT NULL DEFAULT 'unknown',
  platform TEXT NOT NULL DEFAULT 'linux',
  instance_type TEXT,
  public_ip TEXT,
  public_dns TEXT,
  private_ip TEXT,
  key_name TEXT,
  raw_json TEXT,
  last_synced_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_instances_account ON instances(account_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT,
  action TEXT NOT NULL,
  target TEXT,
  status TEXT NOT NULL,
  message TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
`);

export const db = drizzle(sqlite, { schema });
export { schema };
