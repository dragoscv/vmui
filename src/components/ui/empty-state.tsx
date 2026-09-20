"use client";

import { cn } from "@/lib/utils";
import { motion } from "motion/react";
import * as React from "react";

export function EmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
  className,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-[var(--radius-lg)] border border-dashed border-border px-6 text-center",
        compact ? "py-6" : "py-12",
        className,
      )}
    >
      {icon && (
        <span className="grid size-11 place-items-center rounded-full bg-bg-muted text-muted [&>svg]:size-5" aria-hidden>
          {icon}
        </span>
      )}
      <div className="space-y-1">
        <p className="text-sm font-semibold">{title}</p>
        {description && <p className="mx-auto max-w-sm text-balance text-sm text-muted">{description}</p>}
      </div>
      {action && <div className="mt-1 flex flex-wrap justify-center gap-2">{action}</div>}
    </motion.div>
  );
}
