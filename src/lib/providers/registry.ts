import "server-only";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { cloudAccounts } from "../db/schema";
import { decryptJSON } from "../crypto";
import { AwsProvider, type AwsCredentials } from "./aws";
import { ScalewayProvider, type ScalewayCredentials } from "./scaleway";
import { LocalKvmProvider, type LocalKvmCredentials, KIND_DEFAULTS } from "./local-kvm";
import { AzureProvider, type AzureCredentials } from "./azure";
import { GcpProvider, type GcpCredentials } from "./gcp";
import { DigitalOceanProvider, type DigitalOceanCredentials } from "./digitalocean";
import { HetznerProvider, type HetznerCredentials } from "./hetzner";
import { LinodeProvider, type LinodeCredentials } from "./linode";
import { VultrProvider, type VultrCredentials } from "./vultr";
import { ProxmoxProvider, type ProxmoxCredentials } from "./proxmox";
import { OvhProvider, type OvhCredentials } from "./ovh";
import { FlyProvider, type FlyCredentials } from "./fly";
import type { CloudProvider, ProviderId } from "./types";

/**
 * Loads a CloudProvider instance for the given saved cloud_account row.
 * Decrypts credentials with the master key.
 */
export async function getProvider(accountId: string): Promise<{
  provider: CloudProvider;
  account: typeof cloudAccounts.$inferSelect;
}> {
  const row = await db.query.cloudAccounts.findFirst({
    where: eq(cloudAccounts.id, accountId),
  });
  if (!row) throw new Error(`Cloud account not found: ${accountId}`);

  const provider = buildProvider(row.provider as ProviderId, row.credentialsEnc, row.defaultRegion);
  return { provider, account: row };
}

function buildProvider(
  providerId: ProviderId,
  credentialsEnc: string,
  defaultRegion: string | null,
): CloudProvider {
  switch (providerId) {
    case "aws": {
      const creds = decryptJSON<Omit<AwsCredentials, "defaultRegion">>(credentialsEnc);
      return new AwsProvider({
        ...creds,
        defaultRegion: defaultRegion ?? "us-east-1",
      });
    }
    case "scaleway": {
      const creds = decryptJSON<Omit<ScalewayCredentials, "defaultZone">>(credentialsEnc);
      return new ScalewayProvider({
        ...creds,
        defaultZone: defaultRegion ?? "fr-par-1",
      });
    }
    case "local-kvm": {
      const creds = decryptJSON<Partial<LocalKvmCredentials>>(credentialsEnc);
      // Backfill defaults for credentials saved before a field was added.
      // Existing accounts without `kind` were all macOS, so default to "mac"
      // to preserve their behavior on upgrade.
      const kind = (creds.kind ?? "mac") as LocalKvmCredentials["kind"];
      const d = KIND_DEFAULTS[kind];
      return new LocalKvmProvider({
        kind,
        distro: creds.distro ?? "Ubuntu-24.04",
        vmDir: creds.vmDir ?? d.vmDir,
        hostLabel: creds.hostLabel ?? d.hostLabelHint,
        vncPort: creds.vncPort ?? d.vncPort,
        qmpPort: creds.qmpPort ?? d.qmpPort,
        sshPort: creds.sshPort ?? d.sshPort,
        wsPort: creds.wsPort ?? d.wsPort,
        ramMb: creds.ramMb ?? d.ramMb,
        cores: creds.cores ?? d.cores,
        threads: creds.threads ?? d.threads,
        osUsername: creds.osUsername,
        osPassword: creds.osPassword,
        hypervVmName: creds.hypervVmName,
      });
    }
    case "azure": {
      const creds = decryptJSON<Omit<AzureCredentials, "defaultLocation">>(credentialsEnc);
      return new AzureProvider({ ...creds, defaultLocation: defaultRegion ?? "westeurope" });
    }
    case "gcp": {
      const creds = decryptJSON<Omit<GcpCredentials, "defaultZone">>(credentialsEnc);
      return new GcpProvider({ ...creds, defaultZone: defaultRegion ?? "us-central1-a" });
    }
    case "digitalocean": {
      const creds = decryptJSON<Omit<DigitalOceanCredentials, "defaultRegion">>(credentialsEnc);
      return new DigitalOceanProvider({ ...creds, defaultRegion: defaultRegion ?? "nyc3" });
    }
    case "hetzner": {
      const creds = decryptJSON<Omit<HetznerCredentials, "defaultRegion">>(credentialsEnc);
      return new HetznerProvider({ ...creds, defaultRegion: defaultRegion ?? "nbg1" });
    }
    case "linode": {
      const creds = decryptJSON<Omit<LinodeCredentials, "defaultRegion">>(credentialsEnc);
      return new LinodeProvider({ ...creds, defaultRegion: defaultRegion ?? "us-east" });
    }
    case "vultr": {
      const creds = decryptJSON<Omit<VultrCredentials, "defaultRegion">>(credentialsEnc);
      return new VultrProvider({ ...creds, defaultRegion: defaultRegion ?? "ewr" });
    }
    case "proxmox": {
      const creds = decryptJSON<Omit<ProxmoxCredentials, "defaultRegion">>(credentialsEnc);
      return new ProxmoxProvider({ ...creds, defaultRegion: defaultRegion ?? "pve" });
    }
    case "ovh": {
      const creds = decryptJSON<Omit<OvhCredentials, "defaultRegion">>(credentialsEnc);
      return new OvhProvider({ ...creds, defaultRegion: defaultRegion ?? "GRA9" });
    }
    case "fly": {
      const creds = decryptJSON<Omit<FlyCredentials, "defaultRegion">>(credentialsEnc);
      return new FlyProvider({ ...creds, defaultRegion: defaultRegion ?? "ord" });
    }
    case "oracle":
      throw new Error(`Provider '${providerId}' is registered but its driver is not yet implemented. See docs for a roadmap.`);
    default:
      throw new Error(`Unknown provider: ${providerId}`);
  }
}

export function listSupportedProviders(): { id: ProviderId; label: string; available: boolean }[] {
  return [
    { id: "aws", label: "Amazon Web Services", available: true },
    { id: "scaleway", label: "Scaleway (Apple Silicon)", available: true },
    { id: "local-kvm", label: "Local · KVM (WSL2)", available: true },
    { id: "azure", label: "Microsoft Azure", available: true },
    { id: "gcp", label: "Google Cloud Platform", available: true },
    { id: "digitalocean", label: "DigitalOcean", available: true },
    { id: "hetzner", label: "Hetzner Cloud", available: true },
    { id: "linode", label: "Linode (Akamai)", available: true },
    { id: "vultr", label: "Vultr", available: true },
    { id: "proxmox", label: "Proxmox VE (self-hosted)", available: true },
    { id: "ovh", label: "OVHcloud", available: true },
    { id: "oracle", label: "Oracle Cloud Infrastructure", available: false },
    { id: "fly", label: "Fly.io", available: true },
  ];
}
