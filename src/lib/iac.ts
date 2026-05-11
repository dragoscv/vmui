/**
 * "Show as code" — render an instance + a per-action CLI / Terraform snippet
 * the user can copy-paste. Pure functions over a small subset of fields so we
 * don't pull rawJson back through the pipeline. Snippets are best-effort and
 * deliberately simple; they're for copy-paste, not round-trip parity.
 */

import type { ProviderId } from "@/lib/providers/types";

export type Action = "start" | "stop" | "reboot" | "terminate";

export interface InstanceCodeContext {
  provider: ProviderId;
  region: string;
  providerInstanceId: string;
  name?: string | null;
  instanceType?: string | null;
  platform?: "linux" | "windows" | "macos";
}

/* ---------- CLI ---------- */

export function cliFor(action: Action, ctx: InstanceCodeContext): string {
  const id = ctx.providerInstanceId;
  switch (ctx.provider) {
    case "aws": {
      const map: Record<Action, string> = {
        start: `aws ec2 start-instances --instance-ids ${id} --region ${ctx.region}`,
        stop: `aws ec2 stop-instances --instance-ids ${id} --region ${ctx.region}`,
        reboot: `aws ec2 reboot-instances --instance-ids ${id} --region ${ctx.region}`,
        terminate: `aws ec2 terminate-instances --instance-ids ${id} --region ${ctx.region}`,
      };
      return map[action];
    }
    case "azure": {
      // id is "{resourceGroup}/{name}" — split safely.
      const [rg, vm] = id.split("/", 2);
      const flag = rg && vm ? `--resource-group ${rg} --name ${vm}` : `--ids ${id}`;
      const map: Record<Action, string> = {
        start: `az vm start ${flag}`,
        stop: `az vm deallocate ${flag}`,
        reboot: `az vm restart ${flag}`,
        terminate: `az vm delete ${flag} --yes`,
      };
      return map[action];
    }
    case "gcp": {
      // id is "{zone}/{name}".
      const [zone, vm] = id.split("/", 2);
      const target = vm ?? id;
      const zoneFlag = zone ? `--zone ${zone}` : `--zone ${ctx.region}`;
      const map: Record<Action, string> = {
        start: `gcloud compute instances start ${target} ${zoneFlag}`,
        stop: `gcloud compute instances stop ${target} ${zoneFlag}`,
        reboot: `gcloud compute instances reset ${target} ${zoneFlag}`,
        terminate: `gcloud compute instances delete ${target} ${zoneFlag} --quiet`,
      };
      return map[action];
    }
    case "scaleway": {
      const map: Record<Action, string> = {
        start: `scw baremetal server start ${id} zone=${ctx.region}`,
        stop: `scw baremetal server stop ${id} zone=${ctx.region}`,
        reboot: `scw baremetal server reboot ${id} zone=${ctx.region}`,
        terminate: `scw baremetal server delete ${id} zone=${ctx.region}`,
      };
      return map[action];
    }
    case "digitalocean": {
      const map: Record<Action, string> = {
        start: `doctl compute droplet-action power-on ${id}`,
        stop: `doctl compute droplet-action shutdown ${id}`,
        reboot: `doctl compute droplet-action reboot ${id}`,
        terminate: `doctl compute droplet delete ${id} --force`,
      };
      return map[action];
    }
    case "hetzner": {
      const map: Record<Action, string> = {
        start: `hcloud server poweron ${id}`,
        stop: `hcloud server shutdown ${id}`,
        reboot: `hcloud server reboot ${id}`,
        terminate: `hcloud server delete ${id}`,
      };
      return map[action];
    }
    case "local-kvm": {
      const map: Record<Action, string> = {
        start: `virsh start ${ctx.name ?? id}`,
        stop: `virsh shutdown ${ctx.name ?? id}`,
        reboot: `virsh reboot ${ctx.name ?? id}`,
        terminate: `virsh destroy ${ctx.name ?? id} && virsh undefine ${ctx.name ?? id}`,
      };
      return map[action];
    }
  }
}

/* ---------- Terraform ---------- */

function tfId(s: string): string {
  return s.replace(/[^a-zA-Z0-9_]/g, "_");
}

export function terraformFor(ctx: InstanceCodeContext): string {
  const resName = tfId(ctx.name || ctx.providerInstanceId);
  const it = ctx.instanceType ?? "t3.micro";
  switch (ctx.provider) {
    case "aws":
      return [
        `# Approximate — adjust ami, vpc, subnet, sg as needed.`,
        `resource "aws_instance" "${resName}" {`,
        `  ami           = "ami-xxxxxxxxxxxxxxxxx" # set via data source`,
        `  instance_type = "${it}"`,
        `  # Imported from vmui: id=${ctx.providerInstanceId} region=${ctx.region}`,
        `  tags = {`,
        `    Name = "${ctx.name ?? ctx.providerInstanceId}"`,
        `  }`,
        `}`,
        ``,
        `# Import with:`,
        `# terraform import aws_instance.${resName} ${ctx.providerInstanceId}`,
      ].join("\n");
    case "azure": {
      const [rg, vm] = ctx.providerInstanceId.split("/", 2);
      return [
        `resource "azurerm_linux_virtual_machine" "${resName}" {`,
        `  name                = "${vm ?? resName}"`,
        `  resource_group_name = "${rg ?? "rg"}"`,
        `  location            = "${ctx.region}"`,
        `  size                = "${it}"`,
        `  # network_interface_ids = [...]`,
        `  # admin_username = "azureuser"`,
        `}`,
        ``,
        `# Import with:`,
        `# terraform import azurerm_linux_virtual_machine.${resName} /subscriptions/{sub}/resourceGroups/${rg ?? "rg"}/providers/Microsoft.Compute/virtualMachines/${vm ?? resName}`,
      ].join("\n");
    }
    case "gcp": {
      const [zone, vm] = ctx.providerInstanceId.split("/", 2);
      return [
        `resource "google_compute_instance" "${resName}" {`,
        `  name         = "${vm ?? resName}"`,
        `  machine_type = "${it}"`,
        `  zone         = "${zone ?? ctx.region}"`,
        `  boot_disk {`,
        `    initialize_params {`,
        `      image = "debian-cloud/debian-12"`,
        `    }`,
        `  }`,
        `  network_interface {`,
        `    network = "default"`,
        `    access_config {}`,
        `  }`,
        `}`,
        ``,
        `# Import with:`,
        `# terraform import google_compute_instance.${resName} projects/{project}/zones/${zone ?? ctx.region}/instances/${vm ?? resName}`,
      ].join("\n");
    }
    case "scaleway":
      return [
        `# Scaleway bare-metal Mac minis aren't fully expressible in Terraform.`,
        `# Use the Scaleway CLI or API; vmui shows the equivalent CLI command above.`,
        `# server_id = "${ctx.providerInstanceId}" zone = "${ctx.region}"`,
      ].join("\n");
    case "digitalocean":
      return [
        `resource "digitalocean_droplet" "${resName}" {`,
        `  name   = "${ctx.name ?? resName}"`,
        `  size   = "${it}"`,
        `  image  = "ubuntu-22-04-x64"`,
        `  region = "${ctx.region}"`,
        `}`,
        ``,
        `# Import with:`,
        `# terraform import digitalocean_droplet.${resName} ${ctx.providerInstanceId}`,
      ].join("\n");
    case "hetzner":
      return [
        `resource "hcloud_server" "${resName}" {`,
        `  name        = "${ctx.name ?? resName}"`,
        `  server_type = "${it}"`,
        `  image       = "ubuntu-24.04"`,
        `  location    = "${ctx.region}"`,
        `}`,
        ``,
        `# Import with:`,
        `# terraform import hcloud_server.${resName} ${ctx.providerInstanceId}`,
      ].join("\n");
    case "local-kvm":
      return [
        `# Local KVM domains are managed by libvirt, not Terraform by default.`,
        `# See terraform-provider-libvirt if you want IaC for local VMs.`,
      ].join("\n");
  }
}
