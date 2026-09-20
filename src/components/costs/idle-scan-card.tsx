"use client";

import { Button, PageSection } from "@/components/ui";
import { findIdleAwsInstances } from "@/server/actions/idle-scan";
import { RefreshCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { IdleHintList, type IdleHint } from "./idle-hint-list";

export function IdleScanCard() {
  const t = useTranslations("cloud.costs.idle");
  const [pending, startTransition] = useTransition();
  const [hints, setHints] = useState<IdleHint[] | null>(null);

  function run() {
    startTransition(async () => {
      try {
        const r = await findIdleAwsInstances();
        setHints(r);
        if (r.length === 0) toast.success(t("noneFound"));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("scanFailed"));
      }
    });
  }

  return (
    <PageSection
      title={t("title")}
      description={t("description")}
      action={
        <Button variant="outline" size="sm" loading={pending} onClick={run}>
          <RefreshCcw className="size-3.5" aria-hidden />
          {hints ? t("rescan") : t("scan")}
        </Button>
      }
    >
      {hints === null ? (
        <p className="text-xs text-muted">{t("intro")}</p>
      ) : hints.length === 0 ? (
        <p className="text-xs text-muted">{t("noneFound")}</p>
      ) : (
        <IdleHintList hints={hints} />
      )}
    </PageSection>
  );
}
