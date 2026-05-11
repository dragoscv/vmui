import "server-only";
import type { ProviderId } from "@/lib/providers/types";
import type { NormalizedInstance } from "@/lib/providers/types";

/**
 * Build a deep-link to the cloud provider's web console for a given instance.
 * Returns null when there's no canonical console URL we can construct
 * without extra context (e.g. project name).
 */
export function consoleUrl(providerId: ProviderId, inst: { region: string; providerInstanceId: string; raw?: unknown }): string | null {
  const id = inst.providerInstanceId;
  const region = inst.region;
  switch (providerId) {
    case "aws":
      return `https://${region}.console.aws.amazon.com/ec2/home?region=${region}#InstanceDetails:instanceId=${id}`;
    case "azure": {
      // id shape: "{rg}/{name}" — best-effort, use the resource browser
      const [rg, name] = id.split("/", 2);
      if (!rg || !name) return null;
      return `https://portal.azure.com/#@/resource/subscriptions//resourceGroups/${rg}/providers/Microsoft.Compute/virtualMachines/${name}/overview`;
    }
    case "gcp": {
      // id shape: "{zone}/{name}"
      const [zone, name] = id.split("/", 2);
      if (!zone || !name) return null;
      return `https://console.cloud.google.com/compute/instancesDetail/zones/${zone}/instances/${name}`;
    }
    case "digitalocean":
      return `https://cloud.digitalocean.com/droplets/${id}`;
    case "hetzner":
      return `https://console.hetzner.cloud/projects/_/servers/${id}`;
    case "linode":
      return `https://cloud.linode.com/linodes/${id}`;
    case "vultr":
      return `https://my.vultr.com/subs/?SUBID=${id}`;
    case "scaleway":
      return `https://console.scaleway.com/instance/servers/${region}/${id}/overview`;
    case "ovh":
      return `https://www.ovh.com/manager/public-cloud/`;
    case "fly": {
      const [app, mid] = id.split("/", 2);
      if (!app || !mid) return null;
      return `https://fly.io/apps/${app}/machines/${mid}`;
    }
    case "proxmox": {
      const [node, vmid] = id.split("/", 2);
      if (!node || !vmid) return null;
      return `/proxmox?node=${encodeURIComponent(node)}&vmid=${vmid}`;
    }
    case "local-kvm":
    case "oracle":
    default:
      return null;
  }
}

export function consoleLinkFor(providerId: ProviderId, inst: NormalizedInstance): string | null {
  return consoleUrl(providerId, inst);
}
