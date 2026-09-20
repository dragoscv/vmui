"use client";

import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("errors");
  const tc = useTranslations("common");
  return (
    <div className="mx-auto mt-16 flex w-full max-w-md flex-col items-center gap-4 text-center">
      <div className="grid size-12 place-items-center rounded-full bg-[color-mix(in_oklch,var(--color-danger)_12%,transparent)] text-[var(--color-danger)]">
        <AlertTriangle className="size-6" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <h1 className="text-lg font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted">{t("hint")}</p>
        {error.digest ? (
          <p className="font-mono text-xs text-muted">{t("digest", { id: error.digest })}</p>
        ) : null}
      </div>
      <div className="flex gap-2">
        <Button onClick={reset}>{tc("retry")}</Button>
        <Button asChild variant="secondary">
          <Link href="/">{t("home")}</Link>
        </Button>
      </div>
    </div>
  );
}
