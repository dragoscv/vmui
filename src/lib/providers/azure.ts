import "server-only";
import { ClientSecretCredential } from "@azure/identity";
import { ComputeManagementClient, type VirtualMachine } from "@azure/arm-compute";
import { NetworkManagementClient } from "@azure/arm-network";
import { StorageManagementClient } from "@azure/arm-storage";
import { SqlManagementClient } from "@azure/arm-sql";
import { DnsManagementClient } from "@azure/arm-dns";
import { SubscriptionClient } from "@azure/arm-resources-subscriptions";
import type {
  CloudProvider,
  ConnectionInfo,
  CreateInstanceInput,
  InstanceLogChunk,
  InstanceTemplate,
  MetricSeries,
  MetricsHistory,
  NormalizedInstance,
  NormalizedResource,
  NormalizedState,
  Platform,
  ProviderAccountInfo,
  ResourceKind,
} from "./types";

export interface AzureCredentials {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  subscriptionId: string;
  /** Default location, e.g. "westeurope". */
  defaultLocation?: string;
}

const TEMPLATES: InstanceTemplate[] = [
  {
    id: "azure-ubuntu-22.04",
    label: "Ubuntu Server 22.04 LTS",
    platform: "linux",
    description: "Standard Linux VM (Canonical: Ubuntu 22.04 LTS gen2).",
    recommendedTypes: ["Standard_B2s", "Standard_D2s_v5", "Standard_D4s_v5"],
  },
  {
    id: "azure-windows-2022",
    label: "Windows Server 2022",
    platform: "windows",
    description: "Standard Windows Server with RDP enabled.",
    recommendedTypes: ["Standard_B2ms", "Standard_D2s_v5", "Standard_D4s_v5"],
    notes: ["RDP exposed on port 3389. vmui will generate an .rdp file."],
  },
];

/**
 * Map Azure power-state codes to our normalized state. The PowerStates code
 * usually shows up as one of the instanceView statuses with a `code` like
 * "PowerState/running".
 */
function mapPowerState(code: string | undefined): NormalizedState {
  switch (code) {
    case "PowerState/running":
      return "running";
    case "PowerState/starting":
      return "pending";
    case "PowerState/stopping":
      return "stopping";
    case "PowerState/stopped":
    case "PowerState/deallocated":
    case "PowerState/deallocating":
      return "stopped";
    default:
      return "unknown";
  }
}

function detectPlatform(vm: VirtualMachine): Platform {
  const os = vm.storageProfile?.osDisk?.osType?.toString().toLowerCase();
  if (os === "windows") return "windows";
  return "linux";
}

/**
 * Azure VM identifier: Azure stores VMs as
 *   /subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Compute/virtualMachines/{name}
 * We use "{rg}/{name}" as our providerInstanceId — short and uniquely
 * addressable within a subscription.
 */
function vmIdFrom(vm: VirtualMachine): { rg: string; name: string; id: string } | null {
  const id = vm.id;
  if (!id || !vm.name) return null;
  const m = id.match(/resourceGroups\/([^/]+)\/providers\/Microsoft\.Compute\/virtualMachines\/([^/]+)/i);
  if (!m) return null;
  return { rg: m[1]!, name: m[2]!, id: `${m[1]}/${m[2]}` };
}

function parseShortId(short: string): { rg: string; name: string } {
  const slash = short.indexOf("/");
  if (slash < 0) throw new Error(`Bad Azure VM id: ${short}`);
  return { rg: short.slice(0, slash), name: short.slice(slash + 1) };
}

export class AzureProvider implements CloudProvider {
  readonly id = "azure" as const;
  private readonly creds: AzureCredentials;

  constructor(creds: AzureCredentials) {
    this.creds = creds;
  }

  private credential() {
    return new ClientSecretCredential(this.creds.tenantId, this.creds.clientId, this.creds.clientSecret);
  }
  private compute(): ComputeManagementClient {
    return new ComputeManagementClient(this.credential(), this.creds.subscriptionId);
  }
  private network(): NetworkManagementClient {
    return new NetworkManagementClient(this.credential(), this.creds.subscriptionId);
  }
  private storage(): StorageManagementClient {
    return new StorageManagementClient(this.credential(), this.creds.subscriptionId);
  }
  private sql(): SqlManagementClient {
    return new SqlManagementClient(this.credential(), this.creds.subscriptionId);
  }
  private dns(): DnsManagementClient {
    return new DnsManagementClient(this.credential(), this.creds.subscriptionId);
  }

  async verify(): Promise<ProviderAccountInfo> {
    const sc = new SubscriptionClient(this.credential());
    const sub = await sc.subscriptions.get(this.creds.subscriptionId);
    return {
      accountId: sub.subscriptionId ?? this.creds.subscriptionId,
      label: sub.displayName ?? `Azure subscription ${this.creds.subscriptionId}`,
    };
  }

  async listRegions(): Promise<string[]> {
    const sc = new SubscriptionClient(this.credential());
    const out: string[] = [];
    for await (const loc of sc.subscriptions.listLocations(this.creds.subscriptionId)) {
      if (loc.name) out.push(loc.name);
    }
    return out.sort();
  }

  async listInstances(_region: string): Promise<NormalizedInstance[]> {
    // Azure lets us list across the whole subscription cheaply; we then
    // bucket by location for downstream consumers. The `region` arg is
    // ignored on purpose — we always sync everything.
    const compute = this.compute();
    const network = this.network();
    const out: NormalizedInstance[] = [];

    for await (const vm of compute.virtualMachines.listAll()) {
      const ident = vmIdFrom(vm);
      if (!ident) continue;

      // Power state requires a separate instanceView call.
      let state: NormalizedState = "unknown";
      try {
        const view = await compute.virtualMachines.instanceView(ident.rg, ident.name);
        const ps = view.statuses?.find((s) => s.code?.startsWith("PowerState/"))?.code;
        state = mapPowerState(ps);
      } catch {
        /* ignore — leave unknown */
      }

      // Public IP (if any) requires walking NIC → publicIp resources.
      let publicIp: string | null = null;
      let privateIp: string | null = null;
      try {
        const nicRef = vm.networkProfile?.networkInterfaces?.[0]?.id;
        if (nicRef) {
          const nicMatch = nicRef.match(/resourceGroups\/([^/]+)\/.*\/networkInterfaces\/([^/]+)/i);
          if (nicMatch) {
            const nic = await network.networkInterfaces.get(nicMatch[1]!, nicMatch[2]!);
            const ipCfg = nic.ipConfigurations?.[0];
            privateIp = ipCfg?.privateIPAddress ?? null;
            const pipRef = ipCfg?.publicIPAddress?.id;
            if (pipRef) {
              const pipMatch = pipRef.match(/resourceGroups\/([^/]+)\/.*\/publicIPAddresses\/([^/]+)/i);
              if (pipMatch) {
                const pip = await network.publicIPAddresses.get(pipMatch[1]!, pipMatch[2]!);
                publicIp = pip.ipAddress ?? null;
              }
            }
          }
        }
      } catch {
        /* network resolution best-effort */
      }

      out.push({
        providerInstanceId: ident.id,
        region: vm.location ?? "unknown",
        name: vm.name ?? null,
        state,
        platform: detectPlatform(vm),
        instanceType: vm.hardwareProfile?.vmSize ?? null,
        publicIp,
        publicDns: null,
        privateIp,
        keyName: null,
        raw: vm,
      });
    }
    return out;
  }

  async getInstance(_region: string, id: string): Promise<NormalizedInstance | null> {
    const list = await this.listInstances(_region);
    return list.find((i) => i.providerInstanceId === id) ?? null;
  }

  async startInstance(_region: string, id: string): Promise<void> {
    const { rg, name } = parseShortId(id);
    await this.compute().virtualMachines.beginStartAndWait(rg, name);
  }
  async stopInstance(_region: string, id: string): Promise<void> {
    const { rg, name } = parseShortId(id);
    // Use deallocate so we stop billing for compute (Azure charges stopped-but-allocated VMs).
    await this.compute().virtualMachines.beginDeallocateAndWait(rg, name);
  }
  async rebootInstance(_region: string, id: string): Promise<void> {
    const { rg, name } = parseShortId(id);
    await this.compute().virtualMachines.beginRestartAndWait(rg, name);
  }
  async terminateInstance(_region: string, id: string): Promise<void> {
    const { rg, name } = parseShortId(id);
    await this.compute().virtualMachines.beginDeleteAndWait(rg, name);
  }

  async applyTags(_region: string, id: string, tags: Record<string, string>): Promise<void> {
    const { rg, name } = parseShortId(id);
    await this.compute().virtualMachines.beginUpdateAndWait(rg, name, { tags });
  }

  async createSnapshot(
    region: string,
    id: string,
    label: string,
  ): Promise<{ snapshotId: string; note?: string }> {
    const { rg, name } = parseShortId(id);
    const compute = this.compute();
    const vm = await compute.virtualMachines.get(rg, name);
    const osDiskId = vm.storageProfile?.osDisk?.managedDisk?.id;
    if (!osDiskId) {
      throw new Error("VM has no managed OS disk to snapshot.");
    }
    const location = (vm.location || region || this.creds.defaultLocation || "").toLowerCase();
    if (!location) throw new Error("Could not determine VM location for snapshot.");
    const safeLabel = label.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 60);
    const snapName = `${name}-${safeLabel}-${Date.now()}`.slice(0, 80);
    const result = await compute.snapshots.beginCreateOrUpdateAndWait(rg, snapName, {
      location,
      creationData: { createOption: "Copy", sourceResourceId: osDiskId },
      incremental: true,
    });
    return { snapshotId: result.id ?? snapName, note: `Snapshot of OS disk in ${rg}.` };
  }

  async deleteSnapshot(_region: string, snapshotId: string): Promise<void> {
    // Accept either a full ARM resource id or `{rg}/{name}` short form.
    let rg: string;
    let name: string;
    if (snapshotId.startsWith("/subscriptions/")) {
      const parts = snapshotId.split("/");
      const rgIdx = parts.findIndex((p) => p.toLowerCase() === "resourcegroups");
      const snapIdx = parts.findIndex((p) => p.toLowerCase() === "snapshots");
      if (rgIdx === -1 || snapIdx === -1) throw new Error(`Could not parse Azure snapshot id: ${snapshotId}`);
      rg = parts[rgIdx + 1] ?? "";
      name = parts[snapIdx + 1] ?? "";
    } else {
      const parsed = parseShortId(snapshotId);
      rg = parsed.rg;
      name = parsed.name;
    }
    if (!rg || !name) throw new Error(`Could not parse Azure snapshot id: ${snapshotId}`);
    await this.compute().snapshots.beginDeleteAndWait(rg, name);
  }

  async getMetricsHistory(
    _region: string,
    id: string,
    rangeMinutes: number,
  ): Promise<MetricsHistory> {
    const { rg, name } = parseShortId(id);
    const cred = this.credential();
    const token = await cred.getToken("https://management.azure.com/.default");
    if (!token?.token) throw new Error("Could not acquire Azure access token");
    const end = new Date();
    const start = new Date(end.getTime() - rangeMinutes * 60_000);
    // Azure Monitor supports PT1M, PT5M, PT15M, PT30M, PT1H, PT6H, PT12H, P1D
    const stepSeconds = rangeMinutes <= 60 ? 60 : rangeMinutes <= 6 * 60 ? 300 : rangeMinutes <= 24 * 60 ? 900 : 3600;
    const interval =
      stepSeconds === 60 ? "PT1M" : stepSeconds === 300 ? "PT5M" : stepSeconds === 900 ? "PT15M" : "PT1H";
    const metricNames = [
      "Percentage CPU",
      "Network In Total",
      "Network Out Total",
      "Disk Read Bytes",
      "Disk Write Bytes",
    ].join(",");
    const resourceUri = `/subscriptions/${this.creds.subscriptionId}/resourceGroups/${rg}/providers/Microsoft.Compute/virtualMachines/${name}`;
    const url =
      `https://management.azure.com${resourceUri}/providers/Microsoft.Insights/metrics` +
      `?api-version=2019-07-01` +
      `&timespan=${start.toISOString()}/${end.toISOString()}` +
      `&interval=${interval}` +
      `&metricnames=${encodeURIComponent(metricNames)}` +
      `&aggregation=Average`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token.token}` } });
    if (!res.ok) throw new Error(`Azure Monitor: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as {
      value?: Array<{
        name?: { value?: string };
        timeseries?: Array<{ data?: Array<{ timeStamp: string; average?: number | null }> }>;
      }>;
    };

    const pickPoints = (metric: string): { t: number; v: number | null }[] => {
      const m = body.value?.find((x) => x.name?.value === metric);
      const data = m?.timeseries?.[0]?.data ?? [];
      return data.map((d) => ({ t: new Date(d.timeStamp).getTime(), v: d.average ?? null }));
    };
    const toBps = (pts: { t: number; v: number | null }[]) =>
      pts.map((p) => ({ t: p.t, v: p.v == null ? null : p.v / stepSeconds }));

    const series: MetricSeries[] = [
      { id: "cpuPercent", label: "CPU", unit: "percent", points: pickPoints("Percentage CPU") },
      { id: "netRxBps", label: "Network in", unit: "bps", points: toBps(pickPoints("Network In Total")) },
      { id: "netTxBps", label: "Network out", unit: "bps", points: toBps(pickPoints("Network Out Total")) },
      { id: "diskReadBps", label: "Disk read", unit: "bps", points: toBps(pickPoints("Disk Read Bytes")) },
      { id: "diskWriteBps", label: "Disk write", unit: "bps", points: toBps(pickPoints("Disk Write Bytes")) },
    ];
    return {
      startedAt: start.getTime(),
      endedAt: end.getTime(),
      stepSeconds,
      series,
      source: `Azure Monitor · ${interval}`,
    };
  }

  async getMetrics(region: string, id: string) {
    const h = await this.getMetricsHistory(region, id, 30);
    const last = (sid: string) => {
      const s = h.series.find((x) => x.id === sid);
      const pts = (s?.points ?? []).filter((p) => p.v != null);
      const v = pts[pts.length - 1]?.v;
      return typeof v === "number" ? v : undefined;
    };
    return {
      sampledAt: Date.now(),
      running: true,
      cpuPercent: last("cpuPercent"),
      netRxBps: last("netRxBps"),
      netTxBps: last("netTxBps"),
      diskReadBps: last("diskReadBps"),
      diskWriteBps: last("diskWriteBps"),
      note: h.source,
    };
  }

  async getInstanceLogs(_region: string, id: string): Promise<InstanceLogChunk> {
    const { rg, name } = parseShortId(id);
    const cred = this.credential();
    const token = await cred.getToken("https://management.azure.com/.default");
    if (!token?.token) throw new Error("Could not acquire Azure access token");
    const url =
      `https://management.azure.com/subscriptions/${this.creds.subscriptionId}` +
      `/resourceGroups/${rg}/providers/Microsoft.Compute/virtualMachines/${name}` +
      `/retrieveBootDiagnosticsData?api-version=2024-03-01`;
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token.token}` },
    });
    if (!res.ok) {
      return {
        text: "",
        fetchedAt: Date.now(),
        source: "Azure boot diagnostics",
        note: `Boot diagnostics not available (${res.status}). Enable diagnostics on the VM to capture serial output.`,
      };
    }
    const body = (await res.json()) as {
      serialConsoleLogBlobUri?: string;
      consoleScreenshotBlobUri?: string;
    };
    if (!body.serialConsoleLogBlobUri) {
      return {
        text: "",
        fetchedAt: Date.now(),
        source: "Azure boot diagnostics",
        note: "No serial console URL returned. Enable boot diagnostics with managed storage.",
      };
    }
    const logRes = await fetch(body.serialConsoleLogBlobUri);
    const text = logRes.ok ? await logRes.text() : "";
    return {
      text,
      fetchedAt: Date.now(),
      source: "Azure boot diagnostics · serial console",
      truncated: text.length >= 1_048_576,
    };
  }

  async createInstance(input: CreateInstanceInput): Promise<NormalizedInstance> {
    const location = input.region;
    const compute = this.compute();
    const network = this.network();
    const restoring = !!input.fromSnapshotId;

    // Resolve resource group: hint wins, else first RG in this location, else create "vmui-rg-<location>".
    const hintRg = input.providerHints?.resourceGroup;
    let rg = hintRg ?? null;
    if (!rg) {
      // Use a static, predictable name vmui owns.
      rg = `vmui-rg-${location}`;
    }
    // Ensure RG exists. We need @azure/arm-resources for that — to avoid adding a
    // dependency we use the REST endpoint via the network client's own credential.
    await this.ensureResourceGroup(rg, location);

    // VNet + Subnet — reuse if they already exist.
    const vnetName = input.providerHints?.vnetName ?? `vmui-vnet-${location}`;
    const subnetName = input.providerHints?.subnetName ?? "default";
    let vnet;
    try {
      vnet = await network.virtualNetworks.get(rg, vnetName);
    } catch {
      vnet = await network.virtualNetworks.beginCreateOrUpdateAndWait(rg, vnetName, {
        location,
        addressSpace: { addressPrefixes: ["10.0.0.0/16"] },
        subnets: [{ name: subnetName, addressPrefix: "10.0.1.0/24" }],
      });
    }
    const subnet = vnet.subnets?.find((s) => s.name === subnetName) ?? vnet.subnets?.[0];
    if (!subnet?.id) throw new Error("Could not resolve subnet for new VM");

    // Public IP + NIC.
    const pipName = `${input.name}-pip`;
    const pip = await network.publicIPAddresses.beginCreateOrUpdateAndWait(rg, pipName, {
      location,
      publicIPAllocationMethod: "Dynamic",
      sku: { name: "Basic" },
    });
    const nicName = `${input.name}-nic`;
    const nic = await network.networkInterfaces.beginCreateOrUpdateAndWait(rg, nicName, {
      location,
      ipConfigurations: [
        {
          name: "ipconfig1",
          subnet: { id: subnet.id },
          publicIPAddress: { id: pip.id },
          privateIPAllocationMethod: "Dynamic",
        },
      ],
    });

    // OS profile — pick reference image from template.
    const isWindows = input.template.includes("windows");
    const imageRef = isWindows
      ? {
          publisher: "MicrosoftWindowsServer",
          offer: "WindowsServer",
          sku: "2022-datacenter-azure-edition",
          version: "latest",
        }
      : { publisher: "Canonical", offer: "0001-com-ubuntu-server-jammy", sku: "22_04-lts-gen2", version: "latest" };

    const adminUsername = input.username ?? (isWindows ? "azureadmin" : "azureuser");
    const osProfile: Record<string, unknown> = { computerName: input.name, adminUsername };
    if (isWindows) {
      if (!input.password) throw new Error("Windows VMs require a password — set input.password.");
      osProfile.adminPassword = input.password;
    } else {
      if (input.sshPublicKey) {
        osProfile.linuxConfiguration = {
          disablePasswordAuthentication: true,
          ssh: {
            publicKeys: [{ path: `/home/${adminUsername}/.ssh/authorized_keys`, keyData: input.sshPublicKey }],
          },
        };
      } else if (input.password) {
        osProfile.adminPassword = input.password;
      } else {
        throw new Error("Linux VM requires either input.sshPublicKey or input.password");
      }
    }

    await compute.virtualMachines.beginCreateOrUpdateAndWait(rg, input.name, {
      location,
      hardwareProfile: { vmSize: input.instanceType },
      storageProfile: restoring
        ? {
            osDisk: {
              createOption: "Attach",
              osType: isWindows ? "Windows" : "Linux",
              managedDisk: { id: await this.createDiskFromSnapshot(rg, location, input.fromSnapshotId!, input.name) },
              deleteOption: "Delete",
            },
          }
        : {
            imageReference: imageRef,
            osDisk: { createOption: "FromImage", deleteOption: "Delete" },
          },
      networkProfile: { networkInterfaces: [{ id: nic.id, primary: true }] },
      ...(restoring ? {} : { osProfile }),
      ...(input.userData && !restoring
        ? { userData: Buffer.from(input.userData, "utf-8").toString("base64") }
        : {}),
      tags: { "vmui-managed": "true" },
    });

    return {
      providerInstanceId: `${rg}/${input.name}`,
      region: location,
      name: input.name,
      state: "pending",
      platform: isWindows ? "windows" : "linux",
      instanceType: input.instanceType,
      publicIp: null,
      publicDns: null,
      privateIp: null,
      keyName: null,
      raw: { pending: true, rg, vnetName, subnetName },
    };
  }

  /**
   * Ensure a resource group with the given name exists in the chosen location.
   * Uses the ARM REST API directly to avoid adding @azure/arm-resources.
   */
  private async ensureResourceGroup(name: string, location: string): Promise<void> {
    const cred = this.credential();
    const token = await cred.getToken("https://management.azure.com/.default");
    if (!token?.token) throw new Error("Could not acquire Azure access token");
    const url = `https://management.azure.com/subscriptions/${this.creds.subscriptionId}/resourcegroups/${encodeURIComponent(
      name,
    )}?api-version=2022-09-01`;
    const res = await fetch(url, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ location }),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Failed to create resource group ${name}: ${res.status} ${txt}`);
    }
  }

  /**
   * Create a managed disk from an existing snapshot. The disk lives in the
   * same RG as the VM that's about to consume it. Returns the resource id
   * suitable for `osDisk.managedDisk.id`.
   */
  private async createDiskFromSnapshot(
    rg: string,
    location: string,
    snapshotId: string,
    label: string,
  ): Promise<string> {
    const compute = this.compute();
    let sourceId: string;
    if (snapshotId.startsWith("/subscriptions/")) {
      sourceId = snapshotId;
    } else {
      const parts = snapshotId.split("/");
      if (parts.length !== 2) throw new Error(`Invalid Azure snapshot id: ${snapshotId}`);
      const [srg, sname] = parts;
      sourceId = `/subscriptions/${this.creds.subscriptionId}/resourceGroups/${srg}/providers/Microsoft.Compute/snapshots/${sname}`;
    }
    const diskName = `${label}-osdisk-${Date.now().toString(36)}`.slice(0, 80);
    const disk = await compute.disks.beginCreateOrUpdateAndWait(rg, diskName, {
      location,
      creationData: { createOption: "Copy", sourceResourceId: sourceId },
    });
    if (!disk.id) throw new Error("Disk creation returned no id");
    return disk.id;
  }

  async getConnectionInfo(_region: string, id: string): Promise<ConnectionInfo> {
    const vm = await this.getInstance(_region, id);
    if (!vm) throw new Error("VM not found");
    const host = vm.publicIp ?? vm.privateIp ?? "";
    if (!host) {
      return {
        protocol: "ssh",
        host: "",
        port: 22,
        username: "—",
        notes: ["No public/private IP on this VM. Attach a NIC + Public IP and retry."],
      };
    }
    if (vm.platform === "windows") {
      const fileContent = [
        `full address:s:${host}:3389`,
        "prompt for credentials:i:1",
        "administrative session:i:1",
      ].join("\r\n");
      return {
        protocol: "rdp",
        host,
        port: 3389,
        username: "azureuser",
        fileContent,
        fileName: `${vm.name ?? id}.rdp`,
        fileMime: "application/x-rdp",
        notes: ["Use the local administrator username/password you set when creating the VM."],
      };
    }
    return {
      protocol: "ssh",
      host,
      port: 22,
      username: "azureuser",
      sshCommand: `ssh azureuser@${host}`,
      notes: ["Default Linux Azure image username is 'azureuser'. Use the SSH key you uploaded at create-time."],
    };
  }

  async listInstanceTemplates(): Promise<InstanceTemplate[]> {
    return TEMPLATES;
  }

  async listResources(region: string, kind: ResourceKind): Promise<NormalizedResource[]> {
    if (kind === "volume") return this.listDisks(region);
    if (kind === "snapshot") return this.listSnapshots(region);
    if (kind === "vpc") return this.listVnets(region);
    if (kind === "subnet") return this.listSubnets(region);
    if (kind === "security-group") return this.listNsgs(region);
    if (kind === "load-balancer") return this.listLoadBalancers(region);
    if (kind === "bucket") return this.listStorageAccounts(region);
    if (kind === "database") return this.listSqlDatabases(region);
    if (kind === "dns-zone") return this.listDnsZones(region);
    return [];
  }

  private async listStorageAccounts(region: string): Promise<NormalizedResource[]> {
    const out: NormalizedResource[] = [];
    for await (const sa of this.storage().storageAccounts.list()) {
      if ((sa.location ?? "").toLowerCase() !== region.toLowerCase()) continue;
      out.push({
        externalId: sa.id ?? sa.name ?? "",
        region,
        kind: "bucket",
        name: sa.name ?? null,
        status: sa.provisioningState ?? null,
        raw: sa,
      });
    }
    return out;
  }

  private async listSqlDatabases(region: string): Promise<NormalizedResource[]> {
    const out: NormalizedResource[] = [];
    const sql = this.sql();
    for await (const server of sql.servers.list()) {
      if ((server.location ?? "").toLowerCase() !== region.toLowerCase()) continue;
      const rgMatch = /\/resourceGroups\/([^/]+)\//i.exec(server.id ?? "");
      const rg = rgMatch?.[1];
      if (!rg || !server.name) continue;
      try {
        for await (const dbRow of sql.databases.listByServer(rg, server.name)) {
          if (dbRow.name === "master") continue;
          out.push({
            externalId: dbRow.id ?? `${server.id}/databases/${dbRow.name}`,
            region,
            kind: "database",
            name: `${server.name}/${dbRow.name ?? ""}`,
            status: dbRow.status ?? null,
            sizeBytes: dbRow.maxSizeBytes ?? null,
            raw: { server: server.name, database: dbRow },
          });
        }
      } catch {
        // Skip servers we can't enumerate (e.g. serverless transient).
      }
    }
    return out;
  }

  private async listDnsZones(_region: string): Promise<NormalizedResource[]> {
    // Public DNS zones in Azure are global resources (location "global"). We
    // expose them under whichever region is being synced — the UI tags them
    // accordingly. To avoid duplicates across multi-region sync, only emit on
    // the account's defaultLocation.
    if ((this.creds.defaultLocation ?? "").toLowerCase() !== _region.toLowerCase()) return [];
    const out: NormalizedResource[] = [];
    for await (const z of this.dns().zones.list()) {
      out.push({
        externalId: z.id ?? z.name ?? "",
        region: _region,
        kind: "dns-zone",
        name: z.name ?? null,
        status: null,
        raw: z,
      });
    }
    return out;
  }

  private async listDisks(region: string): Promise<NormalizedResource[]> {
    const out: NormalizedResource[] = [];
    for await (const d of this.compute().disks.list()) {
      if ((d.location ?? "").toLowerCase() !== region.toLowerCase()) continue;
      out.push({
        externalId: d.id ?? d.name ?? "",
        region,
        kind: "volume",
        name: d.name ?? null,
        status: (d.diskState ?? d.provisioningState ?? null) as string | null,
        sizeBytes: d.diskSizeBytes ?? (d.diskSizeGB ? d.diskSizeGB * 1024 ** 3 : null) ?? null,
        attachedTo: d.managedBy ?? null,
        raw: d,
      });
    }
    return out;
  }

  private async listSnapshots(region: string): Promise<NormalizedResource[]> {
    const out: NormalizedResource[] = [];
    for await (const s of this.compute().snapshots.list()) {
      if ((s.location ?? "").toLowerCase() !== region.toLowerCase()) continue;
      out.push({
        externalId: s.id ?? s.name ?? "",
        region,
        kind: "snapshot",
        name: s.name ?? null,
        status: s.provisioningState ?? null,
        sizeBytes: s.diskSizeBytes ?? (s.diskSizeGB ? s.diskSizeGB * 1024 ** 3 : null) ?? null,
        raw: s,
      });
    }
    return out;
  }

  private async listVnets(region: string): Promise<NormalizedResource[]> {
    const out: NormalizedResource[] = [];
    for await (const v of this.network().virtualNetworks.listAll()) {
      if ((v.location ?? "").toLowerCase() !== region.toLowerCase()) continue;
      out.push({
        externalId: v.id ?? v.name ?? "",
        region,
        kind: "vpc",
        name: v.name ?? null,
        status: v.provisioningState ?? null,
        raw: v,
      });
    }
    return out;
  }

  private async listSubnets(region: string): Promise<NormalizedResource[]> {
    const out: NormalizedResource[] = [];
    for await (const v of this.network().virtualNetworks.listAll()) {
      if ((v.location ?? "").toLowerCase() !== region.toLowerCase()) continue;
      for (const sub of v.subnets ?? []) {
        out.push({
          externalId: sub.id ?? `${v.id}/subnets/${sub.name}`,
          region,
          kind: "subnet",
          name: sub.name ?? null,
          status: sub.provisioningState ?? null,
          raw: { vnet: v.name, subnet: sub },
        });
      }
    }
    return out;
  }

  private async listNsgs(region: string): Promise<NormalizedResource[]> {
    const out: NormalizedResource[] = [];
    for await (const n of this.network().networkSecurityGroups.listAll()) {
      if ((n.location ?? "").toLowerCase() !== region.toLowerCase()) continue;
      out.push({
        externalId: n.id ?? n.name ?? "",
        region,
        kind: "security-group",
        name: n.name ?? null,
        status: n.provisioningState ?? null,
        raw: n,
      });
    }
    return out;
  }

  private async listLoadBalancers(region: string): Promise<NormalizedResource[]> {
    const out: NormalizedResource[] = [];
    for await (const lb of this.network().loadBalancers.listAll()) {
      if ((lb.location ?? "").toLowerCase() !== region.toLowerCase()) continue;
      out.push({
        externalId: lb.id ?? lb.name ?? "",
        region,
        kind: "load-balancer",
        name: lb.name ?? null,
        status: lb.provisioningState ?? null,
        raw: lb,
      });
    }
    return out;
  }
}
