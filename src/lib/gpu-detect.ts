/**
 * Heuristic GPU detection from instance type strings across providers.
 * Returns the GPU model name + count, or null when not a GPU instance.
 */
export interface GpuInfo {
  model: string;
  count: number;
}

const PATTERNS: { re: RegExp; model: string; count: number }[] = [
  { re: /^p5\./i, model: "H100", count: 8 },
  { re: /^p4d?\./i, model: "A100", count: 8 },
  { re: /^p3\.16xlarge|^p3\.8xlarge/i, model: "V100", count: 8 },
  { re: /^p3\./i, model: "V100", count: 1 },
  { re: /^g6\./i, model: "L4", count: 1 },
  { re: /^g5\./i, model: "A10G", count: 1 },
  { re: /^g4dn\./i, model: "T4", count: 1 },
  { re: /^Standard_NC.*A100/i, model: "A100", count: 1 },
  { re: /^Standard_NC.*v3/i, model: "V100", count: 1 },
  { re: /^Standard_NC.*T4_v3/i, model: "T4", count: 1 },
  { re: /^Standard_ND.*A100/i, model: "A100", count: 8 },
  { re: /^Standard_ND.*H100/i, model: "H100", count: 8 },
  { re: /^a2-/i, model: "A100", count: 1 },
  { re: /^a3-/i, model: "H100", count: 8 },
  { re: /^g2-/i, model: "L4", count: 1 },
  { re: /gpu/i, model: "GPU", count: 1 },
];

export function detectGpu(instanceType: string | null | undefined): GpuInfo | null {
  if (!instanceType) return null;
  for (const p of PATTERNS) if (p.re.test(instanceType)) return { model: p.model, count: p.count };
  return null;
}
