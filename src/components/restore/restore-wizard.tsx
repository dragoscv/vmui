"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { RotateCcw, Loader2 } from "lucide-react";
import {
  restoreFromBackupAction,
  listSuccessfulBackupJobsAction,
  listAccountRegionsForRestoreAction,
} from "@/server/actions/restore";

const INPUT_CLS = "rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1";

interface Job {
  id: string;
  startedAt: Date;
  artifactRef: string | null;
  sizeBytes: number | null;
  policyName: string;
  kind: string | null;
  instanceId: string | null;
}

interface Account {
  id: string;
  name: string;
  provider: string;
  defaultRegion: string | null;
  regions: string[];
}

export function RestoreWizard() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [form, setForm] = useState({
    backupJobId: "",
    accountId: "",
    region: "",
    name: "restored-vm",
    instanceType: "t3.small",
    template: "ubuntu-22.04",
  });
  const [pending, start] = useTransition();

  useEffect(() => {
    void (async () => {
      const [j, a] = await Promise.all([listSuccessfulBackupJobsAction(), listAccountRegionsForRestoreAction()]);
      setJobs(j as Job[]);
      setAccounts(a as Account[]);
    })();
  }, []);

  const acc = useMemo(() => accounts.find((a) => a.id === form.accountId), [accounts, form.accountId]);
  const isSnapshotKind = useMemo(() => {
    const j = jobs.find((x) => x.id === form.backupJobId);
    return j?.kind === "cloud-snapshot" || j?.kind === "cross-region";
  }, [jobs, form.backupJobId]);

  return (
    <div className="grid gap-4 text-xs">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Backup job (most recent first)">
          <select value={form.backupJobId} onChange={(e) => setForm({ ...form, backupJobId: e.target.value })} className={INPUT_CLS}>
            <option value="">— select —</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {new Date(j.startedAt).toLocaleString()} · {j.policyName} · {j.artifactRef ?? "?"}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Target cloud account">
          <select value={form.accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })} className={INPUT_CLS}>
            <option value="">— select —</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name} ({a.provider})</option>
            ))}
          </select>
        </Field>
        <Field label="Region">
          <input value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} className={INPUT_CLS} list="regions-list" />
          <datalist id="regions-list">
            {(acc?.regions ?? []).map((r) => <option key={r} value={r} />)}
          </datalist>
        </Field>
        <Field label="New VM name"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={INPUT_CLS} /></Field>
        <Field label="Instance type"><input value={form.instanceType} onChange={(e) => setForm({ ...form, instanceType: e.target.value })} className={`${INPUT_CLS} font-mono`} /></Field>
        <Field label="Fallback template (if provider can't boot from snapshot)">
          <input value={form.template} onChange={(e) => setForm({ ...form, template: e.target.value })} className={INPUT_CLS} />
        </Field>
      </div>
      {!isSnapshotKind && form.backupJobId ? (
        <p className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-amber-200">
          This backup is a {jobs.find((x) => x.id === form.backupJobId)?.kind ?? "file"} archive — provider can't boot directly from it. Use the template above to launch a new VM, then restore the tarball over SSH.
        </p>
      ) : null}
      <button
        type="button"
        disabled={pending || !form.backupJobId || !form.accountId || !form.region}
        onClick={() =>
          start(async () => {
            const r = await restoreFromBackupAction(form);
            if (r.ok) toast.success(`Launching: ${r.providerInstanceId}`);
            else toast.error(r.error);
          })
        }
        className="inline-flex w-fit items-center gap-1 rounded-md bg-[var(--color-primary)] px-3 py-1 font-semibold text-[var(--color-primary-fg)] disabled:opacity-40"
      >
        {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
        Restore
      </button>
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
