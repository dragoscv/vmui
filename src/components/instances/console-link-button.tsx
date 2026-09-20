import { Button } from "@/components/ui/button";
import { consoleUrl } from "@/lib/console-links";
import type { ProviderId } from "@/lib/providers/types";
import { ExternalLink } from "lucide-react";
import { getTranslations } from "next-intl/server";

interface Props {
  providerId: ProviderId;
  region: string;
  providerInstanceId: string;
}

export async function ConsoleLinkButton({ providerId, region, providerInstanceId }: Props) {
  const t = await getTranslations("vm.actions.console");
  const url = consoleUrl(providerId, { region, providerInstanceId });
  if (!url) return null;
  const consoleName =
    providerId === "aws" || providerId === "azure" || providerId === "gcp"
      ? t(providerId)
      : t("other", { provider: providerId });
  return (
    <Button asChild variant="outline" size="sm">
      <a href={url} target="_blank" rel="noopener noreferrer">
        <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        {t("open", { console: consoleName })}
      </a>
    </Button>
  );
}
