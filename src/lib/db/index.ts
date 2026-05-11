import "server-only";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { env } from "../env";
import { redactQuiet } from "../secret-redactor";
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

CREATE TABLE IF NOT EXISTS pricing_cache (
  -- Synthetic key: "<provider>:<region>:<instance_type>:<platform>"
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  region TEXT NOT NULL,
  instance_type TEXT NOT NULL,
  platform TEXT NOT NULL,
  usd_per_hour REAL NOT NULL,
  source TEXT NOT NULL,
  fetched_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_pricing_lookup
  ON pricing_cache(provider, region, instance_type, platform);

CREATE TABLE IF NOT EXISTS cached_resources (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES cloud_accounts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  region TEXT NOT NULL,
  kind TEXT NOT NULL,
  external_id TEXT NOT NULL,
  name TEXT,
  status TEXT,
  size_bytes INTEGER,
  attached_to_instance_id TEXT,
  monthly_usd REAL,
  raw_json TEXT,
  last_synced_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_resources_account ON cached_resources(account_id);
CREATE INDEX IF NOT EXISTS idx_resources_kind ON cached_resources(kind);

CREATE TABLE IF NOT EXISTS ssh_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  algo TEXT NOT NULL,
  public_key TEXT NOT NULL,
  private_key_enc TEXT,
  passphrase_enc TEXT,
  fingerprint TEXT,
  notes TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS snapshot_history (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES cloud_accounts(id) ON DELETE CASCADE,
  captured_at INTEGER NOT NULL DEFAULT (unixepoch()),
  total_instances INTEGER NOT NULL,
  running_instances INTEGER NOT NULL,
  hourly_usd REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snapshot_account_time
  ON snapshot_history(account_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES cloud_accounts(id) ON DELETE CASCADE,
  cron TEXT NOT NULL,
  action TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  label TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_run_at INTEGER,
  last_run_status TEXT
);
CREATE INDEX IF NOT EXISTS idx_schedules_instance ON schedules(instance_id);

CREATE TABLE IF NOT EXISTS instance_tags (
  id TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'local',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_instance_tags_unique
  ON instance_tags(instance_id, key);
CREATE INDEX IF NOT EXISTS idx_instance_tags_key ON instance_tags(key);

CREATE TABLE IF NOT EXISTS ssh_host_keys (
  id TEXT PRIMARY KEY,
  host TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 22,
  algorithm TEXT NOT NULL,
  fingerprint_sha256 TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_seen_at INTEGER NOT NULL DEFAULT (unixepoch()),
  note TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ssh_host_keys_unique
  ON ssh_host_keys(host, port);

CREATE TABLE IF NOT EXISTS tag_budgets (
  id TEXT PRIMARY KEY,
  tag_key TEXT NOT NULL,
  tag_value TEXT,
  monthly_usd REAL NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_checked_at INTEGER,
  last_observed_usd REAL,
  exceeded INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_tag_budgets_key ON tag_budgets(tag_key);

CREATE TABLE IF NOT EXISTS webhooks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  kind TEXT NOT NULL,
  channels TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_fired_at INTEGER,
  last_status TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_created   ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_account   ON audit_log(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_instances_state ON instances(state);
CREATE INDEX IF NOT EXISTS idx_instances_provider_state
  ON instances(provider, state);
CREATE INDEX IF NOT EXISTS idx_instances_last_synced
  ON instances(last_synced_at DESC);
`);

// Lightweight column migrations. SQLite has no IF NOT EXISTS for ADD COLUMN,
// so we read the table info and only add missing columns.
const existingCols = new Set(
  (sqlite.prepare(`PRAGMA table_info(instances)`).all() as { name: string }[]).map(
    (r) => r.name,
  ),
);
const addColumn = (def: string, name: string) => {
  if (!existingCols.has(name)) sqlite.exec(`ALTER TABLE instances ADD COLUMN ${def}`);
};
addColumn("display_name TEXT", "display_name");
addColumn("pinned INTEGER NOT NULL DEFAULT 0", "pinned");
addColumn("sort_order INTEGER", "sort_order");
addColumn("notes TEXT", "notes");
addColumn("termination_locked INTEGER NOT NULL DEFAULT 0", "termination_locked");
addColumn("last_state_change_at INTEGER", "last_state_change_at");
addColumn("probe_interval_sec INTEGER", "probe_interval_sec");

const existingAccountCols = new Set(
  (sqlite.prepare(`PRAGMA table_info(cloud_accounts)`).all() as { name: string }[]).map(
    (r) => r.name,
  ),
);
if (!existingAccountCols.has("regions")) {
  sqlite.exec(`ALTER TABLE cloud_accounts ADD COLUMN regions TEXT`);
}
if (!existingAccountCols.has("default_tags")) {
  sqlite.exec(`ALTER TABLE cloud_accounts ADD COLUMN default_tags TEXT`);
}
if (!existingAccountCols.has("snapshot_retention_count")) {
  sqlite.exec(`ALTER TABLE cloud_accounts ADD COLUMN snapshot_retention_count INTEGER`);
}
if (!existingAccountCols.has("monthly_budget_usd")) {
  sqlite.exec(`ALTER TABLE cloud_accounts ADD COLUMN monthly_budget_usd REAL`);
}
if (!existingAccountCols.has("required_tags")) {
  sqlite.exec(`ALTER TABLE cloud_accounts ADD COLUMN required_tags TEXT`);
}
if (!existingAccountCols.has("vcpu_quota")) {
  sqlite.exec(`ALTER TABLE cloud_accounts ADD COLUMN vcpu_quota INTEGER`);
}
if (!existingAccountCols.has("safe_terminate")) {
  sqlite.exec(`ALTER TABLE cloud_accounts ADD COLUMN safe_terminate INTEGER NOT NULL DEFAULT 0`);
}
if (!existingAccountCols.has("auto_tag_rules")) {
  sqlite.exec(`ALTER TABLE cloud_accounts ADD COLUMN auto_tag_rules TEXT`);
}
if (!existingAccountCols.has("probe_key_enc")) {
  sqlite.exec(`ALTER TABLE cloud_accounts ADD COLUMN probe_key_enc TEXT`);
}

const webhookCols = sqlite
  .prepare("PRAGMA table_info(webhooks)")
  .all() as Array<{ name: string }>;
const existingWebhookCols = new Set(webhookCols.map((c) => c.name));
if (webhookCols.length > 0 && !existingWebhookCols.has("cooldown_sec")) {
  sqlite.exec(`ALTER TABLE webhooks ADD COLUMN cooldown_sec INTEGER`);
}

sqlite.exec(`CREATE TABLE IF NOT EXISTS sync_history (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES cloud_accounts(id) ON DELETE CASCADE,
  region TEXT NOT NULL,
  captured_at INTEGER NOT NULL DEFAULT (unixepoch()),
  duration_ms INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  added INTEGER NOT NULL DEFAULT 0,
  removed INTEGER NOT NULL DEFAULT 0,
  state_changed INTEGER NOT NULL DEFAULT 0,
  details_json TEXT
)`);
sqlite.exec(
  `CREATE INDEX IF NOT EXISTS idx_sync_history_acct_time ON sync_history(account_id, captured_at DESC)`,
);

sqlite.exec(`CREATE TABLE IF NOT EXISTS boot_scripts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
)`);

sqlite.exec(`CREATE TABLE IF NOT EXISTS compose_recipes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  body TEXT NOT NULL,
  build_location TEXT NOT NULL DEFAULT 'remote',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
)`);

sqlite.exec(`CREATE TABLE IF NOT EXISTS compose_recipe_versions (
  id TEXT PRIMARY KEY,
  recipe_id TEXT NOT NULL REFERENCES compose_recipes(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  body TEXT NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
)`);
sqlite.exec(
  `CREATE INDEX IF NOT EXISTS idx_compose_recipe_versions ON compose_recipe_versions(recipe_id, version DESC)`,
);

sqlite.exec(`CREATE TABLE IF NOT EXISTS registry_credentials (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  registry_url TEXT NOT NULL,
  credentials TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
)`);

sqlite.exec(`CREATE TABLE IF NOT EXISTS image_builds (
  id TEXT PRIMARY KEY,
  registry_id TEXT NOT NULL REFERENCES registry_credentials(id) ON DELETE CASCADE,
  image_ref TEXT NOT NULL,
  build_location TEXT NOT NULL,
  instance_id TEXT,
  dockerfile TEXT,
  context_path TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  log_output TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  finished_at INTEGER
)`);
sqlite.exec(
  `CREATE INDEX IF NOT EXISTS idx_image_builds_created ON image_builds(created_at DESC)`,
);

sqlite.exec(`CREATE TABLE IF NOT EXISTS resource_history (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES cloud_accounts(id) ON DELETE CASCADE,
  region TEXT NOT NULL,
  kind TEXT NOT NULL,
  external_id TEXT NOT NULL,
  captured_at INTEGER NOT NULL DEFAULT (unixepoch()),
  prev_json TEXT,
  next_json TEXT NOT NULL
)`);
sqlite.exec(
  `CREATE INDEX IF NOT EXISTS idx_resource_history_lookup ON resource_history(account_id, kind, external_id, captured_at DESC)`,
);

sqlite.exec(`CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_login_at INTEGER
)`);

const userCols = sqlite.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
const existingUserCols = new Set(userCols.map((c) => c.name));
if (!existingUserCols.has("totp_secret_enc")) {
  sqlite.exec(`ALTER TABLE users ADD COLUMN totp_secret_enc TEXT`);
}
if (!existingUserCols.has("totp_verified_at")) {
  sqlite.exec(`ALTER TABLE users ADD COLUMN totp_verified_at INTEGER`);
}
if (!existingUserCols.has("totp_backup_codes_enc")) {
  sqlite.exec(`ALTER TABLE users ADD COLUMN totp_backup_codes_enc TEXT`);
}

sqlite.exec(`CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_seen_at INTEGER NOT NULL DEFAULT (unixepoch())
)`);
sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`);

sqlite.exec(`CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  rate_limit_per_minute INTEGER NOT NULL DEFAULT 60,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  revoked_at INTEGER,
  last_used_at INTEGER
)`);

sqlite.exec(`CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  title TEXT NOT NULL,
  body TEXT,
  href TEXT,
  account_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  seen_at INTEGER,
  dismissed_at INTEGER
)`);
sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications(dismissed_at, created_at DESC)`);

sqlite.exec(`CREATE TABLE IF NOT EXISTS passkeys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  label TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_used_at INTEGER
)`);
sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_passkeys_user ON passkeys(user_id)`);

sqlite.exec(`CREATE TABLE IF NOT EXISTS cost_recommendations (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES cloud_accounts(id) ON DELETE CASCADE,
  instance_id TEXT NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  confidence TEXT NOT NULL DEFAULT 'medium',
  summary TEXT NOT NULL,
  suggested_instance_type TEXT,
  observed_cpu_p95 REAL,
  lookback_hours INTEGER,
  est_monthly_savings_usd REAL,
  details_json TEXT,
  computed_at INTEGER NOT NULL DEFAULT (unixepoch())
)`);
sqlite.exec(
  `CREATE INDEX IF NOT EXISTS idx_cost_rec_account ON cost_recommendations(account_id, computed_at DESC)`,
);
sqlite.exec(
  `CREATE INDEX IF NOT EXISTS idx_cost_rec_instance ON cost_recommendations(instance_id)`,
);

sqlite.exec(`CREATE TABLE IF NOT EXISTS alert_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  scope_json TEXT,
  expression_json TEXT NOT NULL,
  channels_json TEXT NOT NULL,
  message_template TEXT,
  severity TEXT NOT NULL DEFAULT 'warning',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
)`);

sqlite.exec(`CREATE TABLE IF NOT EXISTS alert_channels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  config_enc TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
)`);

sqlite.exec(`CREATE TABLE IF NOT EXISTS alert_firings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id TEXT NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  instance_id TEXT,
  metric TEXT NOT NULL,
  value REAL NOT NULL,
  threshold REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'firing',
  message TEXT,
  delivery_json TEXT,
  fired_at INTEGER NOT NULL DEFAULT (unixepoch()),
  resolved_at INTEGER
)`);
sqlite.exec(
  `CREATE INDEX IF NOT EXISTS idx_alert_firings_rule ON alert_firings(rule_id, fired_at DESC)`,
);
sqlite.exec(
  `CREATE INDEX IF NOT EXISTS idx_alert_firings_instance ON alert_firings(instance_id, fired_at DESC)`,
);

sqlite.exec(`CREATE TABLE IF NOT EXISTS probe_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_id TEXT NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
  metrics_json TEXT NOT NULL,
  collected_at INTEGER NOT NULL DEFAULT (unixepoch())
)`);
sqlite.exec(
  `CREATE INDEX IF NOT EXISTS idx_probe_samples_instance ON probe_samples(instance_id, collected_at DESC)`,
);

// Write-time redaction: a SQLite UDF + AFTER INSERT trigger redacts secrets
// in audit_log.message before any consumer can read raw values. This is a
// defense-in-depth layer on top of read-time redaction in queries.
sqlite.function("vmui_redact", { deterministic: false }, (msg: unknown) => {
  if (typeof msg !== "string" || msg.length === 0) return msg as string | null;
  return redactQuiet(msg);
});
sqlite.exec(`
CREATE TRIGGER IF NOT EXISTS audit_log_redact_message
AFTER INSERT ON audit_log
FOR EACH ROW WHEN NEW.message IS NOT NULL
BEGIN
  UPDATE audit_log SET message = vmui_redact(NEW.message) WHERE id = NEW.id;
END;
`);

// FTS5 search index over audit_log (action/target/status/message). Kept in
// sync via triggers; rebuilt on bootstrap if rowcount drifts from base table.
try {
  sqlite.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS audit_log_fts USING fts5(
    action, target, status, message,
    content='audit_log', content_rowid='id', tokenize='unicode61 remove_diacritics 2'
  )`);
  sqlite.exec(`CREATE TRIGGER IF NOT EXISTS audit_log_fts_ai AFTER INSERT ON audit_log BEGIN
    INSERT INTO audit_log_fts(rowid, action, target, status, message)
    VALUES (NEW.id, NEW.action, NEW.target, NEW.status, NEW.message);
  END;`);
  sqlite.exec(`CREATE TRIGGER IF NOT EXISTS audit_log_fts_ad AFTER DELETE ON audit_log BEGIN
    INSERT INTO audit_log_fts(audit_log_fts, rowid, action, target, status, message)
    VALUES ('delete', OLD.id, OLD.action, OLD.target, OLD.status, OLD.message);
  END;`);
  sqlite.exec(`CREATE TRIGGER IF NOT EXISTS audit_log_fts_au AFTER UPDATE ON audit_log BEGIN
    INSERT INTO audit_log_fts(audit_log_fts, rowid, action, target, status, message)
    VALUES ('delete', OLD.id, OLD.action, OLD.target, OLD.status, OLD.message);
    INSERT INTO audit_log_fts(rowid, action, target, status, message)
    VALUES (NEW.id, NEW.action, NEW.target, NEW.status, NEW.message);
  END;`);
  const base = sqlite.prepare("SELECT COUNT(*) as c FROM audit_log").get() as { c: number };
  const fts = sqlite.prepare("SELECT COUNT(*) as c FROM audit_log_fts").get() as { c: number };
  if (base.c !== fts.c) {
    sqlite.exec(`INSERT INTO audit_log_fts(audit_log_fts) VALUES('rebuild')`);
  }
} catch (e) {
  console.warn("[db] FTS5 init failed:", (e as Error).message);
}

export const db = drizzle(sqlite, { schema });
export { schema };
export { sqlite as rawSqlite };
