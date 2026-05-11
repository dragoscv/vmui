"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  RefreshCw,
  Eye,
  EyeOff,
  RotateCw,
  Send,
  Download,
  KeyRound,
  Database,
  Lock,
  Sparkles,
} from "lucide-react";
import {
  createSecretAction,
  deleteSecretAction,
  revealSecretAction,
  rotateSecretAction,
  pushSecretToInstanceAction,
  exportSealedSecretAction,
  listSecretsAction,
} from "@/server/actions/secrets";

type Kind = "db" | "api-key" | "password" | "generic";

interface SecretRow {
  id: string;
  name: string;
  kind: Kind;
  rotationDays: number | null;
  lastRotatedAt: Date | null;
  sealed: boolean;
  createdAt: Date;
}

interface InstanceLite {
  id: string;
  name: string | null;
  providerInstanceId: string;
  provider: string;
}

const KIND_ICON: Record<Kind, typeof KeyRound> = {
  db: Database,
  "api-key": KeyRound,
  password: Lock,
  generic: Sparkles,
};

const INPUT_CLS =
  "rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1";

export function SecretsWorkspace({ instances }: { instances: InstanceLite[] }) {
  const [rows, setRows] = useState<SecretRow[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, string | null>>({});

  const refresh = async () => {
    const r = (await listSecretsAction()) as SecretRow[];
    setRows(r);
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
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Secrets</h2>
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
            <Plus className="h-3 w-3" /> Add secret
          </button>
        </header>
        {showAdd ? (
          <AddSecretForm
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
                <th className="px-2 py-2 text-left">Name</th>
                <th className="px-2 py-2 text-left">Kind</th>
                <th className="px-2 py-2 text-left">Value</th>
                <th className="px-2 py-2 text-left">Rotation</th>
                <th className="px-2 py-2 text-left">Last rotated</th>
                <th className="w-44 px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-center text-xs text-muted">
                    No secrets yet.
                  </td>
                </tr>
              ) : null}
              {rows.map((s) => (
                <SecretRowView
                  key={s.id}
                  row={s}
                  revealed={revealed[s.id] ?? null}
                  instances={instances}
                  onReveal={(v) => setRevealed((p) => ({ ...p, [s.id]: v }))}
                  onAfter={refresh}
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function SecretRowView({
  row,
  revealed,
  instances,
  onReveal,
  onAfter,
}: {
  row: SecretRow;
  revealed: string | null;
  instances: InstanceLite[];
  onReveal: (v: string | null) => void;
  onAfter: () => Promise<void>;
}) {
  const Icon = KIND_ICON[row.kind];
  const [pending, start] = useTransition();
  const [pushing, setPushing] = useState(false);

  return (
    <>
      <tr className="border-t border-[var(--color-border)]">
        <td className="px-2 py-2 font-medium">{row.name}</td>
        <td className="px-2 py-2">
          <span className="inline-flex items-center gap-1 text-xs">
            <Icon className="h-3 w-3" /> {row.kind}
          </span>
        </td>
        <td className="px-2 py-2 font-mono text-xs">
          {revealed ? (
            <span className="break-all">{revealed}</span>
          ) : (
            <span className="text-muted">••••••••</span>
          )}
        </td>
        <td className="px-2 py-2 text-xs">{row.rotationDays ? `${row.rotationDays}d` : "—"}</td>
        <td className="px-2 py-2 text-xs">
          {row.lastRotatedAt ? new Date(row.lastRotatedAt).toLocaleString() : "—"}
        </td>
        <td className="px-2 py-2">
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  if (revealed) {
                    onReveal(null);
                    return;
                  }
                  const r = await revealSecretAction(row.id);
                  if (r.ok) onReveal(r.value);
                  else toast.error(r.error);
                })
              }
              className="rounded p-1 text-muted hover:bg-[var(--color-surface-muted)] hover:text-fg"
              title={revealed ? "Hide" : "Reveal"}
            >
              {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  if (!confirm(`Rotate "${row.name}"? Existing value will be replaced.`)) return;
                  const r = await rotateSecretAction(row.id);
                  if (r.ok) {
                    onReveal(r.value);
                    toast.success("Rotated — new value revealed once");
                  } else toast.error(r.error);
                  await onAfter();
                })
              }
              className="rounded p-1 text-muted hover:bg-[var(--color-surface-muted)] hover:text-fg"
              title="Rotate"
            >
              <RotateCw className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setPushing((p) => !p)}
              className="rounded p-1 text-muted hover:bg-[var(--color-surface-muted)] hover:text-fg"
              title="Push to VM"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const pass = prompt("Passphrase to seal export (≥ 8 chars):");
                  if (!pass) return;
                  const r = await exportSealedSecretAction(row.id, pass);
                  if (!r.ok) {
                    toast.error(r.error);
                    return;
                  }
                  const blob = new Blob([r.body], { type: "application/json" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = r.filename;
                  a.click();
                  URL.revokeObjectURL(url);
                  toast.success("Exported");
                })
              }
              className="rounded p-1 text-muted hover:bg-[var(--color-surface-muted)] hover:text-fg"
              title="Export sealed"
            >
              <Download className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  if (!confirm(`Delete "${row.name}"?`)) return;
                  await deleteSecretAction(row.id);
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
      {pushing ? (
        <PushRow
          secretId={row.id}
          instances={instances}
          onClose={() => setPushing(false)}
        />
      ) : null}
    </>
  );
}

function PushRow({
  secretId,
  instances,
  onClose,
}: {
  secretId: string;
  instances: InstanceLite[];
  onClose: () => void;
}) {
  const [pending, start] = useTransition();
  const [instanceId, setInstanceId] = useState(instances[0]?.id ?? "");
  const [envPath, setEnvPath] = useState("/etc/vmui/secrets.env");
  return (
    <tr className="bg-[var(--color-surface-muted)]/50">
      <td colSpan={6} className="px-4 py-2 text-xs">
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-0.5">
            <span className="text-[10px] uppercase text-muted">Instance</span>
            <select value={instanceId} onChange={(e) => setInstanceId(e.target.value)} className={INPUT_CLS}>
              {instances.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name ?? i.providerInstanceId} ({i.provider})
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-0.5">
            <span className="text-[10px] uppercase text-muted">Env file path</span>
            <input value={envPath} onChange={(e) => setEnvPath(e.target.value)} className={`${INPUT_CLS} font-mono`} />
          </label>
          <button
            type="button"
            disabled={pending || !instanceId}
            onClick={() =>
              start(async () => {
                const r = await pushSecretToInstanceAction(secretId, instanceId, envPath);
                if (r.ok) {
                  toast.success("Pushed");
                  onClose();
                } else toast.error(r.error);
              })
            }
            className="rounded-md bg-[var(--color-primary)] px-3 py-1 text-xs font-semibold text-[var(--color-primary-fg)] disabled:opacity-50"
          >
            {pending ? "Pushing…" : "Push"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[var(--color-border)] px-2 py-1 text-xs"
          >
            Cancel
          </button>
        </div>
      </td>
    </tr>
  );
}

function AddSecretForm({ onDone }: { onDone: () => void }) {
  const [pending, start] = useTransition();
  const [form, setForm] = useState({
    name: "",
    kind: "generic" as Kind,
    value: "",
    rotationDays: 90,
    sealed: false,
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="mb-3 grid gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-xs">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Name (KEY-style)">
          <input value={form.name} onChange={(e) => set("name", e.target.value)} className={`${INPUT_CLS} font-mono`} />
        </Field>
        <Field label="Kind">
          <select value={form.kind} onChange={(e) => set("kind", e.target.value as Kind)} className={INPUT_CLS}>
            <option value="generic">Generic</option>
            <option value="db">Database password</option>
            <option value="api-key">API key</option>
            <option value="password">Password</option>
          </select>
        </Field>
        <Field label="Rotation reminder (days)">
          <input
            type="number"
            min={0}
            value={form.rotationDays}
            onChange={(e) => set("rotationDays", Number(e.target.value))}
            className={INPUT_CLS}
          />
        </Field>
        <Field label="Value">
          <input
            type="password"
            value={form.value}
            onChange={(e) => set("value", e.target.value)}
            className={`${INPUT_CLS} font-mono`}
          />
        </Field>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={form.sealed} onChange={(e) => set("sealed", e.target.checked)} />
          <span>Sealed (require re-auth to reveal)</span>
        </label>
      </div>
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
          disabled={pending || !form.name || !form.value}
          onClick={() =>
            start(async () => {
              const r = await createSecretAction({
                name: form.name,
                kind: form.kind,
                value: form.value,
                rotationDays: form.rotationDays || undefined,
                sealed: form.sealed,
              });
              if (r.ok) {
                toast.success("Secret stored");
                onDone();
              } else toast.error(r.error);
            })
          }
          className="rounded-md bg-[var(--color-primary)] px-3 py-1 font-semibold text-[var(--color-primary-fg)] disabled:opacity-50"
        >
          {pending ? "Adding…" : "Add"}
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
