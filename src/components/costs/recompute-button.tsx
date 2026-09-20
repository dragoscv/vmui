"use client";

import { Button } from "@/components/ui";
import { useAction } from "@/hooks/use-action";
import { err, ok } from "@/lib/action-result";
import { recomputeCostRecommendationsAction } from "@/server/actions/cost-recommendations";
import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";

export function RecomputeButton() {
  const t = useTranslations("cloud.recommendations");
  const { run, pending } = useAction(
    async () => {
      const r = await recomputeCostRecommendationsAction({});
      return r.ok ? ok({ analysed: r.analysed, count: r.count }) : err(r.error);
    },
    { success: (d) => t("recomputed", { analysed: d.analysed, count: d.count }) },
  );
  return (
    <Button size="sm" variant="secondary" loading={pending} onClick={() => void run()}>
      <RefreshCw className="size-4" aria-hidden />
      {t("recompute")}
    </Button>
  );
}
