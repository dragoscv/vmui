"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Activity, Download, ExternalLink, Loader2 } from "lucide-react";
import { deployNodeExporterAction, generatePromConfigAction } from "@/server/actions/monitoring";

interface InstanceLite {
  id: string;
  name: string | null;
  providerInstanceId: string;
  provider: string;
  publicIp: string | null;
  publicDns: string | null;
  state: string;
  platform: string;
}

export function MonitoringWorkspace({ instances, grafanaUrl }: { instances: InstanceLite[]; grafanaUrl: string }) {
  const [pending, start] = useTransition();
  const [results, setResults] = useState<Record<string, string>>({});
  const [yaml, setYaml] = useState<string>("");

  return (
    <div className="grid gap-6">
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">node_exporter deployment</h2>
        <div className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-surface-muted)] text-xs uppercase text-muted">
              <tr>
                <th className="px-2 py-2 text-left">Instance</th>
                <th className="px-2 py-2 text-left">Provider</th>
                <th className="px-2 py-2 text-left">IP</th>
                <th className="px-2 py-2 text-left">Result</th>
                <th className="w-32 px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {instances.map((i) => (
                <tr key={i.id} className="border-t border-[var(--color-border)]">
                  <td className="px-2 py-2 font-medium">{i.name ?? i.providerInstanceId}</td>
                  <td className="px-2 py-2 text-xs">{i.provider}</td>
                  <td className="px-2 py-2 font-mono text-xs">{i.publicIp ?? i.publicDns ?? "—"}</td>
                  <td className="px-2 py-2 text-xs text-muted">{results[i.id] ?? ""}</td>
                  <td className="px-2 py-2 text-right">
                    <button
                      type="button"
                      disabled={pending || !(i.publicIp || i.publicDns) || i.platform === "windows"}
                      onClick={() =>
                        start(async () => {
                          const r = await deployNodeExporterAction(i.id);
                          setResults((p) => ({ ...p, [i.id]: r.ok ? `OK: ${r.url}` : `ERR: ${r.error}` }));
                          if (r.ok) toast.success("Deployed");
                          else toast.error(r.error);
                        })
                      }
                      className="inline-flex items-center gap-1 rounded-md bg-[var(--color-primary)] px-2 py-1 text-xs font-semibold text-[var(--color-primary-fg)] disabled:opacity-40"
                    >
                      {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Activity className="h-3 w-3" />}
                      Deploy
                    </button>
                  </td>
                </tr>
              ))}
              {instances.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-xs text-muted">
                    No reachable Linux/macOS instances.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <header className="mb-2 flex items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Prometheus scrape config</h2>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await generatePromConfigAction();
                if (r.ok) setYaml(r.yaml);
              })
            }
            className="ml-auto inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs hover:bg-[var(--color-surface-muted)]"
          >
            <Download className="h-3 w-3" /> Generate
          </button>
        </header>
        <pre className="overflow-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-xs font-mono">{yaml || "(click Generate)"}</pre>
      </section>

      <section>
        <header className="mb-2 flex items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Grafana embed</h2>
          {grafanaUrl ? (
            <a
              href={grafanaUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="ml-auto inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs"
            >
              Open <ExternalLink className="h-3 w-3" />
            </a>
          ) : null}
        </header>
        {grafanaUrl ? (
          <div className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-black">
            <iframe src={grafanaUrl} className="h-[600px] w-full" title="Grafana" />
          </div>
        ) : (
          <p className="text-xs text-muted">
            Set <code className="rounded bg-[var(--color-surface-muted)] px-1 font-mono">VMUI_GRAFANA_URL</code> in your env to embed a Grafana dashboard here.
          </p>
        )}
      </section>
    </div>
  );
}
