/**
 * Cloud provider abstraction. New providers (Azure, GCP, Scaleway) plug in by
 * implementing this interface and registering in `registry.ts`.
 */

export type ProviderId = "aws" | "azure" | "gcp" | "scaleway" | "digitalocean" | "local-kvm";

export type NormalizedState =
  | "pending"
  | "running"
  | "stopping"
  | "stopped"
  | "shutting-down"
  | "terminated"
  | "unknown";

export type Platform = "windows" | "macos" | "linux";

export interface NormalizedInstance {
  providerInstanceId: string;
  region: string;
  name: string | null;
  state: NormalizedState;
  platform: Platform;
  instanceType: string | null;
  publicIp: string | null;
  publicDns: string | null;
  privateIp: string | null;
  keyName: string | null;
  raw: unknown;
}

export interface ConnectionInfo {
  /** Recommended primary protocol. */
  protocol: "rdp" | "ssh" | "vnc";
  host: string;
  port: number;
  username: string;
  /** Generated file content (e.g. .rdp text), if applicable. */
  fileContent?: string;
  fileName?: string;
  fileMime?: string;
  /** Human-readable instructions to display in the UI. */
  notes: string[];
  /** SSH command line, when available. */
  sshCommand?: string;
  /** vnc:// URL, when available. */
  vncUrl?: string;
}

export interface CreateInstanceInput {
  region: string;
  /** Friendly name (turns into a Name tag). */
  name: string;
  /** e.g. "macos", "windows-2022", "ubuntu-22.04" — provider decides AMI. */
  template: string;
  instanceType: string;
  /** Existing key pair name in the provider, if applicable. */
  keyName?: string;
  /** Public SSH key to inject (Linux). Optional. */
  sshPublicKey?: string;
  /** Initial username when the provider creates one. Optional. */
  username?: string;
  /** Initial Windows password when the provider needs one. Optional. */
  password?: string;
  /**
   * Provider-specific resource hints (Azure: resourceGroup/vnetName/subnetName,
   * GCP: imageFamily/imageProject, etc.).
   */
  providerHints?: Record<string, string>;
  /**
   * Snapshot id to restore from. When set, the provider builds an image
   * from this snapshot and uses it as the boot source instead of `template`.
   * Provider implementations may ignore the field and fall back to template.
   */
  fromSnapshotId?: string;
  /**
   * Provider user-data / cloud-init script passed verbatim to the guest.
   * Implementations may ignore the field if the provider doesn't support it.
   */
  userData?: string;
}

export interface ProviderAccountInfo {
  accountId: string;
  /** Display label, e.g. AWS account alias or email. */
  label: string;
}

export interface CloudProvider {
  readonly id: ProviderId;

  /** Validate credentials and return basic account identity. */
  verify(): Promise<ProviderAccountInfo>;

  listRegions(): Promise<string[]>;
  listInstances(region: string): Promise<NormalizedInstance[]>;
  getInstance(region: string, providerInstanceId: string): Promise<NormalizedInstance | null>;

  startInstance(region: string, id: string): Promise<void>;
  stopInstance(region: string, id: string): Promise<void>;
  rebootInstance(region: string, id: string): Promise<void>;
  terminateInstance(region: string, id: string): Promise<void>;

  createInstance(input: CreateInstanceInput): Promise<NormalizedInstance>;

  /** Build connection info (RDP file / SSH command / VNC URL). */
  getConnectionInfo(region: string, providerInstanceId: string): Promise<ConnectionInfo>;

  /** Templates available for the create wizard. */
  listInstanceTemplates(): Promise<InstanceTemplate[]>;

  /** Optional: list non-instance resources (volumes, snapshots, networks…). */
  listResources?(region: string, kind: ResourceKind): Promise<NormalizedResource[]>;

  /** Optional: apply tag/label set to one VM. Replaces or merges per provider. */
  applyTags?(region: string, providerInstanceId: string, tags: Record<string, string>): Promise<void>;

  /** Optional: snapshot the VM's root/boot disk. Returns the new snapshot id. */
  createSnapshot?(
    region: string,
    providerInstanceId: string,
    label: string,
  ): Promise<{ snapshotId: string; note?: string }>;

  /** Optional: delete a snapshot by its provider id. */
  deleteSnapshot?(region: string, snapshotId: string): Promise<void>;

  /** Optional: latest realtime sample. Used by the live "performance" panel. */
  getMetrics?(region: string, providerInstanceId: string): Promise<InstanceStatsSample>;

  /** Optional: time-series of CPU / Net / Disk over the last `rangeMinutes`. */
  getMetricsHistory?(
    region: string,
    providerInstanceId: string,
    rangeMinutes: number,
  ): Promise<MetricsHistory>;

  /** Optional: tail of provider logs (console output, system log, etc.). */
  getInstanceLogs?(
    region: string,
    providerInstanceId: string,
    options?: { tailBytes?: number },
  ): Promise<InstanceLogChunk>;
}

/**
 * Categories of cloud resources that can appear on the unified resources page.
 * Providers implement whatever subset they support.
 */
export type ResourceKind =
  | "volume"
  | "snapshot"
  | "security-group"
  | "keypair"
  | "vpc"
  | "subnet"
  | "elastic-ip"
  | "image"
  | "bucket"
  | "load-balancer"
  | "database"
  | "dns-zone";

export interface NormalizedResource {
  externalId: string;
  region: string;
  kind: ResourceKind;
  name: string | null;
  /** Provider status (e.g. "available", "in-use", "completed"). */
  status: string | null;
  /** Size in bytes when applicable (volumes, snapshots, buckets). */
  sizeBytes?: number | null;
  /** Provider id of the instance this resource is attached to, when applicable. */
  attachedTo?: string | null;
  /** Free-form key/value tags surfaced to the UI. */
  tags?: Record<string, string>;
  raw: unknown;
}

export interface InstanceTemplate {
  id: string;
  label: string;
  platform: Platform;
  description: string;
  /** Suggested instance types for this template. */
  recommendedTypes: string[];
  /** Notes shown in the create wizard (pricing, requirements, etc.). */
  notes?: string[];
}

/**
 * Realtime resource-usage snapshot for a running instance. All optional fields
 * may be omitted by providers that don't expose that signal.
 */
export interface InstanceStatsSample {
  /** ms since epoch when the sample was taken. */
  sampledAt: number;
  /** Whether the underlying VM was actually running and we got data. */
  running: boolean;
  /** Total CPU saturation 0..100 across all allocated vCPUs. */
  cpuPercent?: number;
  /** Used memory in bytes (host RSS for KVM, guest-reported for cloud). */
  memUsedBytes?: number;
  /** Allocated/total memory in bytes. */
  memTotalBytes?: number;
  /** Disk read throughput in bytes/sec (delta vs previous sample). */
  diskReadBps?: number;
  /** Disk write throughput in bytes/sec. */
  diskWriteBps?: number;
  /** Network rx/tx bytes/sec. */
  netRxBps?: number;
  netTxBps?: number;
  /** Process uptime in seconds (host process for local-kvm). */
  uptimeSeconds?: number;
  /** Optional human note (e.g. "metrics not supported on AWS"). */
  note?: string;
}



export type MetricSeriesId = "cpuPercent" | "netRxBps" | "netTxBps" | "diskReadBps" | "diskWriteBps" | "memUsedBytes";

export interface MetricSeriesPoint {
  /** ms since epoch (start of bucket). */
  t: number;
  v: number | null;
}

export interface MetricSeries {
  id: MetricSeriesId;
  /** Human label (provider-shaped). */
  label: string;
  unit: "percent" | "bps" | "bytes";
  points: MetricSeriesPoint[];
}

export interface MetricsHistory {
  /** Range covered, ms since epoch. */
  startedAt: number;
  endedAt: number;
  /** Bucket size in seconds. */
  stepSeconds: number;
  series: MetricSeries[];
  /** Provider hint, e.g. "CloudWatch · 5-min granularity". */
  source: string;
  /** When CloudWatch agent isn't installed, etc. */
  note?: string;
}

export interface InstanceLogChunk {
  /** UTF-8 log text, may be truncated. */
  text: string;
  /** ms since epoch when fetched. */
  fetchedAt: number;
  /** Source label, e.g. "EC2 console output", "Azure boot diagnostics", "GCP serial-port-1". */
  source: string;
  /** True if the provider truncated the output. */
  truncated?: boolean;
  note?: string;
}
