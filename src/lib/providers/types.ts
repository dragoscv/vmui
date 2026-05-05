/**
 * Cloud provider abstraction. New providers (Azure, GCP, Scaleway) plug in by
 * implementing this interface and registering in `registry.ts`.
 */

export type ProviderId = "aws" | "azure" | "gcp" | "scaleway" | "local-kvm";

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

