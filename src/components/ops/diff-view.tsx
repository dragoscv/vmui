import { Badge } from "@/components/ui";
import { cn } from "@/lib/utils";

export interface DiffOp {
  type: "ctx" | "add" | "del";
  line: string;
}

const LINE_TONE: Record<DiffOp["type"], string> = {
  add: "bg-[color-mix(in_oklch,var(--color-success)_14%,transparent)] text-success",
  del: "bg-[color-mix(in_oklch,var(--color-danger)_14%,transparent)] text-danger",
  ctx: "text-fg-muted",
};

const SIGN: Record<DiffOp["type"], string> = { add: "+ ", del: "- ", ctx: "  " };

export function DiffView({
  ops,
  addedLabel,
  removedLabel,
  className,
}: {
  ops: readonly DiffOp[];
  addedLabel?: string;
  removedLabel?: string;
  className?: string;
}) {
  let added = 0;
  let removed = 0;
  for (const op of ops) {
    if (op.type === "add") added++;
    else if (op.type === "del") removed++;
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="success" aria-label={addedLabel}>
          +{added}
        </Badge>
        <Badge variant="danger" aria-label={removedLabel}>
          −{removed}
        </Badge>
      </div>
      <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-border">
        <pre className="min-w-max p-3 font-mono text-xs leading-relaxed">
          {ops.map((op, i) => (
            <div key={i} className={LINE_TONE[op.type]}>
              {SIGN[op.type]}
              {op.line}
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}
