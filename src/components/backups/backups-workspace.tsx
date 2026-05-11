"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  RefreshCw,
  Play,
  Pause,
  ChevronDown,
  ChevronRight,
  Archive,
  CloudUpload,
  HardDrive,
  Globe,
} from "lucide-react";
import {
  createBackupPolicyAction,
  deleteBackupPolicyAction,
  toggleBackupPolicyAction,
  runBackupNowAction,
  listBackupPoliciesAction,
  listBackupJobsAction,
} from "@/server/actions/backups";
import { verifyBackupJobAction } from "@/server/actions/backup-verify";

type BackupKind = "cloud-snapshot" | "s3-dump" | "local-copy" | "cross-region";

interface PolicyLite {
  id: string;
  name: string;
  kind: BackupKind;
  instanceId: string;
  cronExpr: string;
  retentionJson: string;
  enabled: boolean;
  lastRunAt: Date | null;
  lastStatus: "ok" | "error" | "running" | null;
  lastError: string | null;
  createdAt: Date;
}

interface JobLite {
  id: string;
  policyId: string;
  status: "queued" | "running" | "ok" | "error";
  startedAt: Date;
  finishedAt: Date | null;
  artifactRef: string | null;
  sizeBytes: number | null;
  message: string | null;
}

interface InstanceLite {
  id: string;
  name: string | null;
  providerInstanceId: string;
  provider: string;
}

const KIND_ICON: Record<BackupKind, typeof Archive> = {
  "cloud-snapshot": Archive,
  "s3-dump": CloudUpload,
  "local-copy": HardDrive,
  "cross-region": Globe,
};

const STATUS_COLOR: Record<string, string> = {
  ok: "bg-emerald-500/20 text-emerald-200",
  error: "bg-red-500/20 text-red-200",
  running: "bg-sky-500/20 text-sky-200",
  queued: "bg-slate-500/20 text-slate-200",
};

export function BackupsWorkspace({ instances }: { instances: InstanceLite[] }) {
  const [policies, setPolicies] = useState<PolicyLite[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [jobsFor, setJobsFor] = useState<Record<string, JobLite[]>>({});

  const refresh = async () => {
    const rows = (await listBackupPoliciesAction()) as PolicyLite[];
    setPolicies(rows);
  };

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, []);

  const toggleExpand = async (id: string) => {
    setExpanded(expanded === id ? null : id);
    if (expanded !== id) {
      const jobs = (await listBackupJobsAction(id)) as JobLite[];
      setJobsFor((prev) => ({ ...prev, [id]: jobs }));
    }
  };

  const instanceName = (iid: string) => {
    const i = instances.find((x) => x.id === iid);
    return i ? `${i.name ?? i.providerInstanceId} (${i.provider})` : iid;
  };

  return (
    <div className="grid gap-6">
      <section>
        <header className="mb-2 flex items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Backup policies</h2>
          <button
            type="button"
            onClick={() => void refresh()}
            className="ml-auto inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs hover:bg-[var(--color-surface-muted)]"
          >
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
          <button
            type="button"
            onClick={() => setShowAdd((s) => !s)}
            className="inline-flex items-center gap-1 rounded-md bg-[var(--color-primary)] px-2 py-1 text-xs font-semibold text-[var(--color-primary-fg)]"
          >
            <Plus className="h-3 w-3" /> Add policy
          </button>
        </header>
        {showAdd ? (
          <AddPolicyForm
            instances={instances}
            onDone={() => {
              setShowAdd(false);
              void refresh();
            }}
          />
        ) : null}
        <div className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-surface-muted)] text-xs uppercase text-muted">
              <tr>
                <th className="w-8 px-2 py-2"></th>
                <th className="px-2 py-2 text-left">Name</th>
                <th className="px-2 py-2 text-left">Kind</th>
                <th className="px-2 py-2 text-left">Target</th>
                <th className="px-2 py-2 text-left">Cron</th>
                <th className="px-2 py-2 text-left">Last run</th>
                <th className="px-2 py-2 text-left">Status</th>
                <th className="w-32 px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {policies.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-4 text-center text-xs text-muted">
                    No backup policies yet.
                  </td>
                </tr>
              ) : null}
              {policies.map((p) => {
                const Icon = KIND_ICON[p.kind];
                const open = expanded === p.id;
                return (
                  <PolicyRow
                    key={p.id}
                    policy={p}
                    open={open}
                    icon={Icon}
                    instanceName={instanceName(p.instanceId)}
                    jobs={jobsFor[p.id] ?? []}
                    onToggleExpand={() => void toggleExpand(p.id)}
                    onAfter={refresh}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function PolicyRow({
  policy,
  open,
  icon: Icon,
  instanceName,
  jobs,
  onToggleExpand,
  onAfter,
}: {
  policy: PolicyLite;
  open: boolean;
  icon: typeof Archive;
  instanceName: string;
  jobs: JobLite[];
  onToggleExpand: () => void;
  onAfter: () => Promise<void>;
}) {
  const [pending, start] = useTransition();
  const retention = useMemo(() => {
    try {
      return JSON.parse(policy.retentionJson) as { keepDaily: number; keepWeekly: number; keepMonthly: number };
    } catch {
      return { keepDaily: 0, keepWeekly: 0, keepMonthly: 0 };
    }
  }, [policy.retentionJson]);

  return (
    <>
      <tr className="border-t border-[var(--color-border)]">
        <td className="px-2 py-2">
          <button type="button" onClick={onToggleExpand} className="text-muted hover:text-fg">
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </td>
        <td className="px-2 py-2 font-medium">{policy.name}</td>
        <td className="px-2 py-2">
          <span className="inline-flex items-center gap-1 text-xs">
            <Icon className="h-3 w-3" /> {policy.kind}
          </span>
        </td>
        <td className="px-2 py-2 text-xs">{instanceName}</td>
        <td className="px-2 py-2 font-mono text-xs">{policy.cronExpr}</td>
        <td className="px-2 py-2 text-xs">
          {policy.lastRunAt ? new Date(policy.lastRunAt).toLocaleString() : "—"}
        </td>
        <td className="px-2 py-2">
          {policy.lastStatus ? (
            <span
              className={`inline-block rounded px-1.5 py-0.5 text-[10px] uppercase ${STATUS_COLOR[policy.lastStatus] ?? ""}`}
            >
              {policy.lastStatus}
            </span>
          ) : (
            <span className="text-xs text-muted">never</span>
          )}
        </td>
        <td className="px-2 py-2">
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await runBackupNowAction(policy.id);
                  if (r.ok) toast.success("Backup queued");
                  else toast.error(r.error);
                  await onAfter();
                })
              }
              className="rounded p-1 text-muted hover:bg-[var(--color-surface-muted)] hover:text-fg"
              title="Run now"
            >
              <Play className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  await toggleBackupPolicyAction(policy.id, !policy.enabled);
                  await onAfter();
                })
              }
              className="rounded p-1 text-muted hover:bg-[var(--color-surface-muted)] hover:text-fg"
              title={policy.enabled ? "Disable" : "Enable"}
            >
              {policy.enabled ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  if (!confirm(`Delete policy "${policy.name}"?`)) return;
                  await deleteBackupPolicyAction(policy.id);
                  toast.success("Deleted");
                  await onAfter();
                })
              }
              className="rounded p-1 text-muted hover:bg-red-500/20 hover:text-red-300"
              title="Delete"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </td>
      </tr>
      {open ? (
        <tr className="bg-[var(--color-surface-muted)]/50">
          <td colSpan={8} className="px-4 py-3 text-xs">
            <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-muted">
              <span>retention: <span className="font-mono text-fg">{retention.keepDaily}d / {retention.keepWeekly}w / {retention.keepMonthly}m</span></span>
              <span>enabled: <span className="font-mono text-fg">{policy.enabled ? "yes" : "no"}</span></span>
              {policy.lastError ? <span className="text-red-300">last error: {policy.lastError}</span> : null}
            </div>
            <div className="max-h-72 overflow-auto rounded border border-[var(--color-border)] bg-[var(--color-surface)]">
              <table className="w-full text-xs">
                <thead className="bg-[var(--color-surface-muted)] text-[10px] uppercase text-muted">
                  <tr>
                    <th className="px-2 py-1 text-left">Started</th>
                    <th className="px-2 py-1 text-left">Status</th>
                    <th className="px-2 py-1 text-left">Artifact</th>
                    <th className="px-2 py-1 text-left">Size</th>
                    <th className="px-2 py-1 text-left">Message</th>
                    <th className="px-2 py-1 text-left">Verify</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.length === 0 ? (
                    <tr><td colSpan={6} className="px-2 py-2 text-center text-muted">No jobs yet</td></tr>
                  ) : null}
                  {jobs.map((j) => (
                    <tr key={j.id} className="border-t border-[var(--color-border)]">
                      <td className="px-2 py-1 font-mono">{new Date(j.startedAt).toLocaleString()}</td>
                      <td className="px-2 py-1">
                        <span className={`rounded px-1 py-0.5 text-[10px] ${STATUS_COLOR[j.status] ?? ""}`}>{j.status}</span>
                      </td>
                      <td className="px-2 py-1 font-mono">{j.artifactRef ?? "—"}</td>
                      <td className="px-2 py-1 font-mono">{j.sizeBytes ? formatBytes(j.sizeBytes) : "—"}</td>
                      <td className="px-2 py-1 text-muted">{j.message?.slice(0, 120) ?? ""}</td>
                      <td className="px-2 py-1">
                        <button
                          disabled={j.status !== "ok"}
                          onClick={async () => {
                            const r = await verifyBackupJobAction({ jobId: j.id });
                            if (r.ok) toast.success((("message" in r && r.message) || "Verified"));
                            else toast.error(r.error ?? "Verify failed");
                          }}
                          className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[10px] hover:bg-[var(--color-surface-muted)] disabled:opacity-30"
                        >
                          Verify
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function AddPolicyForm({ instances, onDone }: { instances: InstanceLite[]; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [kind, setKind] = useState<BackupKind>("cloud-snapshot");
  const [form, setForm] = useState({
    name: "",
    instanceId: instances[0]?.id ?? "",
    cronExpr: "0 3 * * *",
    keepDaily: 7,
    keepWeekly: 4,
    keepMonthly: 6,
    s3Uri: "",
    awsAccessKeyId: "",
    awsSecretAccessKey: "",
    awsRegion: "",
    paths: "/var/lib/docker/volumes /etc",
    localDir: "/var/backups",
    targetRegion: "",
  });

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = () => {
    start(async () => {
      const pathsArr = form.paths.split(/\s+/).filter(Boolean);
      const r = await createBackupPolicyAction({
        name: form.name,
        kind,
        instanceId: form.instanceId,
        cronExpr: form.cronExpr,
        retention: {
          keepDaily: form.keepDaily,
          keepWeekly: form.keepWeekly,
          keepMonthly: form.keepMonthly,
        },
        s3:
          kind === "s3-dump"
            ? {
                s3Uri: form.s3Uri,
                awsAccessKeyId: form.awsAccessKeyId,
                awsSecretAccessKey: form.awsSecretAccessKey,
                region: form.awsRegion || undefined,
                paths: pathsArr,
              }
            : undefined,
        local: kind === "local-copy" ? { dir: form.localDir, paths: pathsArr } : undefined,
        crossRegion: kind === "cross-region" ? { targetRegion: form.targetRegion } : undefined,
      });
      if (r.ok) {
        toast.success("Policy added");
        onDone();
      } else {
        toast.error(r.error);
      }
    });
  };

  return (
    <div className="mb-3 grid gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-xs">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Name">
          <input
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="nightly etc backup"
            className={INPUT_CLS}
          />
        </Field>
        <Field label="Kind">
          <select value={kind} onChange={(e) => setKind(e.target.value as BackupKind)} className={INPUT_CLS}>
            <option value="cloud-snapshot">Cloud snapshot (provider API)</option>
            <option value="s3-dump">S3 dump (tar over SSH → s3 cp)</option>
            <option value="local-copy">Local copy (tar to VM path)</option>
            <option value="cross-region">Cross-region snapshot</option>
          </select>
        </Field>
        <Field label="Target instance">
          <select value={form.instanceId} onChange={(e) => set("instanceId", e.target.value)} className={INPUT_CLS}>
            {instances.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name ?? i.providerInstanceId} ({i.provider})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Cron (UTC)">
          <input value={form.cronExpr} onChange={(e) => set("cronExpr", e.target.value)} className={`${INPUT_CLS} font-mono`} />
        </Field>
        <Field label="Retention daily/weekly/monthly">
          <div className="flex gap-1">
            <input
              type="number"
              min={0}
              value={form.keepDaily}
              onChange={(e) => set("keepDaily", Number(e.target.value))}
              className={`${INPUT_CLS} w-16`}
            />
            <input
              type="number"
              min={0}
              value={form.keepWeekly}
              onChange={(e) => set("keepWeekly", Number(e.target.value))}
              className={`${INPUT_CLS} w-16`}
            />
            <input
              type="number"
              min={0}
              value={form.keepMonthly}
              onChange={(e) => set("keepMonthly", Number(e.target.value))}
              className={`${INPUT_CLS} w-16`}
            />
          </div>
        </Field>
      </div>
      {kind === "s3-dump" ? (
        <div className="grid grid-cols-1 gap-2 border-t border-[var(--color-border)] pt-2 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="S3 URI">
            <input
              value={form.s3Uri}
              onChange={(e) => set("s3Uri", e.target.value)}
              placeholder="s3://my-backups/prod/"
              className={INPUT_CLS}
            />
          </Field>
          <Field label="AWS access key id">
            <input value={form.awsAccessKeyId} onChange={(e) => set("awsAccessKeyId", e.target.value)} className={INPUT_CLS} />
          </Field>
          <Field label="AWS secret access key">
            <input
              type="password"
              value={form.awsSecretAccessKey}
              onChange={(e) => set("awsSecretAccessKey", e.target.value)}
              className={INPUT_CLS}
            />
          </Field>
          <Field label="AWS region (optional)">
            <input value={form.awsRegion} onChange={(e) => set("awsRegion", e.target.value)} className={INPUT_CLS} />
          </Field>
          <Field label="Paths to back up (space-separated)">
            <input value={form.paths} onChange={(e) => set("paths", e.target.value)} className={`${INPUT_CLS} font-mono`} />
          </Field>
        </div>
      ) : null}
      {kind === "local-copy" ? (
        <div className="grid grid-cols-1 gap-2 border-t border-[var(--color-border)] pt-2 sm:grid-cols-2">
          <Field label="Destination dir on VM">
            <input value={form.localDir} onChange={(e) => set("localDir", e.target.value)} className={`${INPUT_CLS} font-mono`} />
          </Field>
          <Field label="Paths to back up (space-separated)">
            <input value={form.paths} onChange={(e) => set("paths", e.target.value)} className={`${INPUT_CLS} font-mono`} />
          </Field>
        </div>
      ) : null}
      {kind === "cross-region" ? (
        <div className="grid grid-cols-1 gap-2 border-t border-[var(--color-border)] pt-2 sm:grid-cols-2">
          <Field label="Target region">
            <input
              value={form.targetRegion}
              onChange={(e) => set("targetRegion", e.target.value)}
              placeholder="us-west-2"
              className={INPUT_CLS}
            />
          </Field>
        </div>
      ) : null}
      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onDone}
          className="rounded-md border border-[var(--color-border)] px-3 py-1 hover:bg-[var(--color-surface-muted)]"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={pending || !form.name || !form.instanceId}
          onClick={submit}
          className="rounded-md bg-[var(--color-primary)] px-3 py-1 font-semibold text-[var(--color-primary-fg)] disabled:opacity-50"
        >
          {pending ? "Adding…" : "Add policy"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1">
      <span className="text-[10px] uppercase tracking-wide text-muted">{label}</span>
      {children}
    </label>
  );
}

const INPUT_CLS =
  "rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1";
