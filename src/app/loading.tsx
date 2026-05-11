import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-6">
      {/* Hero skeleton */}
      <div className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 sm:p-8">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="space-y-3">
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-8 w-72" />
            <Skeleton className="h-4 w-56" />
          </div>
          <div className="flex gap-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex flex-col items-end gap-1">
                <Skeleton className="h-8 w-12" />
                <Skeleton className="h-3 w-14" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Toolbar skeleton */}
      <div className="surface flex flex-col gap-2 p-2 sm:flex-row sm:items-center">
        <Skeleton className="h-9 w-full sm:flex-1" />
        <div className="flex gap-2">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-36" />
          <Skeleton className="h-8 w-16" />
        </div>
      </div>

      {/* Cards skeleton */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="surface flex flex-col gap-3 p-5"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex gap-3">
                <Skeleton className="h-9 w-9 rounded-[var(--radius-md)]" />
                <div className="space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
            <Skeleton className="h-3 w-3/4" />
            <div className="flex items-center justify-between">
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-7 w-20" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
