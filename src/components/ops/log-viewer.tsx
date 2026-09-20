"use client";

import { Button, Input } from "@/components/ui";
import { cn } from "@/lib/utils";
import { ArrowDownToLine, Check, Copy, Search, WrapText } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";

export interface LogViewerProps {
  /** Log content; either pre-split lines or one string (split on `\n`). */
  lines?: readonly string[];
  text?: string;
  title?: React.ReactNode;
  /** Height utility class for the scroll area; default `max-h-80`. */
  height?: string;
  className?: string;
  /** Start with auto-scroll on (default true). The toggle is always shown. */
  autoScroll?: boolean;
  /** Show the search box (default true). */
  searchable?: boolean;
  /** Wrap long lines (default false → horizontal scroll). */
  wrap?: boolean;
  loading?: boolean;
  emptyLabel?: React.ReactNode;
  /** Extra toolbar controls rendered next to the built-in ones. */
  actions?: React.ReactNode;
  /** Optional per-line tone, e.g. colour stderr lines. */
  lineTone?: (line: string, index: number) => "default" | "muted" | "success" | "warning" | "danger" | undefined;
}

const TONE: Record<NonNullable<ReturnType<NonNullable<LogViewerProps["lineTone"]>>>, string> = {
  default: "",
  muted: "text-fg-muted",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
};

function highlight(line: string, q: string): React.ReactNode {
  if (!q) return line;
  const lower = line.toLowerCase();
  const needle = q.toLowerCase();
  const parts: React.ReactNode[] = [];
  let from = 0;
  let idx = lower.indexOf(needle, from);
  let k = 0;
  while (idx !== -1) {
    if (idx > from) parts.push(line.slice(from, idx));
    parts.push(
      <mark key={k++} className="rounded-[2px] bg-[color-mix(in_oklch,var(--color-warning)_45%,transparent)] text-fg">
        {line.slice(idx, idx + needle.length)}
      </mark>,
    );
    from = idx + needle.length;
    idx = lower.indexOf(needle, from);
  }
  if (from < line.length) parts.push(line.slice(from));
  return parts;
}

export function LogViewer({
  lines,
  text,
  title,
  height = "max-h-80",
  className,
  autoScroll: autoScrollDefault = true,
  searchable = true,
  wrap: wrapDefault = false,
  loading = false,
  emptyLabel,
  actions,
  lineTone,
}: LogViewerProps) {
  const t = useTranslations("ops.logViewer");
  const all = React.useMemo(() => lines ?? (text ? text.split("\n") : []), [lines, text]);
  const [query, setQuery] = React.useState("");
  const [autoScroll, setAutoScroll] = React.useState(autoScrollDefault);
  const [wrap, setWrap] = React.useState(wrapDefault);
  const [copied, setCopied] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);

  const visible = React.useMemo(() => {
    if (!query) return all.map((line, i) => ({ line, i }));
    const q = query.toLowerCase();
    return all.map((line, i) => ({ line, i })).filter(({ line }) => line.toLowerCase().includes(q));
  }, [all, query]);

  React.useEffect(() => {
    if (!autoScroll || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [all.length, autoScroll, visible.length]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(all.join("\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  const matchCount = query ? visible.length : 0;

  return (
    <div className={cn("surface flex min-w-0 flex-col overflow-hidden", className)}>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        {title && <span className="min-w-0 truncate text-xs font-semibold">{title}</span>}
        <span className="text-xs tabular-nums text-fg-muted">{t("lines", { count: all.length })}</span>
        {query && <span className="text-xs tabular-nums text-fg-muted">{t("matches", { count: matchCount })}</span>}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {searchable && (
            <div className="relative">
              <Search className="pointer-events-none absolute inset-y-0 left-2 my-auto size-3.5 text-fg-muted" aria-hidden />
              <Input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("search")}
                aria-label={t("search")}
                className="h-8 w-40 pl-7 text-xs"
              />
            </div>
          )}
          <Button
            type="button"
            variant={wrap ? "secondary" : "ghost"}
            size="icon"
            className="size-8"
            aria-pressed={wrap}
            aria-label={t("wrap")}
            title={t("wrap")}
            onClick={() => setWrap((w) => !w)}
          >
            <WrapText className="size-4" aria-hidden />
          </Button>
          <Button
            type="button"
            variant={autoScroll ? "secondary" : "ghost"}
            size="icon"
            className="size-8"
            aria-pressed={autoScroll}
            aria-label={t("autoScroll")}
            title={t("autoScroll")}
            onClick={() => setAutoScroll((a) => !a)}
          >
            <ArrowDownToLine className="size-4" aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={copied ? t("copied") : t("copy")}
            title={copied ? t("copied") : t("copy")}
            onClick={copy}
            disabled={all.length === 0}
          >
            {copied ? <Check className="size-4 text-success" aria-hidden /> : <Copy className="size-4" aria-hidden />}
          </Button>
          {actions}
        </div>
      </div>
      <div
        ref={scrollRef}
        role="log"
        aria-live="polite"
        aria-busy={loading || undefined}
        className={cn("overflow-auto bg-bg-muted/40 p-3 font-mono text-xs leading-relaxed [scrollbar-width:thin]", height)}
      >
        {all.length === 0 ? (
          <p className="text-fg-muted">{loading ? t("waiting") : (emptyLabel ?? t("empty"))}</p>
        ) : (
          <ol className={cn("min-w-0", wrap ? "whitespace-pre-wrap break-all" : "whitespace-pre")}>
            {visible.map(({ line, i }) => (
              <li key={i} className={cn("tabular-nums", TONE[lineTone?.(line, i) ?? "default"])}>
                {highlight(line, query)}
              </li>
            ))}
          </ol>
        )}
        {loading && all.length > 0 && <span className="pulse-dot mt-1 inline-block size-1.5 rounded-full bg-primary" aria-hidden />}
      </div>
    </div>
  );
}
