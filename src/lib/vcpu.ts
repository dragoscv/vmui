import "server-only";

/**
 * Best-effort vCPU estimate from an instance type string. Used only for
 * advisory quota enforcement, not for billing. Returns null when we don't
 * recognize the shape; the quota check then treats the instance as 0.
 *
 * Heuristics cover the common shapes we see in pricing data:
 *   AWS:    `t3.small`, `m5.xlarge`, `c6i.4xlarge`, `r5n.metal`
 *   Azure:  `Standard_B2s`, `Standard_D4s_v3`, `Standard_F16s_v2`
 *   GCP:    `e2-small`, `n1-standard-4`, `c2-highcpu-16`
 *   Scaleway dedicated mac minis: bare metal, treat as 8.
 */
const AWS_SIZE: Record<string, number> = {
  nano: 1,
  micro: 1,
  small: 1,
  medium: 1,
  large: 2,
  xlarge: 4,
  "2xlarge": 8,
  "4xlarge": 16,
  "8xlarge": 32,
  "9xlarge": 36,
  "12xlarge": 48,
  "16xlarge": 64,
  "18xlarge": 72,
  "24xlarge": 96,
  "32xlarge": 128,
  metal: 96,
};

export function estimateVcpu(instanceType: string | null | undefined): number | null {
  if (!instanceType) return null;
  const t = instanceType.trim();

  // GCP: e2-small / e2-medium / n1-standard-4 / c2-highcpu-16
  const gcp = /^([a-z]\d+)-([a-z]+)(?:-(\d+))?$/.exec(t);
  if (gcp) {
    const tail = gcp[3];
    if (tail) return Number.parseInt(tail, 10);
    const family = gcp[2];
    if (family === "small" || family === "micro") return 1;
    if (family === "medium") return 1;
    return 2;
  }

  // Azure: Standard_B2s, Standard_D4s_v3, Standard_F16s_v2
  if (/^Standard_/i.test(t)) {
    const m = /^Standard_[A-Z]+(\d+)/i.exec(t);
    if (m && m[1]) return Number.parseInt(m[1], 10);
    return null;
  }

  // AWS-style: family.size
  const aws = /^[a-z][a-z0-9]+\.([a-z0-9]+)$/i.exec(t);
  if (aws && aws[1]) {
    const size = aws[1].toLowerCase();
    const known = AWS_SIZE[size];
    if (known !== undefined) return known;
  }

  // Scaleway mac minis & similar bare-metal
  if (/mac/i.test(t)) return 8;

  return null;
}
