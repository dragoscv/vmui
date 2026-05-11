import { ExternalLink } from "lucide-react";
import type { ProviderId } from "@/lib/providers/types";
import { consoleUrl } from "@/lib/console-links";

interface Props {
  providerId: ProviderId;
  region: string;
  providerInstanceId: string;
}

export function ConsoleLinkButton({ providerId, region, providerInstanceId }: Props) {
  const url = consoleUrl(providerId, { region, providerInstanceId });
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs hover:bg-zinc-800"
    >
      <ExternalLink className="h-3.5 w-3.5" />
      Open in {providerId === "aws" ? "AWS Console" : providerId === "azure" ? "Azure Portal" : providerId === "gcp" ? "GCP Console" : `${providerId} console`}
    </a>
  );
}
