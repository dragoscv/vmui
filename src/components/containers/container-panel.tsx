"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Play, Square, RotateCcw, Trash2, Download, FileText, Search, Loader2 } from "lucide-react";
import {
  containerActionAction,
  inspectContainerAction,
} from "@/server/actions/containers";
import type { ContainerListResult, ContainerRow } from "@/lib/containers";

const STATE_COLOR: Record<string, string> = {
  running: "bg-emerald-500/15 text-emerald-300",
  exited: "bg-slate-500/15 text-slate-300",
  created: "bg-sky-500/15 text-sky-300",
  paused: "bg-amber-500/15 text-amber-300",
  dead: "bg-red-500/15 text-red-300",
  restarting: "bg-violet-500/15 text-violet-300",
};

export function ContainerPanel({ instanceId }: { instanceId: string }) {
  const [data, setData] = useState<ContainerListResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [logsFor, setLogsFor] = useState<ContainerRow | null>(null);
  const [inspectFor, setInspectFor] = useState<{ row: ContainerRow; data: unknown } | null>(null);
  const [filter, setFilter] = useState("");
  const evtRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const ev = new EventSource(`/api/instances/${encodeURIComponent(instanceId)}/containers/stream?interval=5`);
    evtRef.current = ev;
    ev.addEventListener("snapshot", (e) => {
      try {
        setData(JSON.parse((e as MessageEvent).data) as ContainerListResult);
        setErr(null);
      } catch {
        /* ignore */
      }
    });
    ev.addEventListener("error", (e) => {
      try {
        const m = JSON.parse((e as MessageEvent).data) as { message?: string };
        if (m?.message) setErr(m.message);
      } catch {
        /* ignore */
      }
    });
    return () => {
      ev.close();
    };
  }, [instanceId]);

  if (err && !data) {
    return (
      <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
        {err}
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Connecting…
      </div>
    );
  }
  if (data.runtime === null) {
    return (
      <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm text-muted">
        {data.warning ?? "No container runtime detected on this guest."}
      </div>
    );
  }

  const filtered = filter
    ? data.rows.filter(
        (r) =>
          r.name.toLowerCase().includes(filter.toLowerCase()) ||
          r.image.toLowerCase().includes(filter.toLowerCase()) ||
          r.id.includes(filter),
      )
    : data.rows;

  return (
    <div className="grid gap-3">
      <header className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-[var(--color-surface-muted)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted">
          {data.runtime}
        </span>
        <span className="text-xs text-muted">{data.rows.length} container{data.rows.length === 1 ? "" : "s"}</span>
        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="filter…"
            className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] py-1 pl-7 pr-2 text-xs"
          />
        </div>
      </header>

      <div className="overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]">
        <table className="w-full text-xs">
          <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] text-[10px] uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-1.5 text-left font-semibold">Name</th>
              <th className="px-3 py-1.5 text-left font-semibold">Image</th>
              <th className="px-3 py-1.5 text-left font-semibold">Status</th>
              <th className="px-3 py-1.5 text-left font-semibold">Ports</th>
              <th className="px-3 py-1.5 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-muted">
                  No containers match.
                </td>
              </tr>
            )}
            {filtered.map((r) => (
              <ContainerRowView
                key={r.id || r.name}
                row={r}
                instanceId={instanceId}
                onLogs={() => setLogsFor(r)}
                onInspect={async () => {
                  const res = await inspectContainerAction({ instanceId, containerId: r.id || r.name });
                  if (!res.ok) {
                    toast.error(res.error ?? "Inspect failed");
                    return;
                  }
                  setInspectFor({ row: r, data: res.data });
                }}
              />
            ))}
          </tbody>
        </table>
      </div>

      {logsFor && (
        <ContainerLogsModal
          instanceId={instanceId}
          row={logsFor}
          onClose={() => setLogsFor(null)}
        />
      )}
      {inspectFor && (
        <InspectModal row={inspectFor.row} data={inspectFor.data} onClose={() => setInspectFor(null)} />
      )}
    </div>
  );
}

function ContainerRowView({
  row,
  instanceId,
  onLogs,
  onInspect,
}: {
  row: ContainerRow;
  instanceId: string;
  onLogs: () => void;
  onInspect: () => void;
}) {
  const [pending, start] = useTransition();
  const isRunning = row.state === "running";

  const act = (action: "start" | "stop" | "restart" | "remove" | "pull") =>
    start(async () => {
      const res = await containerActionAction({ instanceId, containerId: row.id || row.name, action });
      if (res.ok) toast.success(`${action} ok`);
      else toast.error(res.error ?? res.output?.slice(0, 200) ?? `${action} failed`);
    });

  return (
    <tr className="border-b border-[var(--color-border)] last:border-b-0 hover:bg-[var(--color-surface-muted)]/40">
      <td className="px-3 py-1.5 font-mono">{row.name || row.id}</td>
      <td className="px-3 py-1.5 font-mono text-muted">{row.image}</td>
      <td className="px-3 py-1.5">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${STATE_COLOR[row.state] ?? "bg-slate-500/15 text-slate-300"}`}>
          {row.state || "—"}
        </span>
        <span className="ml-1 text-[10px] text-muted">{row.status}</span>
      </td>
      <td className="px-3 py-1.5 font-mono text-[10px] text-muted">{row.ports || "—"}</td>
      <td className="px-3 py-1.5 text-right">
        <div className="inline-flex items-center gap-0.5">
          {!isRunning && <IconBtn title="Start" onClick={() => act("start")} disabled={pending} icon={<Play className="h-3 w-3" />} />}
          {isRunning && <IconBtn title="Stop" onClick={() => act("stop")} disabled={pending} icon={<Square className="h-3 w-3" />} />}
          <IconBtn title="Restart" onClick={() => act("restart")} disabled={pending} icon={<RotateCcw className="h-3 w-3" />} />
          <IconBtn title="Pull image" onClick={() => act("pull")} disabled={pending} icon={<Download className="h-3 w-3" />} />
          <IconBtn title="Logs" onClick={onLogs} icon={<FileText className="h-3 w-3" />} />
          <IconBtn title="Inspect" onClick={onInspect} icon={<Search className="h-3 w-3" />} />
          <IconBtn
            title="Remove"
            onClick={() => {
              if (window.confirm(`Remove container ${row.name || row.id}?`)) act("remove");
            }}
            disabled={pending}
            icon={<Trash2 className="h-3 w-3 text-red-400" />}
          />
        </div>
      </td>
    </tr>
  );
}

function IconBtn({
  title,
  onClick,
  icon,
  disabled,
}: {
  title: string;
  onClick: () => void;
  icon: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className="rounded p-1 hover:bg-[var(--color-surface-muted)] disabled:opacity-50"
    >
      {icon}
    </button>
  );
}

function ContainerLogsModal({
  instanceId,
  row,
  onClose,
}: {
  instanceId: string;
  row: ContainerRow;
  onClose: () => void;
}) {
  const [lines, setLines] = useState<string[]>([]);
  const preRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    const url = `/api/instances/${encodeURIComponent(instanceId)}/containers/${encodeURIComponent(row.id || row.name)}/logs?rt=${row.runtime}`;
    const ev = new EventSource(url);
    ev.addEventListener("log", (e) => {
      try {
        const { line } = JSON.parse((e as MessageEvent).data) as { line: string };
        setLines((prev) => (prev.length > 1000 ? [...prev.slice(-800), line] : [...prev, line]));
        requestAnimationFrame(() => {
          if (preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight;
        });
      } catch {
        /* ignore */
      }
    });
    return () => ev.close();
  }, [instanceId, row]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]"
      >
        <header className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2">
          <div className="text-sm font-semibold">logs · {row.name || row.id}</div>
          <button onClick={onClose} className="text-xs text-muted hover:underline">
            close
          </button>
        </header>
        <pre ref={preRef} className="flex-1 overflow-auto bg-[#0b0f17] p-3 font-mono text-[11px] text-slate-200">
          {lines.join("\n")}
        </pre>
      </div>
    </div>
  );
}

function InspectModal({ row, data, onClose }: { row: ContainerRow; data: unknown; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]"
      >
        <header className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2">
          <div className="text-sm font-semibold">inspect · {row.name || row.id}</div>
          <button onClick={onClose} className="text-xs text-muted hover:underline">
            close
          </button>
        </header>
        <pre className="flex-1 overflow-auto bg-[#0b0f17] p-3 font-mono text-[11px] text-slate-200">
          {JSON.stringify(data, null, 2)}
        </pre>
      </div>
    </div>
  );
}
