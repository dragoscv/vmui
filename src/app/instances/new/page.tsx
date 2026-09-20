import { CreateInstanceForm } from "@/components/instances/create-form";
import { Button, EmptyState, PageHeader, PageShell } from "@/components/ui";
import { AwsProvider } from "@/lib/providers/aws";
import { DigitalOceanProvider } from "@/lib/providers/digitalocean";
import { HetznerProvider } from "@/lib/providers/hetzner";
import { LocalKvmProvider } from "@/lib/providers/local-kvm";
import { ScalewayProvider } from "@/lib/providers/scaleway";
import type { InstanceTemplate, ProviderId } from "@/lib/providers/types";
import { listBootScriptsAction } from "@/server/actions/boot-scripts";
import { listAccounts } from "@/server/queries";
import { Cloud, Server } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function NewInstancePage() {
  const [accounts, bootScripts, t] = await Promise.all([listAccounts(), listBootScriptsAction(), getTranslations("vm.new")]);

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
  const hetznerTemplates = await new HetznerProvider({
    token: "",
    defaultRegion: "nbg1",
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
    hetzner: hetznerTemplates,
    linode: [],
    vultr: [],
    ovh: [],
    oracle: [],
    fly: [],
    proxmox: [],
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
    hetzner: ["nbg1", "fsn1", "hel1", "ash", "hil", "sin"],
    linode: ["us-east", "us-west", "us-central", "us-southeast", "eu-west", "eu-central", "ap-south", "ap-northeast", "ap-southeast"],
    vultr: [],
    ovh: [],
    oracle: [],
    fly: [],
    proxmox: [],
  };

  return (
    <PageShell width="narrow">
      <PageHeader
        title={t("title")}
        description={t("description")}
        icon={<Server />}
        breadcrumbs={
          <nav aria-label={t("title")} className="flex items-center gap-1">
            <Link href="/" className="hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              {t("back")}
            </Link>
            <span aria-hidden>/</span>
            <span aria-current="page" className="text-fg">
              {t("title")}
            </span>
          </nav>
        }
      />

      {accounts.length === 0 ? (
        <EmptyState
          icon={<Cloud />}
          title={t("noAccountsTitle")}
          description={t("noAccountsDescription")}
          action={
            <Button asChild>
              <Link href="/accounts/new">{t("connectAccount")}</Link>
            </Button>
          }
        />
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
    </PageShell>
  );
}
