import { cn } from "@/lib/utils";

export function tagHue(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function tagColor(key: string): string {
  return `oklch(0.7 0.14 ${tagHue(key)})`;
}

export function TagChip({ tagKey, value, className }: { tagKey: string; value?: string | null; className?: string }) {
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-surface-muted px-2 py-0.5 font-mono text-[11px]", className)}>
      <span className="size-2 shrink-0 rounded-full" style={{ background: tagColor(tagKey) }} aria-hidden />
      <span className="truncate">
        {tagKey}
        {value !== undefined && value !== null && value !== "" && <span className="text-fg-muted">={value}</span>}
      </span>
    </span>
  );
}
