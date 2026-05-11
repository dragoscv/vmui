"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Download, Network, Copy } from "lucide-react";
import { generateWgMeshAction, generateTailscaleCommandAction } from "@/server/actions/mesh";

interface InstanceLite {
  id: string;
  name: string | null;
  providerInstanceId: string;
  provider: string;
  publicIp: string | null;
  privateIp: string | null;
}

const INPUT_CLS = "rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1";

export function MeshWorkspace({ instances }: { instances: InstanceLite[] }) {
  const [tab, setTab] = useState<"wireguard" | "tailscale">("wireguard");

  return (
    <div className="grid gap-4">
      <div className="flex gap-2 text-xs">
        <button
          type="button"
          onClick={() => setTab("wireguard")}
          className={`rounded-md px-3 py-1 ${tab === "wireguard" ? "bg-[var(--color-primary)] text-[var(--color-primary-fg)]" : "border border-[var(--color-border)] bg-[var(--color-surface)]"}`}
        >
          WireGuard mesh
        </button>
        <button
          type="button"
          onClick={() => setTab("tailscale")}
          className={`rounded-md px-3 py-1 ${tab === "tailscale" ? "bg-[var(--color-primary)] text-[var(--color-primary-fg)]" : "border border-[var(--color-border)] bg-[var(--color-surface)]"}`}
        >
          Tailscale
        </button>
      </div>
      {tab === "wireguard" ? <WireguardTab instances={instances} /> : <TailscaleTab instances={instances} />}
    </div>
  );
}

function WireguardTab({ instances }: { instances: InstanceLite[] }) {
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [subnet, setSubnet] = useState("10.66.0.0/24");
  const [configs, setConfigs] = useState<Record<string, string>>({});

  const toggle = (id: string) => {
    const s = new Set(selected);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    setSelected(s);
  };

  return (
    <div className="grid gap-3">
      <label className="grid w-full max-w-xs gap-1 text-xs">
        <span className="text-[10px] uppercase tracking-wide text-muted">VPN subnet</span>
        <input value={subnet} onChange={(e) => setSubnet(e.target.value)} className={`${INPUT_CLS} font-mono`} />
      </label>
      <div className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--color-surface-muted)] text-xs uppercase text-muted">
            <tr>
              <th className="w-8 px-2 py-2"></th>
              <th className="px-2 py-2 text-left">Name</th>
              <th className="px-2 py-2 text-left">Public IP</th>
              <th className="px-2 py-2 text-left">Private IP</th>
            </tr>
          </thead>
          <tbody>
            {instances.map((i) => (
              <tr key={i.id} className="border-t border-[var(--color-border)]">
                <td className="px-2 py-2">
                  <input type="checkbox" checked={selected.has(i.id)} onChange={() => toggle(i.id)} />
                </td>
                <td className="px-2 py-2 font-medium">{i.name ?? i.providerInstanceId}</td>
                <td className="px-2 py-2 font-mono text-xs">{i.publicIp ?? "—"}</td>
                <td className="px-2 py-2 font-mono text-xs">{i.privateIp ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        disabled={pending || selected.size < 2}
        onClick={() =>
          start(async () => {
            const peers = instances
              .filter((i) => selected.has(i.id))
              .map((i) => ({
                name: i.name?.replace(/\s+/g, "-") ?? i.providerInstanceId,
                ip: i.privateIp ?? i.publicIp ?? "",
                publicIp: i.publicIp,
                listenPort: 51820,
              }));
            const r = await generateWgMeshAction({ subnet, peers });
            if (r.ok) {
              setConfigs(r.configs);
              toast.success(`Generated ${Object.keys(r.configs).length} wg0.conf files`);
            } else toast.error(r.error);
          })
        }
        className="inline-flex w-fit items-center gap-1 rounded-md bg-[var(--color-primary)] px-3 py-1 text-xs font-semibold text-[var(--color-primary-fg)] disabled:opacity-40"
      >
        <Network className="h-3 w-3" /> Generate mesh
      </button>
      {Object.keys(configs).length > 0 ? (
        <div className="grid gap-2">
          {Object.entries(configs).map(([name, body]) => (
            <details key={name} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-xs">
              <summary className="flex cursor-pointer items-center gap-2 font-mono">
                {name} / wg0.conf
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    void navigator.clipboard.writeText(body);
                    toast.success("Copied");
                  }}
                  className="ml-auto inline-flex items-center gap-1 rounded border border-[var(--color-border)] px-2 py-0.5 text-[10px]"
                >
                  <Copy className="h-3 w-3" /> Copy
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    const blob = new Blob([body], { type: "text/plain" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `${name}.wg0.conf`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="inline-flex items-center gap-1 rounded border border-[var(--color-border)] px-2 py-0.5 text-[10px]"
                >
                  <Download className="h-3 w-3" /> Download
                </button>
              </summary>
              <pre className="mt-2 overflow-auto font-mono text-xs">{body}</pre>
            </details>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TailscaleTab({ instances }: { instances: InstanceLite[] }) {
  const [pending, start] = useTransition();
  const [form, setForm] = useState({
    authKey: "",
    hostname: "",
    tags: "tag:server",
    ssh: true,
    advertiseRoutes: "",
  });
  const [out, setOut] = useState<{ install: string; up: string } | null>(null);

  return (
    <div className="grid gap-3 text-xs">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <label className="grid gap-1">
          <span className="text-[10px] uppercase tracking-wide text-muted">Auth key</span>
          <input
            type="password"
            value={form.authKey}
            onChange={(e) => setForm({ ...form, authKey: e.target.value })}
            className={`${INPUT_CLS} font-mono`}
            placeholder="tskey-auth-…"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-[10px] uppercase tracking-wide text-muted">Hostname (optional)</span>
          <input value={form.hostname} onChange={(e) => setForm({ ...form, hostname: e.target.value })} className={INPUT_CLS} />
        </label>
        <label className="grid gap-1">
          <span className="text-[10px] uppercase tracking-wide text-muted">Tags (comma)</span>
          <input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} className={INPUT_CLS} />
        </label>
        <label className="grid gap-1">
          <span className="text-[10px] uppercase tracking-wide text-muted">Advertise routes (comma)</span>
          <input value={form.advertiseRoutes} onChange={(e) => setForm({ ...form, advertiseRoutes: e.target.value })} className={INPUT_CLS} placeholder="10.0.0.0/16" />
        </label>
        <label className="flex items-end gap-2">
          <input type="checkbox" checked={form.ssh} onChange={(e) => setForm({ ...form, ssh: e.target.checked })} />
          <span>Enable Tailscale SSH</span>
        </label>
      </div>
      <button
        type="button"
        disabled={pending || !form.authKey}
        onClick={() =>
          start(async () => {
            const r = await generateTailscaleCommandAction({
              authKey: form.authKey,
              hostname: form.hostname || undefined,
              tags: form.tags ? form.tags.split(",").map((t) => t.trim()).filter(Boolean) : undefined,
              ssh: form.ssh,
              advertiseRoutes: form.advertiseRoutes ? form.advertiseRoutes.split(",").map((r) => r.trim()).filter(Boolean) : undefined,
            });
            if (r.ok) setOut({ install: r.install, up: r.up });
            else toast.error(r.error);
          })
        }
        className="w-fit rounded-md bg-[var(--color-primary)] px-3 py-1 text-xs font-semibold text-[var(--color-primary-fg)] disabled:opacity-40"
      >
        Generate
      </button>
      {out ? (
        <pre className="overflow-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 font-mono">
          {`# Install Tailscale\n${out.install}\n\n# Connect\n${out.up}`}
        </pre>
      ) : null}
      <p className="text-[11px] text-muted">
        Run these commands on the {instances.length} reachable VM{instances.length === 1 ? "" : "s"} via the built-in terminal.
      </p>
    </div>
  );
}
