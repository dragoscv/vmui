import { cn } from "@/lib/utils";
import * as React from "react";

export function Kbd({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-[var(--radius-sm)] border border-border bg-bg-muted px-1.5 font-mono text-xs text-muted shadow-[inset_0_-1px_0_var(--color-border)]",
        className,
      )}
      {...props}
    />
  );
}
