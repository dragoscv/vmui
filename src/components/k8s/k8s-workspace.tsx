"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Terminal, Download, Ship, Loader2 } from "lucide-react";
import { installK8sAction, kubectlAction, helmInstallAction } from "@/server/actions/k8s";

interface InstanceLite {
  id: string;
  name: string | null;
  providerInstanceId: string;
  provider: string;
}

const INPUT_CLS = "rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1";

export function K8sWorkspace({ instances }: { instances: InstanceLite[] }) {
  const [tab, setTab] = useState<"install" | "kubectl" | "helm">("install");

  return (
    <div className="grid gap-4">
      <div className="flex gap-2 text-xs">
        {(["install", "kubectl", "helm"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-md px-3 py-1 ${tab === t ? "bg-[var(--color-primary)] text-[var(--color-primary-fg)]" : "border border-[var(--color-border)] bg-[var(--color-surface)]"}`}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "install" ? <InstallTab instances={instances} /> : null}
      {tab === "kubectl" ? <KubectlTab instances={instances} /> : null}
      {tab === "helm" ? <HelmTab instances={instances} /> : null}
    </div>
  );
}

function InstallTab({ instances }: { instances: InstanceLite[] }) {
  const [pending, start] = useTransition();
  const [form, setForm] = useState({
    instanceId: instances[0]?.id ?? "",
    flavor: "k3s" as "k3s" | "k0s",
    role: "server" as "server" | "agent",
    serverUrl: "",
    token: "",
  });
  const [result, setResult] = useState<{ joinToken?: string; kubeconfig?: string } | null>(null);

  return (
    <div className="grid gap-3 text-xs">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <label className="grid gap-1">
          <span className="text-[10px] uppercase text-muted">Instance</span>
          <select value={form.instanceId} onChange={(e) => setForm({ ...form, instanceId: e.target.value })} className={INPUT_CLS}>
            {instances.map((i) => (
              <option key={i.id} value={i.id}>{i.name ?? i.providerInstanceId} ({i.provider})</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-[10px] uppercase text-muted">Flavor</span>
          <select value={form.flavor} onChange={(e) => setForm({ ...form, flavor: e.target.value as "k3s" | "k0s" })} className={INPUT_CLS}>
            <option value="k3s">k3s</option>
            <option value="k0s">k0s</option>
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-[10px] uppercase text-muted">Role</span>
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as "server" | "agent" })} className={INPUT_CLS}>
            <option value="server">Server (single / control plane)</option>
            <option value="agent">Agent (worker)</option>
          </select>
        </label>
        {form.role === "agent" ? (
          <>
            <label className="grid gap-1">
              <span className="text-[10px] uppercase text-muted">Server URL (k3s only)</span>
              <input value={form.serverUrl} onChange={(e) => setForm({ ...form, serverUrl: e.target.value })} className={INPUT_CLS} placeholder="https://10.0.0.5:6443" />
            </label>
            <label className="grid gap-1 sm:col-span-2">
              <span className="text-[10px] uppercase text-muted">Join token</span>
              <input value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} className={`${INPUT_CLS} font-mono`} />
            </label>
          </>
        ) : null}
      </div>
      <button
        type="button"
        disabled={pending || !form.instanceId}
        onClick={() =>
          start(async () => {
            const r = await installK8sAction(form);
            if (r.ok) {
              setResult({ joinToken: r.joinToken, kubeconfig: r.kubeconfig });
              toast.success("Cluster installed");
            } else toast.error(r.error);
          })
        }
        className="w-fit rounded-md bg-[var(--color-primary)] px-3 py-1 font-semibold text-[var(--color-primary-fg)] disabled:opacity-40"
      >
        {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Install"}
      </button>
      {result ? (
        <div className="grid gap-2">
          {result.joinToken ? (
            <details className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
              <summary className="cursor-pointer text-xs font-semibold">Join token (for agents)</summary>
              <pre className="mt-1 break-all font-mono text-xs">{result.joinToken}</pre>
            </details>
          ) : null}
          {result.kubeconfig ? (
            <details className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
              <summary className="flex cursor-pointer items-center gap-2 text-xs font-semibold">
                kubeconfig
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    const blob = new Blob([result.kubeconfig!], { type: "text/yaml" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "vmui-kubeconfig.yaml";
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="ml-auto inline-flex items-center gap-1 rounded border border-[var(--color-border)] px-2 py-0.5 text-[10px]"
                >
                  <Download className="h-3 w-3" /> Download
                </button>
              </summary>
              <pre className="mt-1 max-h-72 overflow-auto font-mono text-xs">{result.kubeconfig}</pre>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function KubectlTab({ instances }: { instances: InstanceLite[] }) {
  const [pending, start] = useTransition();
  const [instanceId, setInstanceId] = useState(instances[0]?.id ?? "");
  const [args, setArgs] = useState("get nodes");
  const [out, setOut] = useState<{ stdout: string; stderr: string } | null>(null);

  return (
    <div className="grid gap-3 text-xs">
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1">
          <span className="text-[10px] uppercase text-muted">Server node</span>
          <select value={instanceId} onChange={(e) => setInstanceId(e.target.value)} className={INPUT_CLS}>
            {instances.map((i) => (
              <option key={i.id} value={i.id}>{i.name ?? i.providerInstanceId}</option>
            ))}
          </select>
        </label>
        <label className="grid flex-1 gap-1">
          <span className="text-[10px] uppercase text-muted">kubectl args (alphanumerics + - _ . , / = : @ space)</span>
          <input value={args} onChange={(e) => setArgs(e.target.value)} className={`${INPUT_CLS} font-mono`} />
        </label>
        <button
          type="button"
          disabled={pending || !instanceId}
          onClick={() =>
            start(async () => {
              const r = await kubectlAction(instanceId, args);
              setOut({ stdout: r.stdout ?? "", stderr: (!r.ok && "error" in r ? r.error : r.stderr) ?? "" });
            })
          }
          className="rounded-md bg-[var(--color-primary)] px-3 py-1 font-semibold text-[var(--color-primary-fg)] disabled:opacity-40"
        >
          <Terminal className="inline h-3 w-3" /> Run
        </button>
      </div>
      {out ? (
        <div className="grid gap-2">
          {out.stdout ? <pre className="overflow-auto rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2 font-mono">{out.stdout}</pre> : null}
          {out.stderr ? <pre className="overflow-auto rounded border border-red-500/40 bg-red-500/10 p-2 font-mono text-red-300">{out.stderr}</pre> : null}
        </div>
      ) : null}
    </div>
  );
}

function HelmTab({ instances }: { instances: InstanceLite[] }) {
  const [pending, start] = useTransition();
  const [form, setForm] = useState({
    instanceId: instances[0]?.id ?? "",
    release: "",
    chart: "",
    namespace: "",
    repoName: "",
    repoUrl: "",
    values: "",
  });

  return (
    <div className="grid gap-3 text-xs">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Server node">
          <select value={form.instanceId} onChange={(e) => setForm({ ...form, instanceId: e.target.value })} className={INPUT_CLS}>
            {instances.map((i) => (
              <option key={i.id} value={i.id}>{i.name ?? i.providerInstanceId}</option>
            ))}
          </select>
        </Field>
        <Field label="Release name"><input value={form.release} onChange={(e) => setForm({ ...form, release: e.target.value })} className={INPUT_CLS} /></Field>
        <Field label="Chart (e.g. bitnami/nginx)"><input value={form.chart} onChange={(e) => setForm({ ...form, chart: e.target.value })} className={INPUT_CLS} /></Field>
        <Field label="Namespace (optional)"><input value={form.namespace} onChange={(e) => setForm({ ...form, namespace: e.target.value })} className={INPUT_CLS} /></Field>
        <Field label="Repo name (optional)"><input value={form.repoName} onChange={(e) => setForm({ ...form, repoName: e.target.value })} className={INPUT_CLS} /></Field>
        <Field label="Repo URL (optional)"><input value={form.repoUrl} onChange={(e) => setForm({ ...form, repoUrl: e.target.value })} className={INPUT_CLS} /></Field>
        <Field label="values.yaml (optional)">
          <textarea value={form.values} onChange={(e) => setForm({ ...form, values: e.target.value })} className={`${INPUT_CLS} h-32 font-mono sm:col-span-2 lg:col-span-3`} />
        </Field>
      </div>
      <button
        type="button"
        disabled={pending || !form.instanceId || !form.release || !form.chart}
        onClick={() =>
          start(async () => {
            const r = await helmInstallAction(form);
            if (r.ok) toast.success("Helm release applied");
            else toast.error(r.error);
          })
        }
        className="w-fit rounded-md bg-[var(--color-primary)] px-3 py-1 font-semibold text-[var(--color-primary-fg)] disabled:opacity-40"
      >
        <Ship className="inline h-3 w-3" /> Helm install
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
