import { beforeEach, describe, expect, it, vi } from "vitest";

const inserted: Record<string, unknown>[] = [];
const updated: Record<string, unknown>[] = [];
const notified: Record<string, unknown>[] = [];
let startInstance = vi.fn(async () => undefined);

vi.mock("@/lib/db", () => {
  const inst = { id: "acc:r:i-1", region: "r", providerInstanceId: "i-1", name: "dev" };
  return {
    db: {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [inst] }) }) }),
      update: () => ({ set: (v: Record<string, unknown>) => ({ where: async () => { updated.push(v); } }) }),
      insert: () => ({ values: async (v: Record<string, unknown>) => { inserted.push(v); } }),
    },
  };
});
vi.mock("@/lib/db/schema", () => ({ schedules: {}, instances: { id: "id" }, auditLog: {}, cloudAccounts: {} }));
vi.mock("@/lib/providers/registry", () => ({ getProvider: async () => ({ provider: { startInstance } }) }));
vi.mock("@/lib/notifications", () => ({ notify: async (n: Record<string, unknown>) => { notified.push(n); } }));
vi.mock("@/lib/redact", () => ({ redactSecrets: (s: string) => s }));
vi.mock("@/server/actions/snapshot-retention", () => ({ applySnapshotRetentionAction: async () => undefined }));
vi.mock("@/lib/idle-park", () => ({ maybeRunIdlePark: async () => undefined }));
vi.mock("@/lib/fleet-diff", () => ({ captureFleetSnapshot: async () => undefined }));
vi.mock("@/lib/burn-rate", () => ({ maybeAlertBurnRate: async () => undefined }));
vi.mock("@/server/actions/templates-and-budgets", () => ({ checkAccountBudgets: async () => undefined }));
vi.mock("@/lib/idle-and-drift", () => ({
  maybeRunIdleAutoStop: async () => undefined,
  maybeRecomputeBaselines: async () => undefined,
  maybeCheckDrift: async () => undefined,
}));
vi.mock("@/lib/audit-chain", () => ({ maybeAppendAuditChain: async () => undefined }));
vi.mock("@/lib/webhook-queue", () => ({ maybeFlushWebhookDeliveries: async () => undefined }));
vi.mock("@/lib/disk-watchdog", () => ({ maybeRunDiskWatchdog: async () => undefined }));

import { executeSchedule } from "./scheduler";
import type { ScheduleRow } from "@/lib/db/schema";

const row: ScheduleRow = {
  id: "s1",
  instanceId: "acc:r:i-1",
  accountId: "acc",
  cron: "0 8 * * 1-5",
  action: "start",
  enabled: true,
  label: null,
  lastRunAt: null,
  lastRunStatus: null,
  createdAt: new Date(0),
} as ScheduleRow;

beforeEach(() => {
  inserted.length = 0;
  updated.length = 0;
  notified.length = 0;
  startInstance = vi.fn(async () => undefined);
});

describe("executeSchedule", () => {
  it("cron trigger audits the cron expression", async () => {
    const r = await executeSchedule(row, { trigger: "cron" });
    expect(r).toEqual({ status: "ok" });
    expect(startInstance).toHaveBeenCalledWith("r", "i-1");
    expect(inserted[0]).toMatchObject({ action: "schedule.start", target: "i-1", status: "ok", message: 'cron "0 8 * * 1-5"' });
    expect(updated[0]).toMatchObject({ lastRunStatus: "ok" });
    expect(notified).toHaveLength(0);
  });

  it("manual trigger audits 'manual run' so history distinguishes it", async () => {
    const r = await executeSchedule(row, { trigger: "manual" });
    expect(r).toEqual({ status: "ok" });
    expect(inserted[0]).toMatchObject({ message: "manual run" });
  });

  it("defaults to cron and notifies on provider failure", async () => {
    startInstance = vi.fn(async () => { throw new Error("boom"); });
    const r = await executeSchedule(row);
    expect(r).toEqual({ status: "error", message: "boom" });
    expect(inserted[0]).toMatchObject({ status: "error", message: "boom" });
    expect(updated[0]).toMatchObject({ lastRunStatus: "error" });
    expect(notified[0]).toMatchObject({ category: "schedule", severity: "error", href: "/instances/acc%3Ar%3Ai-1" });
  });
});
