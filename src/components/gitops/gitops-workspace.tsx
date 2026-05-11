"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Loader2,
  Plus,
  Trash2,
  RefreshCw,
  Play,
  Pause,
  GitBranch,
  ChevronDown,
  ChevronRight,
  History as HistoryIcon,
} from "lucide-react";
import {
  createGitSourceAction,
  deleteGitSourceAction,
  toggleGitSourceAction,
  syncGitSourceNowAction,
  listGitSourcesAction,
  listGitHistoryAction,
} from "@/server/actions/gitops";

interface GitSourceLite {
  id: string;
  name: string;
  url: string;
  branch: string;
  authType: "none" | "token" | "ssh";
  composeGlob: string;
  targetInstanceId: string | null;
  pollSeconds: number;
  enabled: boolean;
  lastCommit: string | null;
  lastSyncedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
}

interface HistoryRow {
  id: string;
  sourceId: string;
  commit: string;
  path: string;
  status: "success" | "failed" | "skipped";
  message: string | null;
  createdAt: Date;
}

interface InstanceLite {
  id: string;
  name: string | null;
  providerInstanceId: string;
  provider: string;
}

const STATUS_COLOR: Record<string, string> = {
  success: "bg-emerald-500/20 text-emerald-200",
  failed: "bg-red-500/20 text-red-200",
  skipped: "bg-slate-500/20 text-slate-200",
};

export function GitopsWorkspace({ instances }: { instances: InstanceLite[] }) {
  const [sources, setSources] = useState<GitSourceLite[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const refresh = async () => {
    const [s, h] = await Promise.all([listGitSourcesAction(), listGitHistoryAction({})]);
    if (s.ok) setSources(s.rows as GitSourceLite[]);
    if (h.ok) setHistory(h.rows as HistoryRow[]);
  };

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="grid gap-6">
      <section>
        <header className="mb-2 flex items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Git sources</h2>
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
            <Plus className="h-3 w-3" /> Add source
          </button>
        </header>
        {showAdd && <AddForm instances={instances} onSaved={() => { setShowAdd(false); void refresh(); }} />}
        <div className="overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]">
          <table className="w-full text-xs">
            <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] text-[10px] uppercase tracking-wide text-muted">
              <tr>
                <th className="w-6"></th>
                <th className="px-3 py-1.5 text-left">Name</th>
                <th className="px-3 py-1.5 text-left">URL @ branch</th>
                <th className="px-3 py-1.5 text-left">Last sync</th>
                <th className="px-3 py-1.5 text-left">Commit</th>
                <th className="px-3 py-1.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sources.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-center text-muted">
                    No git sources yet.
                  </td>
                </tr>
              )}
              {sources.map((s) => (
                <SourceRow
                  key={s.id}
                  src={s}
                  expanded={expanded === s.id}
                  history={history.filter((h) => h.sourceId === s.id)}
                  onToggle={() => setExpanded(expanded === s.id ? null : s.id)}
                  onRefresh={refresh}
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function SourceRow({
  src,
  expanded,
  history,
  onToggle,
  onRefresh,
}: {
  src: GitSourceLite;
  expanded: boolean;
  history: HistoryRow[];
  onToggle: () => void;
  onRefresh: () => void | Promise<void>;
}) {
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<unknown>) =>
    start(async () => {
      await fn();
      await onRefresh();
    });
  return (
    <>
      <tr className="border-b border-[var(--color-border)] last:border-b-0 hover:bg-[var(--color-surface-muted)]/40">
        <td className="cursor-pointer px-2 py-1.5 text-center text-muted" onClick={onToggle}>
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </td>
        <td className="px-3 py-1.5 font-semibold">
          <div className="flex items-center gap-1">
            <GitBranch className="h-3 w-3 opacity-60" />
            {src.name}
          </div>
        </td>
        <td className="px-3 py-1.5 font-mono text-[11px] text-muted">{src.url}@{src.branch}</td>
        <td className="px-3 py-1.5 text-[10px] text-muted">
          {src.lastSyncedAt ? new Date(src.lastSyncedAt).toLocaleString() : "never"}
          {src.lastError && <span className="ml-1 text-red-300" title={src.lastError}>· err</span>}
        </td>
        <td className="px-3 py-1.5 font-mono text-[10px] text-muted">{src.lastCommit?.slice(0, 8) ?? "—"}</td>
        <td className="px-3 py-1.5 text-right">
          <div className="inline-flex gap-1">
            <button
              type="button"
              onClick={() => act(() => syncGitSourceNowAction({ id: src.id }))}
              disabled={pending}
              title="Sync now"
              className="rounded border border-[var(--color-border)] p-1 hover:bg-[var(--color-surface-muted)] disabled:opacity-50"
            >
              {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            </button>
            <button
              type="button"
              onClick={() => act(() => toggleGitSourceAction({ id: src.id, enabled: !src.enabled }))}
              title={src.enabled ? "Pause" : "Resume"}
              className="rounded border border-[var(--color-border)] p-1 hover:bg-[var(--color-surface-muted)]"
            >
              {src.enabled ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
            </button>
            <button
              type="button"
              onClick={() => {
                if (window.confirm("Delete source and its local cache?")) {
                  act(async () => {
                    const r = await deleteGitSourceAction({ id: src.id });
                    if (r.ok) toast.success("Deleted");
                  });
                }
              }}
              className="rounded border border-red-500/30 p-1 text-red-300 hover:bg-red-500/10"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-[var(--color-border)] bg-black/30">
          <td colSpan={6} className="px-4 py-2">
            <div className="mb-2 flex items-center gap-2 text-[10px] text-muted">
              <HistoryIcon className="h-3 w-3" />
              <span>Apply history</span>
            </div>
            {history.length === 0 ? (
              <p className="text-[10px] text-muted">No applies yet.</p>
            ) : (
              <ul className="space-y-1 text-[11px]">
                {history.slice(0, 10).map((h) => (
                  <li key={h.id} className="flex items-center gap-2">
                    <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase ${STATUS_COLOR[h.status]}`}>
                      {h.status}
                    </span>
                    <span className="font-mono text-muted">{h.commit.slice(0, 8)}</span>
                    <span className="font-mono">{h.path}</span>
                    <span className="ml-auto text-[10px] text-muted">{new Date(h.createdAt).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function AddForm({ instances, onSaved }: { instances: InstanceLite[]; onSaved: () => void }) {
  const [authType, setAuthType] = useState<"none" | "token" | "ssh">("none");
  const [pending, start] = useTransition();
  const [form, setForm] = useState({
    name: "",
    url: "",
    branch: "main",
    token: "",
    sshKey: "",
    username: "",
    composeGlob: "**/docker-compose.y*ml",
    targetInstanceId: instances[0]?.id ?? "",
    pollSeconds: 60,
  });
  const setField = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const v = e.target.value;
    setForm((s) => ({ ...s, [k]: k === "pollSeconds" ? Number(v) : v }));
  };
  const submit = () =>
    start(async () => {
      const res = await createGitSourceAction({ ...form, authType });
      if (res.ok) {
        toast.success("Source added — first sync will run within 30s");
        onSaved();
      } else {
        toast.error("Failed");
      }
    });
  return (
    <div className="mb-2 grid gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-xs">
      <div className="flex flex-wrap gap-2">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-[10px] uppercase text-muted">Name</span>
          <input value={form.name} onChange={setField("name")} className="rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1" />
        </label>
        <label className="flex flex-[2] flex-col gap-1">
          <span className="text-[10px] uppercase text-muted">URL</span>
          <input value={form.url} onChange={setField("url")} placeholder="https://github.com/me/stacks.git" className="rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1 font-mono" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-muted">Branch</span>
          <input value={form.branch} onChange={setField("branch")} className="rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1 font-mono" />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-muted">Auth</span>
          <select value={authType} onChange={(e) => setAuthType(e.target.value as typeof authType)} className="rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1">
            <option value="none">none (public)</option>
            <option value="token">HTTPS token</option>
            <option value="ssh">SSH key</option>
          </select>
        </label>
        {authType === "token" && (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase text-muted">Username (optional)</span>
              <input value={form.username} onChange={setField("username")} className="rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1 font-mono" />
            </label>
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-[10px] uppercase text-muted">Token / PAT</span>
              <input type="password" value={form.token} onChange={setField("token")} className="rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1 font-mono" />
            </label>
          </>
        )}
      </div>
      {authType === "ssh" && (
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-muted">Private SSH key (OpenSSH format)</span>
          <textarea value={form.sshKey} onChange={setField("sshKey")} rows={6} className="rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1 font-mono text-[10px]" />
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-[10px] uppercase text-muted">Compose glob</span>
          <input value={form.composeGlob} onChange={setField("composeGlob")} className="rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1 font-mono" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-muted">Target instance</span>
          <select value={form.targetInstanceId} onChange={(e) => setForm((s) => ({ ...s, targetInstanceId: e.target.value }))} className="rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1">
            <option value="">— (none, just track)</option>
            {instances.map((i) => (
              <option key={i.id} value={i.id}>{i.name ?? i.providerInstanceId} · {i.provider}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-muted">Poll seconds</span>
          <input type="number" min={15} max={86400} value={form.pollSeconds} onChange={setField("pollSeconds")} className="w-24 rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1 font-mono" />
        </label>
      </div>
      <div className="flex justify-end">
        <button type="button" onClick={submit} disabled={pending || !form.name || !form.url} className="inline-flex items-center gap-1 rounded-md bg-[var(--color-primary)] px-2.5 py-1 text-xs font-semibold text-[var(--color-primary-fg)] disabled:opacity-50">
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Save source
        </button>
      </div>
    </div>
  );
}
