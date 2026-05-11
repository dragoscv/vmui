import "server-only";

export interface ProviderStatus {
  id: string;
  label: string;
  url: string;
  state: "ok" | "incident" | "unknown";
  latencyMs: number | null;
  fetchedAt: string;
}

const TARGETS: { id: string; label: string; url: string }[] = [
  { id: "aws", label: "AWS Health Dashboard", url: "https://health.aws.amazon.com/health/status" },
  { id: "azure", label: "Azure Status", url: "https://status.azure.com/en-us/status" },
  { id: "gcp", label: "GCP Status", url: "https://status.cloud.google.com/" },
  { id: "digitalocean", label: "DigitalOcean Status", url: "https://status.digitalocean.com/" },
  { id: "hetzner", label: "Hetzner Status", url: "https://status.hetzner.com/" },
  { id: "linode", label: "Linode Status", url: "https://status.linode.com/" },
  { id: "vultr", label: "Vultr Status", url: "https://www.vultr-status.com/" },
  { id: "scaleway", label: "Scaleway Status", url: "https://status.scaleway.com/" },
  { id: "ovh", label: "OVHcloud Status", url: "https://status.ovh.com/" },
  { id: "fly", label: "Fly.io Status", url: "https://status.flyio.net/" },
  { id: "oracle", label: "OCI Status", url: "https://ocistatus.oraclecloud.com/" },
];

export async function getProviderStatuses(): Promise<ProviderStatus[]> {
  const results = await Promise.all(TARGETS.map(async (t) => {
    const started = Date.now();
    try {
      const res = await fetch(t.url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(5_000) });
      return {
        ...t,
        state: res.ok ? "ok" as const : "incident" as const,
        latencyMs: Date.now() - started,
        fetchedAt: new Date().toISOString(),
      };
    } catch {
      return { ...t, state: "unknown" as const, latencyMs: null, fetchedAt: new Date().toISOString() };
    }
  }));
  return results;
}
