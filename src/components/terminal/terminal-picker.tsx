"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, TerminalSquare, Container as ContainerIcon, Server } from "lucide-react";
import { TerminalView } from "@/components/instances/terminal-view";
import {
  openHostTerminalAction,
  openContainerTerminalAction,
} from "@/server/actions/terminal";

interface InstanceLite {
  id: string;
  name: string | null;
  providerInstanceId: string;
  provider: string;
  region: string;
  publicIp: string | null;
}

type Target = { kind: "host"; instanceId: string } | { kind: "container"; instanceId: string; containerId: string };

export function TerminalPicker({ instances }: { instances: InstanceLite[] }) {
  const [mode, setMode] = useState<"host" | "container">("host");
  const [instanceId, setInstanceId] = useState<string>(instances[0]?.id ?? "");
  const [containerId, setContainerId] = useState<string>("");
  const [shell, setShell] = useState<"/bin/sh" | "/bin/bash">("/bin/sh");
  const [containerOptions, setContainerOptions] = useState<{ id: string; name: string }[]>([]);
  const [loadingContainers, setLoadingContainers] = useState(false);
  const [active, setActive] = useState<{ wsUrl: string; label: string; target: Target } | null>(null);
  const [opening, startOpen] = useTransition();

  // Deep-link: read ?instance=…&container=… on first paint to preselect.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    const i = sp.get("instance");
    const c = sp.get("container");
    if (i && instances.some((x) => x.id === i)) setInstanceId(i);
    if (c) {
      setMode("container");
      setContainerId(c);
    }
  }, [instances]);

  useEffect(() => {
    if (mode !== "container" || !instanceId) return;
    setLoadingContainers(true);
    setContainerOptions([]);
    const es = new EventSource(
      `/api/instances/${encodeURIComponent(instanceId)}/containers/stream?interval=10`,
    );
    es.addEventListener("snapshot", (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data) as {
          rows: { id: string; name: string; state: string }[];
        };
        const running = data.rows.filter((r) => r.state === "running");
        setContainerOptions(running.map((r) => ({ id: r.id, name: r.name || r.id })));
        if (running.length > 0 && !containerId) setContainerId(running[0]!.id);
      } catch {
        /* ignore */
      } finally {
        setLoadingContainers(false);
      }
    });
    es.addEventListener("error", () => setLoadingContainers(false));
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, instanceId]);

  const open = () =>
    startOpen(async () => {
      if (mode === "host") {
        const res = await openHostTerminalAction({ instanceId });
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        setActive({ wsUrl: res.wsUrl, label: res.label, target: { kind: "host", instanceId } });
      } else {
        if (!containerId) {
          toast.error("Pick a container first.");
          return;
        }
        const res = await openContainerTerminalAction({ instanceId, containerId, shell });
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        setActive({
          wsUrl: res.wsUrl,
          label: res.label,
          target: { kind: "container", instanceId, containerId },
        });
      }
    });

  const reconnect = () => {
    if (!active) return;
    startOpen(async () => {
      const res =
        active.target.kind === "host"
          ? await openHostTerminalAction({ instanceId: active.target.instanceId })
          : await openContainerTerminalAction({
              instanceId: active.target.instanceId,
              containerId: active.target.containerId,
              shell,
            });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setActive({ wsUrl: res.wsUrl, label: res.label, target: active.target });
    });
  };

  if (instances.length === 0) {
    return (
      <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-center text-sm text-muted">
        No reachable Linux instances. Start one to open a terminal.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-sm">
        <div className="inline-flex rounded-md border border-[var(--color-border)] p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setMode("host")}
            className={`inline-flex items-center gap-1 rounded px-2 py-1 ${mode === "host" ? "bg-[var(--color-primary)] text-[var(--color-primary-fg)]" : ""}`}
          >
            <Server className="h-3 w-3" /> Host
          </button>
          <button
            type="button"
            onClick={() => setMode("container")}
            className={`inline-flex items-center gap-1 rounded px-2 py-1 ${mode === "container" ? "bg-[var(--color-primary)] text-[var(--color-primary-fg)]" : ""}`}
          >
            <ContainerIcon className="h-3 w-3" /> Container
          </button>
        </div>
        <select
          value={instanceId}
          onChange={(e) => setInstanceId(e.target.value)}
          className="rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1 text-xs"
        >
          {instances.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name ?? i.providerInstanceId} · {i.provider}/{i.region}
            </option>
          ))}
        </select>
        {mode === "container" && (
          <>
            {loadingContainers ? (
              <span className="inline-flex items-center gap-1 text-xs text-muted">
                <Loader2 className="h-3 w-3 animate-spin" /> loading
              </span>
            ) : (
              <select
                value={containerId}
                onChange={(e) => setContainerId(e.target.value)}
                className="rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1 text-xs"
              >
                {containerOptions.length === 0 && <option value="">no running containers</option>}
                {containerOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
            <select
              value={shell}
              onChange={(e) => setShell(e.target.value as "/bin/sh" | "/bin/bash")}
              className="rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1 text-xs"
            >
              <option value="/bin/sh">/bin/sh</option>
              <option value="/bin/bash">/bin/bash</option>
            </select>
          </>
        )}
        <button
          type="button"
          onClick={open}
          disabled={opening || (mode === "container" && !containerId)}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-[var(--color-primary)] px-2.5 py-1 text-xs font-semibold text-[var(--color-primary-fg)] disabled:opacity-50"
        >
          {opening ? <Loader2 className="h-3 w-3 animate-spin" /> : <TerminalSquare className="h-3 w-3" />} Open
        </button>
      </div>

      <div className="flex-1 min-h-0">
        {active ? (
          <TerminalView key={active.wsUrl} wsUrl={active.wsUrl} label={active.label} onReconnect={reconnect} />
        ) : (
          <div className="grid h-full place-items-center rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] text-xs text-muted">
            Pick a target and click Open.
          </div>
        )}
      </div>
    </div>
  );
}
