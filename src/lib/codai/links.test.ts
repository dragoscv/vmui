import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";

const sqlite = new Database(":memory:");
sqlite.pragma("foreign_keys = ON");
sqlite.exec(`
CREATE TABLE cloud_accounts (id TEXT PRIMARY KEY, provider TEXT NOT NULL, name TEXT NOT NULL, default_region TEXT, regions TEXT, default_tags TEXT,
  snapshot_retention_count INTEGER, monthly_budget_usd REAL, required_tags TEXT, vcpu_quota INTEGER, safe_terminate INTEGER NOT NULL DEFAULT 0,
  auto_tag_rules TEXT, credentials_enc TEXT NOT NULL, metadata_enc TEXT, probe_key_enc TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch()));
CREATE TABLE instances (id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES cloud_accounts(id) ON DELETE CASCADE, provider TEXT NOT NULL,
  region TEXT NOT NULL, provider_instance_id TEXT NOT NULL, name TEXT, display_name TEXT, pinned INTEGER NOT NULL DEFAULT 0, sort_order INTEGER,
  notes TEXT, termination_locked INTEGER NOT NULL DEFAULT 0, probe_interval_sec INTEGER, state TEXT NOT NULL DEFAULT 'unknown',
  platform TEXT NOT NULL DEFAULT 'linux', instance_type TEXT, public_ip TEXT, public_dns TEXT, private_ip TEXT, key_name TEXT, raw_json TEXT,
  last_synced_at INTEGER, last_state_change_at INTEGER, created_at INTEGER NOT NULL DEFAULT (unixepoch()));
CREATE TABLE codai_environments (
  instance_id TEXT PRIMARY KEY REFERENCES instances(id) ON DELETE CASCADE,
  environment_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  last_status TEXT NOT NULL DEFAULT 'pending',
  last_checked_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
`);
const db = drizzle(sqlite, { schema });

vi.mock("@/lib/db", () => ({ db }));

const { deleteCodaiLink, getCodaiLink, updateCodaiLinkStatus, upsertCodaiLink } = await import("./links");

const INSTANCE = "acc:eu:vm-1";

beforeEach(() => {
  sqlite.exec("DELETE FROM codai_environments; DELETE FROM instances; DELETE FROM cloud_accounts;");
  sqlite.prepare("INSERT INTO cloud_accounts (id, provider, name, credentials_enc) VALUES ('acc', 'local-kvm', 'a', 'x')").run();
  sqlite.prepare("INSERT INTO instances (id, account_id, provider, region, provider_instance_id) VALUES (?, 'acc', 'local-kvm', 'eu', 'vm-1')").run(INSTANCE);
});

describe("codai_environments link rows", () => {
  it("round-trips insert → read → status update → delete", async () => {
    expect(await getCodaiLink(INSTANCE)).toBeNull();
    await upsertCodaiLink({ instanceId: INSTANCE, environmentId: "env-1", projectId: "proj-1", slug: "homelab-ab12", lastStatus: "pending" });
    const row = await getCodaiLink(INSTANCE);
    expect(row).toMatchObject({ instanceId: INSTANCE, environmentId: "env-1", projectId: "proj-1", slug: "homelab-ab12", lastStatus: "pending" });
    expect(row?.lastCheckedAt).toBeInstanceOf(Date);
    expect(row?.createdAt).toBeInstanceOf(Date);

    await updateCodaiLinkStatus(INSTANCE, "running");
    expect((await getCodaiLink(INSTANCE))?.lastStatus).toBe("running");

    await deleteCodaiLink(INSTANCE);
    expect(await getCodaiLink(INSTANCE)).toBeNull();
  });

  it("upsert replaces the link for the same instance instead of failing on the primary key", async () => {
    await upsertCodaiLink({ instanceId: INSTANCE, environmentId: "env-1", projectId: "proj-1", slug: "a", lastStatus: "pending" });
    await upsertCodaiLink({ instanceId: INSTANCE, environmentId: "env-2", projectId: "proj-2", slug: "b", lastStatus: "enrolling" });
    const rows = sqlite.prepare("SELECT environment_id, slug FROM codai_environments").all();
    expect(rows).toEqual([{ environment_id: "env-2", slug: "b" }]);
  });

  it("is removed when the instance row disappears (ON DELETE CASCADE)", async () => {
    await upsertCodaiLink({ instanceId: INSTANCE, environmentId: "env-1", projectId: "proj-1", slug: "a", lastStatus: "pending" });
    sqlite.prepare("DELETE FROM instances WHERE id = ?").run(INSTANCE);
    expect(await getCodaiLink(INSTANCE)).toBeNull();
  });
});
