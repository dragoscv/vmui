const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export function formatBytes(n: number | null | undefined): string {
  if (n == null || n <= 0) return "—";
  let val = n;
  let i = 0;
  while (val >= 1024 && i < UNITS.length - 1) {
    val /= 1024;
    i++;
  }
  return `${i === 0 ? val : val.toFixed(1)} ${UNITS[i] ?? "B"}`;
}
