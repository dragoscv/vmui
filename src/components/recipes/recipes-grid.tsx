"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Play, StopCircle, RefreshCw, Loader2, Eye } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  recipeStopAllRunning,
  recipeStartAllStopped,
  recipeRebootAllRunning,
  recipeDryRun,
  type RecipeResult,
} from "@/server/actions/recipes";

interface Recipe {
  id: "stop-all-running" | "start-all-stopped" | "reboot-all-running";
  label: string;
  description: string;
  icon: typeof Play;
  tone: "danger" | "success" | "warning";
  run: () => Promise<RecipeResult>;
}

const RECIPES: Recipe[] = [
  {
    id: "stop-all-running",
    label: "Stop all running",
    description: "Halt every running VM across every connected account. Saves money fast.",
    icon: StopCircle,
    tone: "danger",
    run: () => recipeStopAllRunning(),
  },
  {
    id: "start-all-stopped",
    label: "Start all stopped",
    description: "Wake every stopped VM. Useful for resuming a paused environment.",
    icon: Play,
    tone: "success",
    run: () => recipeStartAllStopped(),
  },
  {
    id: "reboot-all-running",
    label: "Reboot all running",
    description: "Soft-reboot every running VM. Useful after kernel updates.",
    icon: RefreshCw,
    tone: "warning",
    run: () => recipeRebootAllRunning(),
  },
];

export function RecipesGrid() {
  const [pending, start] = useTransition();
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [preview, setPreview] = useState<Record<string, Awaited<ReturnType<typeof recipeDryRun>>>>({});

  const dryRun = (r: Recipe) => {
    setPreviewing(r.id);
    start(async () => {
      const list = await recipeDryRun(r.id);
      setPreview((p) => ({ ...p, [r.id]: list }));
      setPreviewing(null);
    });
  };

  const execute = (r: Recipe) => {
    if (!confirm(`Run “${r.label}”? This will affect all matching VMs across every account.`)) return;
    start(async () => {
      const res = await r.run();
      if (res.failed.length === 0) toast.success(`${r.label}: ${res.ok}/${res.totalCandidates} succeeded`);
      else toast.error(`${r.label}: ${res.ok} ok, ${res.failed.length} failed`);
    });
  };

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {RECIPES.map((r) => {
        const Icon = r.icon;
        const list = preview[r.id];
        return (
          <Card key={r.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Icon
                  className={
                    r.tone === "danger"
                      ? "h-4 w-4 text-[var(--color-danger)]"
                      : r.tone === "success"
                        ? "h-4 w-4 text-[var(--color-success)]"
                        : "h-4 w-4 text-[var(--color-warning)]"
                  }
                />
                {r.label}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted">{r.description}</p>
              {list && (
                <div className="space-y-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)]/40 p-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Will affect</span>
                    <Badge variant="info">{list.length}</Badge>
                  </div>
                  {list.slice(0, 5).map((i) => (
                    <div key={i.id} className="truncate font-mono text-[10px]">
                      {i.name ?? i.id} <span className="text-muted">· {i.provider}/{i.region}</span>
                    </div>
                  ))}
                  {list.length > 5 && (
                    <div className="text-[10px] text-muted">+ {list.length - 5} more…</div>
                  )}
                </div>
              )}
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => dryRun(r)} disabled={pending}>
                  {previewing === r.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                  Preview
                </Button>
                <Button size="sm" onClick={() => execute(r)} disabled={pending}>
                  Run
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
