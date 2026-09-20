import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import * as React from "react";

export type AlertTone = "info" | "success" | "warning" | "danger";

const TONE: Record<AlertTone, { box: string; icon: string; Icon: typeof Info }> = {
  info: {
    box: "bg-[color-mix(in_oklch,var(--color-info)_10%,transparent)] border-[color-mix(in_oklch,var(--color-info)_45%,var(--color-border))]",
    icon: "text-info",
    Icon: Info,
  },
  success: {
    box: "bg-[color-mix(in_oklch,var(--color-success)_10%,transparent)] border-[color-mix(in_oklch,var(--color-success)_45%,var(--color-border))]",
    icon: "text-success",
    Icon: CheckCircle2,
  },
  warning: {
    box: "bg-[color-mix(in_oklch,var(--color-warning)_10%,transparent)] border-[color-mix(in_oklch,var(--color-warning)_45%,var(--color-border))]",
    icon: "text-warning",
    Icon: AlertTriangle,
  },
  danger: {
    box: "bg-[color-mix(in_oklch,var(--color-danger)_10%,transparent)] border-[color-mix(in_oklch,var(--color-danger)_45%,var(--color-border))]",
    icon: "text-danger",
    Icon: XCircle,
  },
};

export function Alert({
  tone = "info",
  title,
  children,
  icon,
  action,
  className,
}: {
  tone?: AlertTone;
  title?: React.ReactNode;
  children?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  const t = TONE[tone];
  const role = tone === "warning" || tone === "danger" ? "alert" : "status";
  return (
    <div role={role} className={cn("flex items-start gap-3 rounded-[var(--radius-lg)] border p-3 text-sm", t.box, className)}>
      <span className={cn("mt-0.5 shrink-0 [&>svg]:size-4", t.icon)} aria-hidden>
        {icon ?? <t.Icon />}
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title && "text-muted")}>{children}</div>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}
