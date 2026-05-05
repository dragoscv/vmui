import "server-only";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { cloudAccounts } from "../db/schema";
import { decryptJSON } from "../crypto";
import { AwsProvider, type AwsCredentials } from "./aws";
import { ScalewayProvider, type ScalewayCredentials } from "./scaleway";
import { LocalKvmProvider, type LocalKvmCredentials } from "./local-kvm";
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
      return new LocalKvmProvider({
        distro: creds.distro ?? "Ubuntu-24.04",
        vmDir: creds.vmDir ?? "/home/dragos/OSX-KVM",
        hostLabel: creds.hostLabel ?? "Local Mac",
        vncPort: creds.vncPort ?? 5900,
        qmpPort: creds.qmpPort ?? 4444,
        sshPort: creds.sshPort ?? 10022,
        wsPort: creds.wsPort ?? 6080,
        ramMb: creds.ramMb ?? 16384,
        cores: creds.cores ?? 4,
        threads: creds.threads ?? 8,
      });
    }
    case "azure":
    case "gcp":
      throw new Error(`${providerId} provider not implemented yet`);
    default:
      throw new Error(`Unknown provider: ${providerId}`);
  }
}

export function listSupportedProviders(): { id: ProviderId; label: string; available: boolean }[] {
  return [
    { id: "aws", label: "Amazon Web Services", available: true },
    { id: "scaleway", label: "Scaleway (Apple Silicon)", available: true },
    { id: "local-kvm", label: "Local · KVM (WSL2)", available: true },
    { id: "azure", label: "Microsoft Azure", available: false },
    { id: "gcp", label: "Google Cloud Platform", available: false },
  ];
}
