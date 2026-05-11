"use client";
import { useState } from "react";
import { toast } from "sonner";

export default function ConfigBackupPage() {
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<unknown>(null);

  async function onImport(file: File, confirm: boolean) {
    setBusy(true);
    try {
      const text = await file.text();
      const res = await fetch(`/api/config/import${confirm ? "?confirm=1" : ""}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: text,
      });
      const json = await res.json();
      setReport(json);
      if (!res.ok) toast.error(json.error ?? "Import failed");
      else toast.success(confirm ? "Restore complete" : "Dry-run complete");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Config backup &amp; restore</h1>
        <p className="text-sm text-zinc-400">
          JSON-export every config table (accounts, keys, schedules, webhooks, recipes…) and restore on a fresh host.
          Encrypted credential blobs require the same <code>VMUI_MASTER_KEY</code>.
        </p>
      </header>

      <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-5 space-y-3">
        <h2 className="text-sm font-medium">Export</h2>
        <a
          href="/api/config/export"
          className="inline-block rounded-md bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 text-sm"
        >
          Download config snapshot
        </a>
        <p className="text-xs text-zinc-500">Operational tables (audit log, sync history, instances, pricing) are excluded.</p>
      </section>

      <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-5 space-y-3">
        <h2 className="text-sm font-medium">Restore</h2>
        <p className="text-xs text-amber-300">
          ⚠ Restore truncates every config table before inserting. Use only on a fresh / empty install.
        </p>
        <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
          <input
            type="file"
            accept="application/json,.json"
            disabled={busy}
            onChange={async (e) => {
              const f = e.currentTarget.files?.[0];
              if (f) await onImport(f, false);
              e.currentTarget.value = "";
            }}
            className="text-sm"
          />
          <span className="text-xs text-zinc-500">First click = dry-run, then confirm to apply.</span>
        </div>

        {report !== null && (
          <pre className="mt-3 max-h-80 overflow-auto rounded bg-zinc-900 p-3 text-xs text-zinc-300">
{JSON.stringify(report, null, 2)}
          </pre>
        )}

        {report !== null && typeof report === "object" && (report as { dryRun?: boolean }).dryRun && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              const file = (document.querySelector('input[type=file]') as HTMLInputElement | null)?.files?.[0];
              if (!file) {
                toast.error("Re-pick the file to confirm");
                return;
              }
              if (!confirm("This will TRUNCATE every config table and overwrite from the file. Continue?")) return;
              onImport(file, true);
            }}
            className="rounded-md bg-rose-600 hover:bg-rose-500 text-white px-3 py-1.5 text-sm"
          >
            Confirm restore
          </button>
        )}
      </section>
    </div>
  );
}
