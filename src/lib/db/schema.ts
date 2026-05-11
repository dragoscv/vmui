import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const cloudAccounts = sqliteTable("cloud_accounts", {
  id: text("id").primaryKey(),
  provider: text("provider", { enum: ["aws", "azure", "gcp", "scaleway", "digitalocean", "hetzner", "local-kvm"] }).notNull(),
  name: text("name").notNull(),
  /** Default region used when the provider needs one. */
  defaultRegion: text("default_region"),
  /** JSON array of additional regions to sync. null = only defaultRegion. */
  regions: text("regions"),
  /** JSON map (string→string) of tags auto-applied to every new instance. */
  defaultTags: text("default_tags"),
  /** Keep at most N snapshots per instance (matched by name fragment). 0 / null disables retention. */
  snapshotRetentionCount: integer("snapshot_retention_count"),
  /** Hard monthly USD cap; createInstance refuses to launch when projected monthly burn would exceed it. */
  monthlyBudgetUsd: real("monthly_budget_usd"),
  /** JSON array of tag keys that every instance in this account must carry; compliance flags violations. */
  requiredTags: text("required_tags"),
  /** Hard vCPU cap (sum across running instances). createInstance refuses to launch when exceeding it. */
  vcpuQuota: integer("vcpu_quota"),
  /** When true, terminateInstance auto-creates a snapshot first if no recent one exists. */
  safeTerminate: integer("safe_terminate", { mode: "boolean" }).notNull().default(false),
  /**
   * JSON array of `{ pattern: string; tags: Record<string,string> }` rules.
   * On instance sync each rule whose regex matches the instance name applies
   * the listed tags locally (in instanceTags), without touching the provider.
   */
  autoTagRules: text("auto_tag_rules"),
  /** Encrypted JSON blob of provider credentials (AES-256-GCM, base64). */
  credentialsEnc: text("credentials_enc").notNull(),
  /** Cached display info (account id, email, etc.) — encrypted JSON. */
  metadataEnc: text("metadata_enc"),
  /**
   * Encrypted JSON of `{ privateKey: string; passphrase?: string; defaultUser?: string }`
   * used as the agent SSH key for live-stats probes & cloud-init log streaming
   * across every instance in this account. Upload once, reuse everywhere.
   */
  probeKeyEnc: text("probe_key_enc"),
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
  /** User-edited display name. Preserved across syncs; falls back to provider name. */
  displayName: text("display_name"),
  /** User-pinned to the top. */
  pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
  /** Manual sort order (lower = earlier). null when not manually ordered. */
  sortOrder: integer("sort_order"),
  /** Free-form user notes. */
  notes: text("notes"),
  /** When true, terminate is refused and surfaced in the UI as a lock icon. */
  terminationLocked: integer("termination_locked", { mode: "boolean" }).notNull().default(false),
  /** Live-stats probe interval in seconds (5..600). null = inherits global default. */
  probeIntervalSec: integer("probe_interval_sec"),
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
  /**
   * Updated every time the normalized state changes during a sync. Used by
   * idle-detection to flag long-running instances that nobody has touched.
   */
  lastStateChangeAt: integer("last_state_change_at", { mode: "timestamp" }),
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

/**
 * Cached on-demand hourly prices keyed by provider+region+type+platform.
 * Source can be "static", "aws-pricing-api", "scaleway-catalog", etc.
 */
export const pricingCache = sqliteTable("pricing_cache", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  region: text("region").notNull(),
  instanceType: text("instance_type").notNull(),
  platform: text("platform").notNull(),
  usdPerHour: real("usd_per_hour").notNull(),
  source: text("source").notNull(),
  fetchedAt: integer("fetched_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type CloudAccountRow = typeof cloudAccounts.$inferSelect;
export type InstanceRow = typeof instances.$inferSelect;
export type PricingCacheRow = typeof pricingCache.$inferSelect;

/**
 * Cached cloud resources beyond compute instances — volumes, snapshots,
 * security groups, keypairs, networks, buckets, etc. One row per (account,
 * region, kind, externalId).
 */
export const cachedResources = sqliteTable("cached_resources", {
  /** Synthetic: `${accountId}:${region}:${kind}:${externalId}`. */
  id: text("id").primaryKey(),
  accountId: text("account_id")
    .notNull()
    .references(() => cloudAccounts.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  region: text("region").notNull(),
  /** Resource kind: volume, snapshot, security-group, keypair, vpc, subnet, bucket, ... */
  kind: text("kind").notNull(),
  externalId: text("external_id").notNull(),
  name: text("name"),
  /** Provider-specific status (available, in-use, completed, ...). */
  status: text("status"),
  /** Free-form size in bytes (volumes, snapshots, buckets). */
  sizeBytes: integer("size_bytes"),
  /** Reference to an instance row id when this resource is attached. */
  attachedToInstanceId: text("attached_to_instance_id"),
  /** Estimated USD/month (null when unknown / free). */
  monthlyUsd: real("monthly_usd"),
  rawJson: text("raw_json"),
  lastSyncedAt: integer("last_synced_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type CachedResourceRow = typeof cachedResources.$inferSelect;

/**
 * Locally-managed SSH key pairs. The private key is encrypted with the master
 * key (AES-256-GCM); public keys are stored in cleartext. vmui uses these to
 * inject ssh keys at create-time (Azure / GCP / Scaleway) and to authenticate
 * the browser SSH bridge. AWS keypairs live server-side and are referenced by
 * name only — vmui does not store them here.
 */
export const sshKeys = sqliteTable("ssh_keys", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** "rsa" | "ed25519" | "imported". Lowercase. */
  algo: text("algo").notNull(),
  /** OpenSSH-format public key (ssh-rsa AAAA… / ssh-ed25519 AAAA…). */
  publicKey: text("public_key").notNull(),
  /** Encrypted PEM/OpenSSH private key. May be null if user only stored the public half. */
  privateKeyEnc: text("private_key_enc"),
  /** Optional passphrase encrypted alongside the private key. */
  passphraseEnc: text("passphrase_enc"),
  /** Optional fingerprint for de-dup / display. */
  fingerprint: text("fingerprint"),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type SshKeyRow = typeof sshKeys.$inferSelect;

/**
 * Time-series snapshots captured at the end of every successful sync.
 * Used for sparklines on the dashboard and per-account history.
 */
export const snapshotHistory = sqliteTable("snapshot_history", {
  id: text("id").primaryKey(),
  accountId: text("account_id")
    .notNull()
    .references(() => cloudAccounts.id, { onDelete: "cascade" }),
  capturedAt: integer("captured_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  totalInstances: integer("total_instances").notNull(),
  runningInstances: integer("running_instances").notNull(),
  hourlyUsd: real("hourly_usd").notNull(),
});

export type SnapshotHistoryRow = typeof snapshotHistory.$inferSelect;

/**
 * Schedules: per-instance cron-driven actions (auto-shutdown, scheduled
 * reboot, etc.). The cron expression is evaluated in the server's local TZ.
 */
export const schedules = sqliteTable("schedules", {
  id: text("id").primaryKey(),
  instanceId: text("instance_id")
    .notNull()
    .references(() => instances.id, { onDelete: "cascade" }),
  accountId: text("account_id")
    .notNull()
    .references(() => cloudAccounts.id, { onDelete: "cascade" }),
  cron: text("cron").notNull(),
  action: text("action", { enum: ["start", "stop", "reboot", "snapshot"] }).notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  label: text("label"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  lastRunAt: integer("last_run_at", { mode: "timestamp" }),
  lastRunStatus: text("last_run_status"),
});

export type ScheduleRow = typeof schedules.$inferSelect;

/**
 * Local tags. Lives parallel to provider-native tags so it works on every
 * provider including local-kvm and Scaleway. `(instanceId, key)` is unique
 * per instance — re-tagging overwrites the value. Empty `value` means a
 * label-style tag.
 */
export const instanceTags = sqliteTable("instance_tags", {
  id: text("id").primaryKey(),
  instanceId: text("instance_id")
    .notNull()
    .references(() => instances.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  value: text("value").notNull().default(""),
  /** "local" | "synced" — when synced, this row mirrors a provider tag. */
  source: text("source", { enum: ["local", "synced"] }).notNull().default("local"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type InstanceTagRow = typeof instanceTags.$inferSelect;

/**
 * Pinned SSH host keys. The first time the SSH bridge connects to a (host,
 * port) pair we record the server's public-key fingerprint; subsequent
 * connections refuse to proceed if the fingerprint changes (same model as
 * OpenSSH's known_hosts). Removing a row resets to "trust on next use".
 */
export const sshHostKeys = sqliteTable("ssh_host_keys", {
  id: text("id").primaryKey(),
  host: text("host").notNull(),
  port: integer("port").notNull().default(22),
  /** Algorithm reported by the server, e.g. "ssh-ed25519" or "ssh-rsa". */
  algorithm: text("algorithm").notNull(),
  /** Hex-encoded SHA-256 of the server's host key. */
  fingerprintSha256: text("fingerprint_sha256").notNull(),
  firstSeenAt: integer("first_seen_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  /** Optional note shown in the UI ("home lab", "prod box"). */
  note: text("note"),
});

export type SshHostKeyRow = typeof sshHostKeys.$inferSelect;

/**
 * Per-tag-key cost budgets. Tracks a single tag key (e.g. "team", "env")
 * and a monthly USD threshold. Every cost sync evaluates current monthly
 * burn for each tag value under that key; crossings get audit-logged and
 * the next dashboard load shows a banner.
 */
export const tagBudgets = sqliteTable("tag_budgets", {
  id: text("id").primaryKey(),
  /** Tag key to slice costs by. */
  tagKey: text("tag_key").notNull(),
  /** Optional tag value to scope the budget; null = all values under tagKey. */
  tagValue: text("tag_value"),
  /** Monthly USD budget. */
  monthlyUsd: real("monthly_usd").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  /** Last time this budget was evaluated. */
  lastCheckedAt: integer("last_checked_at", { mode: "timestamp" }),
  /** Most recent observed monthly USD (snapshot at lastCheckedAt). */
  lastObservedUsd: real("last_observed_usd"),
  /** 0/1 — set to 1 once the budget is first exceeded; cleared on reset. */
  exceeded: integer("exceeded").notNull().default(0),
});

export type TagBudgetRow = typeof tagBudgets.$inferSelect;

/**
 * Outgoing webhook destinations. Each row matches a Slack/Discord/Generic
 * URL plus a JSON-array channel filter. The dispatcher subscribes once at
 * boot and POSTs a compact JSON body to each subscriber whose channels
 * include the fired event. Failures are audit-logged but never thrown.
 */
export const webhooks = sqliteTable("webhooks", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  /** "slack" | "discord" | "generic" — controls body shape. */
  kind: text("kind", { enum: ["slack", "discord", "generic"] }).notNull(),
  /** JSON array of subscribed event channels. */
  channels: text("channels").notNull(),
  enabled: integer("enabled").notNull().default(1),
  /** Minimum seconds between successive deliveries; 0/null = no cooldown. */
  cooldownSec: integer("cooldown_sec"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  lastFiredAt: integer("last_fired_at", { mode: "timestamp" }),
  lastStatus: text("last_status"),
});

export type WebhookRow = typeof webhooks.$inferSelect;

/**
 * Per-region sync events with diff counters. Lets users review what changed
 * over time, debug missing syncs, and audit drift. We store a compact JSON
 * blob with the list of impacted instance ids so the explorer can show
 * per-row detail without re-querying the provider.
 */
export const syncHistory = sqliteTable("sync_history", {
  id: text("id").primaryKey(),
  accountId: text("account_id")
    .notNull()
    .references(() => cloudAccounts.id, { onDelete: "cascade" }),
  region: text("region").notNull(),
  capturedAt: integer("captured_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  durationMs: integer("duration_ms").notNull().default(0),
  total: integer("total").notNull().default(0),
  added: integer("added").notNull().default(0),
  removed: integer("removed").notNull().default(0),
  stateChanged: integer("state_changed").notNull().default(0),
  /** Optional JSON: { added: string[]; removed: string[]; stateChanged: Array<{id, from, to}> } */
  detailsJson: text("details_json"),
});

export type SyncHistoryRow = typeof syncHistory.$inferSelect;

/**
 * Reusable boot scripts (cloud-init or shell). When a VM is created with a
 * `bootScriptId` set, the script body is passed as user-data to the
 * provider create call. Scripts are stored verbatim and never executed by
 * vmui itself — only by the guest OS.
 */
export const bootScripts = sqliteTable("boot_scripts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  /** "cloud-init" | "bash" | "powershell" — advisory only; passed verbatim. */
  kind: text("kind", { enum: ["cloud-init", "bash", "powershell"] }).notNull(),
  body: text("body").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type BootScriptRow = typeof bootScripts.$inferSelect;

/**
 * Append-only history of `cached_resources.rawJson` changes. A row is
 * inserted whenever a sync detects that the upstream provider JSON for an
 * already-known resource differs from what we have cached. Allows users to
 * see infrastructure drift over time.
 */
export const resourceHistory = sqliteTable("resource_history", {
  id: text("id").primaryKey(),
  accountId: text("account_id")
    .notNull()
    .references(() => cloudAccounts.id, { onDelete: "cascade" }),
  region: text("region").notNull(),
  kind: text("kind").notNull(),
  externalId: text("external_id").notNull(),
  capturedAt: integer("captured_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  prevJson: text("prev_json"),
  nextJson: text("next_json").notNull(),
});

export type ResourceHistoryRow = typeof resourceHistory.$inferSelect;

/**
 * Optional local user accounts for multi-user deployments. When the table is
 * empty vmui runs in single-user mode (no auth). Once a user exists the
 * sign-in screen and role checks become mandatory.
 */
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["admin", "operator", "viewer"] }).notNull().default("viewer"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  lastLoginAt: integer("last_login_at", { mode: "timestamp" }),
  /** Encrypted base32 TOTP secret (AES-256-GCM). Null when not enrolled. */
  totpSecretEnc: text("totp_secret_enc"),
  /** When the user successfully verified the first code; null = pending. */
  totpVerifiedAt: integer("totp_verified_at", { mode: "timestamp" }),
  /** Encrypted JSON array of single-use backup codes. */
  totpBackupCodesEnc: text("totp_backup_codes_enc"),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type UserRole = UserRow["role"];

/**
 * API keys for the public /api/v1 surface. Stored as scrypt hashes; the
 * plaintext key is shown exactly once at creation time. Rate limit is enforced
 * per-key in memory by `src/lib/api-auth.ts`.
 */
export const apiKeys = sqliteTable("api_keys", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  hash: text("hash").notNull(),
  role: text("role", { enum: ["operator", "viewer"] }).notNull().default("viewer"),
  rateLimitPerMinute: integer("rate_limit_per_minute").notNull().default(60),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  revokedAt: integer("revoked_at", { mode: "timestamp" }),
  lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
});

export type ApiKeyRow = typeof apiKeys.$inferSelect;

/**
 * In-app notification center. Persisted, append-only inbox of human-relevant
 * events: failed actions, schedule misses, budget breaches, compliance
 * findings, drift, etc. Audit log is the source of truth for everything;
 * notifications are the curated, dismissible subset surfaced in the topbar
 * bell. `seenAt` tracks first view; `dismissedAt` hides from default views.
 */
export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey(),
  /** Category for grouping/filtering: "auth" | "cost" | "compliance" | "schedule" | "sync" | "instance" | "system" */
  category: text("category").notNull(),
  /** "info" | "success" | "warning" | "error" */
  severity: text("severity", { enum: ["info", "success", "warning", "error"] }).notNull().default("info"),
  title: text("title").notNull(),
  body: text("body"),
  /** Optional deep-link path inside the app (e.g. "/instances/abc"). */
  href: text("href"),
  /** Optional related accountId for filtering. */
  accountId: text("account_id"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  seenAt: integer("seen_at", { mode: "timestamp" }),
  dismissedAt: integer("dismissed_at", { mode: "timestamp" }),
});

export type NotificationRow = typeof notifications.$inferSelect;

/**
 * Registered WebAuthn / Passkey credentials. One row per credential per
 * user. `publicKey` and `credentialId` are stored base64url-encoded so we
 * can survive process restarts. `counter` is updated on every successful
 * assertion to detect cloned authenticators.
 */
export const passkeys = sqliteTable("passkeys", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  /** base64url-encoded credential ID. */
  credentialId: text("credential_id").notNull().unique(),
  /** base64url-encoded COSE public key. */
  publicKey: text("public_key").notNull(),
  counter: integer("counter").notNull().default(0),
  /** Comma-separated transports hint (e.g. "internal,hybrid"). */
  transports: text("transports"),
  /** Human-friendly label set by the user at registration time. */
  label: text("label").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
});

export type PasskeyRow = typeof passkeys.$inferSelect;

/**
 * Cached cost optimisation recommendations. One row per (account, instance,
 * kind). Refreshed on demand and on a 12h scheduler tick. Cleared when the
 * underlying instance disappears.
 */
export const costRecommendations = sqliteTable("cost_recommendations", {
  id: text("id").primaryKey(),
  accountId: text("account_id")
    .notNull()
    .references(() => cloudAccounts.id, { onDelete: "cascade" }),
  instanceId: text("instance_id")
    .notNull()
    .references(() => instances.id, { onDelete: "cascade" }),
  /** "rightsize" | "idle" | "stop-after-hours" | "spot-eligible" */
  kind: text("kind").notNull(),
  /** Severity-style confidence indicator: "low" | "medium" | "high". */
  confidence: text("confidence").notNull().default("medium"),
  /** Free-form one-line summary shown in the UI. */
  summary: text("summary").notNull(),
  /** Optional suggested instance type (rightsize). */
  suggestedInstanceType: text("suggested_instance_type"),
  /** Observed p95 CPU over the lookback window, percent. */
  observedCpuP95: real("observed_cpu_p95"),
  /** Hours of CPU sample data analysed. */
  lookbackHours: integer("lookback_hours"),
  /** Estimated monthly savings if applied (positive number). */
  estMonthlySavingsUsd: real("est_monthly_savings_usd"),
  /** Optional payload (e.g. CW datapoint counts). */
  detailsJson: text("details_json"),
  computedAt: integer("computed_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type CostRecommendationRow = typeof costRecommendations.$inferSelect;

export const alertRules = sqliteTable("alert_rules", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  /** Filter scope: null = all instances; JSON `{accountIds?: string[]; tagKey?: string; tagValue?: string}` */
  scopeJson: text("scope_json"),
  /**
   * Rule expression as JSON:
   * { metric: "cpu"|"mem"|"disk"|"net_in"|"net_out"|"load1"|"uptime";
   *   op: ">"|"<"|">="|"<="|"=="|"!=";
   *   threshold: number;
   *   windowSec: number;   // sustained for this many seconds
   *   cooldownSec?: number; // suppress refires for this many seconds (default 600)
   * }
   */
  expressionJson: text("expression_json").notNull(),
  /** JSON array of channel ids referenced from alertChannels. */
  channelsJson: text("channels_json").notNull(),
  /** ISO message template; supports {{instance}}, {{metric}}, {{value}}, {{threshold}}. */
  messageTemplate: text("message_template"),
  /** "info" | "warning" | "critical" */
  severity: text("severity").notNull().default("warning"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type AlertRuleRow = typeof alertRules.$inferSelect;

export const alertChannels = sqliteTable("alert_channels", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** "toast" | "discord" | "slack" | "ntfy" | "webhook" | "smtp" */
  kind: text("kind").notNull(),
  /** Encrypted JSON config (webhook URL, SMTP creds, etc.). */
  configEnc: text("config_enc").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type AlertChannelRow = typeof alertChannels.$inferSelect;

export const alertFirings = sqliteTable("alert_firings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ruleId: text("rule_id")
    .notNull()
    .references(() => alertRules.id, { onDelete: "cascade" }),
  instanceId: text("instance_id"),
  metric: text("metric").notNull(),
  value: real("value").notNull(),
  threshold: real("threshold").notNull(),
  status: text("status", { enum: ["firing", "resolved"] }).notNull().default("firing"),
  message: text("message"),
  /** JSON array of `{channel, status, error?}` results. */
  deliveryJson: text("delivery_json"),
  firedAt: integer("fired_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  resolvedAt: integer("resolved_at", { mode: "timestamp" }),
});

export type AlertFiringRow = typeof alertFirings.$inferSelect;

export const probeSamples = sqliteTable("probe_samples", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  instanceId: text("instance_id")
    .notNull()
    .references(() => instances.id, { onDelete: "cascade" }),
  /** Composite metric JSON: { cpu, mem, disk, net_in, net_out, load1, uptime, cores: number[], iops? } */
  metricsJson: text("metrics_json").notNull(),
  collectedAt: integer("collected_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type ProbeSampleRow = typeof probeSamples.$inferSelect;
