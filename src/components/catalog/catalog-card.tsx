"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Copy, Save, ExternalLink, Boxes } from "lucide-react";
import { saveCatalogTemplateAction } from "@/server/actions/catalog";
import type { CatalogTemplate } from "@/lib/catalog";

const CATEGORY_COLOR: Record<CatalogTemplate["category"], string> = {
  automation: "bg-violet-500/15 text-violet-300",
  analytics: "bg-amber-500/15 text-amber-300",
  docs: "bg-emerald-500/15 text-emerald-300",
  monitoring: "bg-sky-500/15 text-sky-300",
  security: "bg-rose-500/15 text-rose-300",
  dev: "bg-cyan-500/15 text-cyan-300",
};

export function CatalogCard({ template }: { template: CatalogTemplate }) {
  const [pending, start] = useTransition();
  const [expanded, setExpanded] = useState(false);

  return (
    <article className="flex flex-col rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <header className="mb-2 flex items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">{template.name}</h2>
          <span className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${CATEGORY_COLOR[template.category]}`}>
            {template.category}
          </span>
        </div>
        <a
          href={template.homepage}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded p-1 text-muted hover:bg-[var(--color-surface-muted)]"
          aria-label={`Open ${template.name} homepage`}
        >
          <ExternalLink className="h-4 w-4" />
        </a>
      </header>
      <p className="mb-3 flex-1 text-sm text-muted">{template.description}</p>
      <dl className="mb-3 grid grid-cols-3 gap-2 text-[11px]">
        <div>
          <dt className="text-muted">vCPU</dt>
          <dd className="font-mono">{template.recommends.vcpu}</dd>
        </div>
        <div>
          <dt className="text-muted">RAM</dt>
          <dd className="font-mono">{template.recommends.ramGb} GB</dd>
        </div>
        <div>
          <dt className="text-muted">Disk</dt>
          <dd className="font-mono">{template.recommends.diskGb} GB</dd>
        </div>
      </dl>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await saveCatalogTemplateAction(template.id);
              if (res.ok) toast.success(`Saved “${template.name}” as a boot script`);
              else toast.error(res.error ?? "Save failed");
            })
          }
          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-primary)] px-2.5 py-1.5 text-xs font-semibold text-[var(--color-primary-fg)] disabled:opacity-50"
        >
          <Save className="h-3.5 w-3.5" /> Save as boot script
        </button>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(template.cloudInit);
            toast.success("cloud-init copied to clipboard");
          }}
          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-2.5 py-1.5 text-xs hover:bg-[var(--color-surface-muted)]"
        >
          <Copy className="h-3.5 w-3.5" /> Copy YAML
        </button>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-muted hover:bg-[var(--color-surface-muted)]"
        >
          <Boxes className="h-3.5 w-3.5" /> {expanded ? "Hide" : "Show"} cloud-init
        </button>
      </div>
      {expanded && (
        <pre className="mt-3 max-h-72 overflow-auto rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-2 text-[11px]">
          <code>{template.cloudInit}</code>
        </pre>
      )}
    </article>
  );
}
