import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { listAccounts } from "@/server/queries";
import { Button } from "@/components/ui/button";
import { CreateInstanceForm } from "@/components/instances/create-form";
import { listBootScriptsAction } from "@/server/actions/boot-scripts";
import { Card, CardContent } from "@/components/ui/card";
import { AwsProvider } from "@/lib/providers/aws";
import { ScalewayProvider } from "@/lib/providers/scaleway";
import { DigitalOceanProvider } from "@/lib/providers/digitalocean";
import { LocalKvmProvider } from "@/lib/providers/local-kvm";
import type { InstanceTemplate, ProviderId } from "@/lib/providers/types";

export const dynamic = "force-dynamic";

export default async function NewInstancePage() {
  const accounts = await listAccounts();
  const bootScripts = await listBootScriptsAction();

  // Pre-fetch templates from each provider (static, no API calls).
  const awsTemplates = await new AwsProvider({
    accessKeyId: "",
    secretAccessKey: "",
    defaultRegion: "us-east-1",
  }).listInstanceTemplates();
  const scalewayTemplates = await new ScalewayProvider({
    secretKey: "",
    projectId: "",
    defaultZone: "fr-par-1",
  }).listInstanceTemplates();
  const digitalOceanTemplates = await new DigitalOceanProvider({
    token: "",
    defaultRegion: "nyc3",
  }).listInstanceTemplates();
  // Aggregate templates across all local-kvm kinds (mac/win/ubuntu) so the
  // create wizard can offer them. Per-kind credentials are placeholders —
  // listInstanceTemplates() doesn't touch the WSL host.
  const localKvmKinds = ["mac", "win", "ubuntu", "hyperv-win"] as const;
  const localKvmTemplates = (
    await Promise.all(
      localKvmKinds.map((kind) =>
        new LocalKvmProvider({
          kind,
          distro: "",
          vmDir: "",
          hostLabel: "",
          vncPort: 5900,
          qmpPort: 4444,
          sshPort: 10022,
          wsPort: 6080,
          ramMb: 16384,
          cores: 4,
          threads: 8,
        }).listInstanceTemplates(),
      ),
    )
  ).flat();

  const templatesByProvider: Record<ProviderId, InstanceTemplate[]> = {
    aws: awsTemplates,
    scaleway: scalewayTemplates,
    "local-kvm": localKvmTemplates,
    azure: [],
    gcp: [],
    digitalocean: digitalOceanTemplates,
  };

  // Static region lists per provider.
  const regionsByProvider: Record<ProviderId, string[]> = {
    aws: [
      "us-east-1", "us-east-2", "us-west-1", "us-west-2",
      "eu-west-1", "eu-west-2", "eu-central-1", "eu-north-1",
      "ap-northeast-1", "ap-southeast-1", "ap-southeast-2", "ap-south-1",
    ],
    scaleway: ["fr-par-1", "fr-par-3"],
    "local-kvm": ["wsl-local"],
    azure: [],
    gcp: [],
    digitalocean: ["nyc1", "nyc3", "sfo3", "ams3", "fra1", "lon1", "tor1", "sgp1", "blr1", "syd1"],
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link href="/">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
      </Button>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Launch a new instance</h1>
        <p className="text-sm text-muted">Pick an account, template, and size. vmui handles the cloud-specific plumbing.</p>
      </div>

      {accounts.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted">
            Connect a cloud account first.
            <div className="mt-3">
              <Button asChild>
                <Link href="/accounts/new">Connect account</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <CreateInstanceForm
          accounts={accounts.map((a) => ({
            id: a.id,
            name: a.name,
            provider: a.provider,
            defaultRegion: a.defaultRegion,
          }))}
          templatesByProvider={templatesByProvider}
          regionsByProvider={regionsByProvider}
          bootScripts={bootScripts.map((s) => ({ id: s.id, name: s.name, kind: s.kind }))}
        />
      )}
    </div>
  );
}
