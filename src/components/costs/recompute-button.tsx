"use client";

import { useTransition } from "react";
import { RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { recomputeCostRecommendationsAction } from "@/server/actions/cost-recommendations";

export function RecomputeButton() {
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={pending}
      onClick={() => {
        start(async () => {
          const r = await recomputeCostRecommendationsAction({});
          if (!r.ok) {
            toast.error(r.error);
            return;
          }
          toast.success(
            `Analysed ${r.analysed} VM${r.analysed === 1 ? "" : "s"} \u2014 ${r.count} recommendation${r.count === 1 ? "" : "s"}.`,
            { icon: <Sparkles className="h-4 w-4" /> },
          );
        });
      }}
    >
      <RefreshCw className={pending ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
      {pending ? "Analysing..." : "Recompute"}
    </Button>
  );
}
