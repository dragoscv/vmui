import { Button } from "@/components/ui/button";
import { SearchX } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";

export default async function NotFound() {
  const t = await getTranslations("errors");
  return (
    <div className="mx-auto mt-16 flex w-full max-w-md flex-col items-center gap-4 text-center">
      <div className="grid size-12 place-items-center rounded-full bg-[color-mix(in_oklch,var(--color-danger)_12%,transparent)] text-[var(--color-danger)]">
        <SearchX className="size-6" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <h1 className="text-lg font-semibold tracking-tight">{t("notFoundTitle")}</h1>
        <p className="text-sm text-muted">{t("notFoundHint")}</p>
      </div>
      <Button asChild variant="secondary">
        <Link href="/">{t("home")}</Link>
      </Button>
    </div>
  );
}
