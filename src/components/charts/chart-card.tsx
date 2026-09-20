"use client";

import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { BarChart3 } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";

export interface ChartCardProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  /** Body height in px. */
  height?: number;
  loading?: boolean;
  /** When true the body renders a compact EmptyState instead of children. */
  empty?: boolean;
  emptyTitle?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}

export function ChartCard({ title, description, action, height = 220, loading = false, empty = false, emptyTitle, className, children }: ChartCardProps) {
  const t = useTranslations("common");
  const id = React.useId();
  return (
    <section aria-labelledby={`${id}-title`} className={cn("surface flex flex-col p-4", className)}>
      <header className="mb-3 flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1 basis-[10rem]">
          <h3 id={`${id}-title`} className="truncate text-sm font-semibold">
            {title}
          </h3>
          {description && <p className="mt-0.5 text-xs leading-snug text-fg-muted">{description}</p>}
        </div>
        {action && <div className="flex min-w-0 flex-wrap items-center gap-2 sm:shrink-0">{action}</div>}
      </header>
      <div className="relative min-w-0" style={{ height }}>
        {loading ? (
          <Skeleton className="h-full w-full rounded-[var(--radius-md)]" />
        ) : empty ? (
          <EmptyState compact icon={<BarChart3 />} title={emptyTitle ?? t("noResults")} className="h-full" />
        ) : (
          children
        )}
      </div>
    </section>
  );
}
