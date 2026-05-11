"use server";

import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { installK8s, kubectlExec, helmInstall } from "@/lib/k8s";

const installSchema = z.object({
  instanceId: z.string().min(1),
  flavor: z.enum(["k3s", "k0s"]),
  role: z.enum(["server", "agent"]),
  serverUrl: z.string().optional(),
  token: z.string().optional(),
});

export async function installK8sAction(input: z.infer<typeof installSchema>) {
  await requireRole("operator");
  const parsed = installSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "invalid" };
  try {
    const r = await installK8s(parsed.data.instanceId, parsed.data);
    return r.ok
      ? { ok: true as const, joinToken: r.joinToken, kubeconfig: r.kubeconfig, message: r.message }
      : { ok: false as const, error: r.message };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function kubectlAction(instanceId: string, args: string) {
  await requireRole("operator");
  if (!/^[a-z0-9\-_.\s,/=:@]+$/i.test(args)) return { ok: false as const, error: "invalid characters" };
  const r = await kubectlExec(instanceId, args);
  return { ok: r.ok, stdout: r.stdout, stderr: r.stderr };
}

const helmSchema = z.object({
  instanceId: z.string().min(1),
  release: z.string().min(1),
  chart: z.string().min(1),
  namespace: z.string().optional(),
  values: z.string().optional(),
  repoName: z.string().optional(),
  repoUrl: z.string().optional(),
});

export async function helmInstallAction(input: z.infer<typeof helmSchema>) {
  await requireRole("operator");
  const parsed = helmSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "invalid" };
  const v = parsed.data;
  const r = await helmInstall(v.instanceId, {
    release: v.release,
    chart: v.chart,
    namespace: v.namespace,
    values: v.values,
    repo: v.repoName && v.repoUrl ? { name: v.repoName, url: v.repoUrl } : undefined,
  });
  return r.ok ? { ok: true as const, message: r.message } : { ok: false as const, error: r.message };
}
