"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Hammer, RefreshCw, ChevronDown, ChevronRight } from "lucide-react";
import {
  createRegistryAction,
  deleteRegistryAction,
  listRegistriesAction,
  listBuildsAction,
  kickoffBuildAction,
} from "@/server/actions/builds";

type RegType = "ecr" | "gcr" | "acr" | "dockerhub" | "ghcr";

interface RegistryLite {
  id: string;
  name: string;
  type: string;
  registryUrl: string;
  createdAt: Date;
}

interface BuildRow {
  id: string;
  registryId: string;
  imageRef: string;
  buildLocation: "local" | "remote";
  instanceId: string | null;
  status: "pending" | "running" | "success" | "failed";
  logOutput: string | null;
  createdAt: Date;
  finishedAt: Date | null;
}

interface InstanceLite {
  id: string;
  name: string | null;
  providerInstanceId: string;
  provider: string;
  region: string;
}

const STATUS_COLOR: Record<string, string> = {
  pending: "bg-slate-500/20 text-slate-200",
  running: "bg-sky-500/20 text-sky-200",
  success: "bg-emerald-500/20 text-emerald-200",
  failed: "bg-red-500/20 text-red-200",
};

export function BuildsWorkspace({ instances }: { instances: InstanceLite[] }) {
  const [registries, setRegistries] = useState<RegistryLite[]>([]);
  const [builds, setBuilds] = useState<BuildRow[]>([]);
  const [showAddReg, setShowAddReg] = useState(false);
  const [showAddBuild, setShowAddBuild] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const refresh = async () => {
    const [r, b] = await Promise.all([listRegistriesAction(), listBuildsAction()]);
    if (r.ok) setRegistries(r.rows as RegistryLite[]);
    if (b.ok) setBuilds(b.rows as BuildRow[]);
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
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Registries</h2>
          <button
            type="button"
            onClick={() => setShowAddReg((s) => !s)}
            className="ml-auto inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs hover:bg-[var(--color-surface-muted)]"
          >
            <Plus className="h-3 w-3" /> Add registry
          </button>
        </header>
        {showAddReg && <AddRegistryForm onSaved={() => { setShowAddReg(false); void refresh(); }} />}
        <div className="overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]">
          <table className="w-full text-xs">
            <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] text-[10px] uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-1.5 text-left">Name</th>
                <th className="px-3 py-1.5 text-left">Type</th>
                <th className="px-3 py-1.5 text-left">URL</th>
                <th className="px-3 py-1.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {registries.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-4 text-center text-muted">
                    No registries configured.
                  </td>
                </tr>
              )}
              {registries.map((r) => (
                <tr key={r.id} className="border-b border-[var(--color-border)] last:border-b-0">
                  <td className="px-3 py-1.5 font-mono">{r.name}</td>
                  <td className="px-3 py-1.5 uppercase">{r.type}</td>
                  <td className="px-3 py-1.5 font-mono text-muted">{r.registryUrl}</td>
                  <td className="px-3 py-1.5 text-right">
                    <DeleteRegistryButton id={r.id} onDeleted={refresh} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <header className="mb-2 flex items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Builds</h2>
          <button
            type="button"
            onClick={() => void refresh()}
            className="ml-auto inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs hover:bg-[var(--color-surface-muted)]"
          >
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
          <button
            type="button"
            disabled={registries.length === 0}
            onClick={() => setShowAddBuild((s) => !s)}
            className="inline-flex items-center gap-1 rounded-md bg-[var(--color-primary)] px-2 py-1 text-xs font-semibold text-[var(--color-primary-fg)] disabled:opacity-50"
          >
            <Hammer className="h-3 w-3" /> New build
          </button>
        </header>
        {showAddBuild && (
          <NewBuildForm
            registries={registries}
            instances={instances}
            onStarted={() => { setShowAddBuild(false); void refresh(); }}
          />
        )}
        <div className="overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]">
          <table className="w-full text-xs">
            <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] text-[10px] uppercase tracking-wide text-muted">
              <tr>
                <th className="w-6"></th>
                <th className="px-3 py-1.5 text-left">Image</th>
                <th className="px-3 py-1.5 text-left">Where</th>
                <th className="px-3 py-1.5 text-left">Status</th>
                <th className="px-3 py-1.5 text-left">Started</th>
              </tr>
            </thead>
            <tbody>
              {builds.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-muted">
                    No builds yet.
                  </td>
                </tr>
              )}
              {builds.map((b) => (
                <BuildRowView
                  key={b.id}
                  build={b}
                  expanded={expanded === b.id}
                  onToggle={() => setExpanded(expanded === b.id ? null : b.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function BuildRowView({
  build,
  expanded,
  onToggle,
}: {
  build: BuildRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        className="cursor-pointer border-b border-[var(--color-border)] last:border-b-0 hover:bg-[var(--color-surface-muted)]/40"
        onClick={onToggle}
      >
        <td className="px-2 py-1.5 text-center text-muted">
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </td>
        <td className="px-3 py-1.5 font-mono">{build.imageRef}</td>
        <td className="px-3 py-1.5 text-muted">{build.buildLocation}</td>
        <td className="px-3 py-1.5">
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${STATUS_COLOR[build.status] ?? ""}`}>
            {build.status}
          </span>
        </td>
        <td className="px-3 py-1.5 text-[10px] text-muted">
          {new Date(build.createdAt).toLocaleString()}
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-[var(--color-border)]">
          <td colSpan={5} className="bg-black/40 px-4 py-3">
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap font-mono text-[10px] leading-snug text-slate-200">
{build.logOutput || "(no logs yet)"}
            </pre>
          </td>
        </tr>
      )}
    </>
  );
}

function DeleteRegistryButton({ id, onDeleted }: { id: string; onDeleted: () => void | Promise<void> }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!window.confirm("Delete registry credential?")) return;
        start(async () => {
          const res = await deleteRegistryAction({ id });
          if (res.ok) {
            toast.success("Deleted");
            await onDeleted();
          }
        });
      }}
      className="inline-flex items-center gap-1 rounded border border-red-500/30 px-1.5 py-0.5 text-[10px] text-red-300 hover:bg-red-500/10 disabled:opacity-50"
    >
      <Trash2 className="h-3 w-3" /> Delete
    </button>
  );
}

function AddRegistryForm({ onSaved }: { onSaved: () => void }) {
  const [type, setType] = useState<RegType>("ghcr");
  const [pending, start] = useTransition();
  const [form, setForm] = useState({
    name: "",
    registryUrl: "ghcr.io",
    username: "",
    password: "",
    token: "",
    accessKeyId: "",
    secretAccessKey: "",
    region: "us-east-1",
    serviceAccountJson: "",
  });

  const setField = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((s) => ({ ...s, [k]: e.target.value }));

  const submit = () =>
    start(async () => {
      const res = await createRegistryAction({ ...form, type });
      if (res.ok) {
        toast.success("Registry saved");
        onSaved();
      } else {
        toast.error("Failed");
      }
    });

  return (
    <div className="mb-2 grid gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-xs">
      <div className="flex flex-wrap gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-muted">Name</span>
          <input value={form.name} onChange={setField("name")} className="rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-muted">Type</span>
          <select value={type} onChange={(e) => setType(e.target.value as RegType)} className="rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1">
            <option value="ghcr">GitHub Container Registry</option>
            <option value="dockerhub">Docker Hub</option>
            <option value="ecr">AWS ECR</option>
            <option value="gcr">GCP Artifact Registry</option>
            <option value="acr">Azure ACR</option>
          </select>
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-[10px] uppercase text-muted">Registry URL</span>
          <input value={form.registryUrl} onChange={setField("registryUrl")} className="rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1 font-mono" />
        </label>
      </div>
      {(type === "ghcr" || type === "dockerhub" || type === "acr") && (
        <div className="flex flex-wrap gap-2">
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-[10px] uppercase text-muted">Username</span>
            <input value={form.username} onChange={setField("username")} className="rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1 font-mono" />
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-[10px] uppercase text-muted">{type === "ghcr" ? "Token (PAT)" : "Password / Token"}</span>
            <input type="password" value={type === "ghcr" ? form.token : form.password} onChange={setField(type === "ghcr" ? "token" : "password")} className="rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1 font-mono" />
          </label>
        </div>
      )}
      {type === "ecr" && (
        <div className="flex flex-wrap gap-2">
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-[10px] uppercase text-muted">Access Key ID</span>
            <input value={form.accessKeyId} onChange={setField("accessKeyId")} className="rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1 font-mono" />
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-[10px] uppercase text-muted">Secret Access Key</span>
            <input type="password" value={form.secretAccessKey} onChange={setField("secretAccessKey")} className="rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1 font-mono" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase text-muted">Region</span>
            <input value={form.region} onChange={setField("region")} className="rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1 font-mono" />
          </label>
        </div>
      )}
      {type === "gcr" && (
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-muted">Service Account JSON</span>
          <textarea value={form.serviceAccountJson} onChange={setField("serviceAccountJson")} rows={4} className="rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1 font-mono text-[10px]" />
        </label>
      )}
      <div className="flex justify-end">
        <button type="button" onClick={submit} disabled={pending || !form.name} className="inline-flex items-center gap-1 rounded-md bg-[var(--color-primary)] px-2.5 py-1 text-xs font-semibold text-[var(--color-primary-fg)] disabled:opacity-50">
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Save registry
        </button>
      </div>
    </div>
  );
}

function NewBuildForm({
  registries,
  instances,
  onStarted,
}: {
  registries: RegistryLite[];
  instances: InstanceLite[];
  onStarted: () => void;
}) {
  const [registryId, setRegistryId] = useState(registries[0]?.id ?? "");
  const [imageRef, setImageRef] = useState("");
  const [buildLocation, setBuildLocation] = useState<"local" | "remote">("local");
  const [instanceId, setInstanceId] = useState(instances[0]?.id ?? "");
  const [dockerfile, setDockerfile] = useState("FROM alpine:3\nRUN echo hello > /hello.txt\n");
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      if (!registryId || !imageRef || !dockerfile) {
        toast.error("Fill all fields");
        return;
      }
      const res = await kickoffBuildAction({
        registryId,
        imageRef,
        dockerfile,
        buildLocation,
        instanceId: buildLocation === "remote" ? instanceId : undefined,
      });
      if (res.ok) {
        toast.success("Build started");
        onStarted();
      } else {
        toast.error(res.error);
      }
    });

  return (
    <div className="mb-2 grid gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-xs">
      <div className="flex flex-wrap gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-muted">Registry</span>
          <select value={registryId} onChange={(e) => setRegistryId(e.target.value)} className="rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1">
            {registries.map((r) => (
              <option key={r.id} value={r.id}>{r.name} ({r.type})</option>
            ))}
          </select>
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-[10px] uppercase text-muted">Image ref</span>
          <input value={imageRef} onChange={(e) => setImageRef(e.target.value)} placeholder="ghcr.io/owner/img:tag" className="rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1 font-mono" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-muted">Build location</span>
          <select value={buildLocation} onChange={(e) => setBuildLocation(e.target.value as "local" | "remote")} className="rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1">
            <option value="local">local (vmui host)</option>
            <option value="remote">remote (on VM)</option>
          </select>
        </label>
        {buildLocation === "remote" && (
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase text-muted">Instance</span>
            <select value={instanceId} onChange={(e) => setInstanceId(e.target.value)} className="rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1">
              {instances.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name ?? i.providerInstanceId} · {i.provider}/{i.region}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase text-muted">Dockerfile</span>
        <textarea value={dockerfile} onChange={(e) => setDockerfile(e.target.value)} rows={8} className="rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1 font-mono text-[10px]" />
      </label>
      <div className="flex justify-end">
        <button type="button" onClick={submit} disabled={pending} className="inline-flex items-center gap-1 rounded-md bg-[var(--color-primary)] px-2.5 py-1 text-xs font-semibold text-[var(--color-primary-fg)] disabled:opacity-50">
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Hammer className="h-3 w-3" />} Start build
        </button>
      </div>
    </div>
  );
}
