"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { KeyRound, RotateCw, CheckCircle2, AlertTriangle } from "lucide-react";
import { rotateSshKeyAction } from "@/server/actions/ssh-rotate";

interface Props {
  keys: { id: string; name: string; algo: string; fingerprint: string | null }[];
  instances: { id: string; name: string; region: string; publicIp: string | null; accountLabel: string }[];
}

export function KeyRotationView({ keys, instances }: Props) {
  const [keyId, setKeyId] = useState(keys[0]?.id ?? "");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [user, setUser] = useState("root");
  const [pending, start] = useTransition();
  const [last, setLast] = useState<{ rotated: string[]; failed: { instanceId: string; error: string }[] } | null>(null);

  const toggle = (id: string) => {
    const s = new Set(selected);
    if (s.has(id)) s.delete(id); else s.add(id);
    setSelected(s);
  };

  const submit = () => {
    if (!keyId || selected.size === 0) return;
    start(async () => {
      try {
        const res = await rotateSshKeyAction({ newKeyId: keyId, instanceIds: Array.from(selected), user });
        setLast(res);
        if (res.ok) toast.success(`Rotated ${res.rotated.length} VM(s)`);
        else toast.error(`Rotated ${res.rotated.length}, failed ${res.failed.length}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Rotation failed");
      }
    });
  };

  return (
    <div className="grid gap-4">
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-xs text-muted">New key
            <select value={keyId} onChange={(e) => setKeyId(e.target.value)} className="ml-2 rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1 text-sm">
              {keys.map((k) => <option key={k.id} value={k.id}>{k.name} · {k.algo}</option>)}
            </select>
          </label>
          <label className="text-xs text-muted">SSH user
            <input value={user} onChange={(e) => setUser(e.target.value)} className="ml-2 w-24 rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1 text-sm" />
          </label>
          <button disabled={pending || !keyId || selected.size === 0} onClick={submit} className="ml-auto inline-flex items-center gap-2 rounded bg-[var(--color-primary)] px-3 py-1.5 text-sm text-white disabled:opacity-40">
            <RotateCw className={`h-3.5 w-3.5 ${pending ? "animate-spin" : ""}`} />
            Rotate on {selected.size} VM(s)
          </button>
        </div>
      </div>

      <table className="w-full text-sm">
        <thead className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-muted">
          <tr><th className="px-2 py-2"><input type="checkbox" onChange={(e) => setSelected(e.target.checked ? new Set(instances.map((i) => i.id)) : new Set())} /></th><th>Name</th><th>Account</th><th>Region</th><th>IP</th><th>Last</th></tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-border)]">
          {instances.map((i) => {
            const r = last?.rotated.includes(i.id);
            const f = last?.failed.find((x) => x.instanceId === i.id);
            return (
              <tr key={i.id}>
                <td className="px-2 py-2"><input type="checkbox" checked={selected.has(i.id)} onChange={() => toggle(i.id)} disabled={!i.publicIp} /></td>
                <td>{i.name}</td>
                <td className="text-xs text-muted">{i.accountLabel}</td>
                <td className="font-mono text-xs">{i.region}</td>
                <td className="font-mono text-xs">{i.publicIp ?? <span className="text-muted">no public IP</span>}</td>
                <td className="text-xs">
                  {r && <span className="inline-flex items-center gap-1 text-emerald-300"><CheckCircle2 className="h-3 w-3" /> ok</span>}
                  {f && <span title={f.error} className="inline-flex items-center gap-1 text-rose-300"><AlertTriangle className="h-3 w-3" /> {f.error.slice(0, 40)}</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className="flex items-start gap-2 text-xs text-muted">
        <KeyRound className="mt-0.5 h-3 w-3" />
        Existing keys with comment <code className="rounded bg-[var(--color-surface-muted)] px-1">"# vmui-managed"</code> are removed first. Other authorized_keys lines are preserved. Old file is backed up to <code className="rounded bg-[var(--color-surface-muted)] px-1">~/.ssh/authorized_keys.vmui.bak.&lt;ts&gt;</code>.
      </p>
    </div>
  );
}
