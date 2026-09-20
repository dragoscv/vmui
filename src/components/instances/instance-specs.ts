export interface InstanceSpecs {
  vcpu: number | null;
  ramGb: number | null;
  disks: number | null;
}

interface RawShape {
  CpuOptions?: { CoreCount?: number; ThreadsPerCore?: number };
  BlockDeviceMappings?: unknown[];
  vcpus?: number;
  memoryMb?: number;
}

/** Best-effort hardware summary from what providers actually report; null means "not reported". */
export function parseInstanceSpecs(input: { provider: string; instanceType: string | null; rawJson: string | null }): InstanceSpecs {
  const out: InstanceSpecs = { vcpu: null, ramGb: null, disks: null };
  const kvm = input.provider === "local-kvm" ? /^(\d+)c-(\d+)g$/.exec(input.instanceType ?? "") : null;
  if (kvm) {
    out.vcpu = Number(kvm[1]);
    out.ramGb = Number(kvm[2]);
  }
  if (!input.rawJson) return out;
  let raw: RawShape;
  try {
    raw = JSON.parse(input.rawJson) as RawShape;
  } catch {
    return out;
  }
  if (raw.CpuOptions?.CoreCount) out.vcpu = raw.CpuOptions.CoreCount * (raw.CpuOptions.ThreadsPerCore ?? 1);
  if (typeof raw.vcpus === "number") out.vcpu = raw.vcpus;
  if (typeof raw.memoryMb === "number") out.ramGb = Math.round(raw.memoryMb / 1024);
  if (Array.isArray(raw.BlockDeviceMappings)) out.disks = raw.BlockDeviceMappings.length;
  return out;
}
