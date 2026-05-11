import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { instances, cloudAccounts, auditLog } from "@/lib/db/schema";
import { decryptJSON } from "@/lib/crypto";
import { sshExec } from "@/lib/ssh-exec";
import type { ProbeKey } from "@/lib/probe";

export type K8sFlavor = "k3s" | "k0s";
export type K8sRole = "server" | "agent";

async function instanceCtx(instanceId: string) {
  const inst = db.select().from(instances).where(eq(instances.id, instanceId)).get();
  if (!inst) throw new Error("instance not found");
  if (!inst.publicIp && !inst.publicDns) throw new Error("instance unreachable");
  const acc = db.select().from(cloudAccounts).where(eq(cloudAccounts.id, inst.accountId)).get();
  if (!acc?.probeKeyEnc) throw new Error("no probe key");
  const key = decryptJSON<ProbeKey>(acc.probeKeyEnc);
  return {
    inst,
    key,
    host: inst.publicIp ?? inst.publicDns!,
    user: key.defaultUser ?? (inst.provider === "aws" ? "ec2-user" : "ubuntu"),
  };
}

/**
 * Install k3s or k0s on an instance. For `server` role, returns the join
 * token; for `agent` role, the caller supplies the server URL + token.
 */
export async function installK8s(
  instanceId: string,
  opts: { flavor: K8sFlavor; role: K8sRole; serverUrl?: string; token?: string },
): Promise<{ ok: boolean; message: string; joinToken?: string; kubeconfig?: string }> {
  const { inst, key, host, user } = await instanceCtx(instanceId);

  let script: string;
  if (opts.flavor === "k3s") {
    if (opts.role === "server") {
      script = [
        "set -e",
        "curl -sfL https://get.k3s.io | sh -s - server --write-kubeconfig-mode 0644",
        "sleep 5",
        "sudo cat /var/lib/rancher/k3s/server/node-token",
        "echo '---KUBECONFIG---'",
        "sudo cat /etc/rancher/k3s/k3s.yaml",
      ].join("\n");
    } else {
      if (!opts.serverUrl || !opts.token) throw new Error("agent role needs serverUrl + token");
      script = [
        "set -e",
        `curl -sfL https://get.k3s.io | K3S_URL='${opts.serverUrl}' K3S_TOKEN='${opts.token}' sh -`,
        "echo 'agent joined'",
      ].join("\n");
    }
  } else {
    // k0s
    if (opts.role === "server") {
      script = [
        "set -e",
        "curl -sSLf https://get.k0s.sh | sudo sh",
        "sudo k0s install controller --single",
        "sudo k0s start",
        "sleep 8",
        "sudo k0s token create --role=worker --expiry=24h",
        "echo '---KUBECONFIG---'",
        "sudo k0s kubeconfig admin",
      ].join("\n");
    } else {
      if (!opts.token) throw new Error("agent role needs token");
      script = [
        "set -e",
        "curl -sSLf https://get.k0s.sh | sudo sh",
        `echo '${opts.token}' | sudo tee /etc/k0s/token > /dev/null`,
        "sudo k0s install worker --token-file /etc/k0s/token",
        "sudo k0s start",
        "echo 'worker joined'",
      ].join("\n");
    }
  }

  const r = await sshExec({ host, port: 22, user, key, command: script, timeoutMs: 10 * 60_000 });
  db.insert(auditLog).values({
    action: `k8s.install.${opts.flavor}.${opts.role}`,
    target: instanceId,
    status: r.code === 0 ? "ok" : "error",
    message: r.code === 0 ? "ok" : r.stderr.slice(-400),
  }).run();
  if (r.code !== 0) return { ok: false, message: r.stderr.slice(-400) };

  let joinToken: string | undefined;
  let kubeconfig: string | undefined;
  if (opts.role === "server") {
    const sections = r.stdout.split("---KUBECONFIG---");
    joinToken = sections[0]!.trim().split("\n").pop()?.trim();
    kubeconfig = (sections[1] ?? "").trim();
    if (kubeconfig) {
      // Replace 127.0.0.1 with the public host so external kubectl can reach it.
      kubeconfig = kubeconfig.replace(/127\.0\.0\.1/g, inst.publicIp ?? inst.publicDns ?? "127.0.0.1");
    }
  }
  return { ok: true, message: "installed", joinToken, kubeconfig };
}

/**
 * Run an arbitrary `kubectl ...` against a server node via SSH. Used by the
 * web kubectl proxy so the browser doesn't need direct cluster reach.
 */
export async function kubectlExec(instanceId: string, args: string): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const { key, host, user } = await instanceCtx(instanceId);
  const r = await sshExec({
    host,
    port: 22,
    user,
    key,
    command: `sudo kubectl ${args}`,
    timeoutMs: 60_000,
  });
  return { ok: r.code === 0, stdout: r.stdout, stderr: r.stderr };
}

/**
 * Apply a Helm chart on the server node via SSH. Caller supplies install args.
 */
export async function helmInstall(
  instanceId: string,
  opts: { release: string; chart: string; namespace?: string; values?: string; repo?: { name: string; url: string } },
): Promise<{ ok: boolean; message: string }> {
  const { key, host, user } = await instanceCtx(instanceId);
  const lines = ["set -e", "command -v helm >/dev/null || curl -sSL https://baltocdn.com/helm/signing.asc | sudo apt-key add - && curl -sfL https://get.helm.sh/helm-v3.14.0-linux-amd64.tar.gz | tar -xz && sudo install linux-amd64/helm /usr/local/bin/helm && rm -rf linux-amd64"];
  if (opts.repo) {
    lines.push(`sudo helm repo add ${opts.repo.name} ${opts.repo.url}`);
    lines.push("sudo helm repo update");
  }
  let cmd = `sudo helm upgrade --install ${opts.release} ${opts.chart}`;
  if (opts.namespace) cmd += ` --namespace ${opts.namespace} --create-namespace`;
  if (opts.values) cmd += ` -f -`;
  lines.push(cmd);
  let stdin = "";
  if (opts.values) stdin = opts.values;
  const command = stdin
    ? `${lines.slice(0, -1).join(" && ")} && cat <<'EOF' | ${lines.at(-1)!}\n${stdin}\nEOF`
    : lines.join(" && ");
  const r = await sshExec({ host, port: 22, user, key, command, timeoutMs: 5 * 60_000 });
  db.insert(auditLog).values({
    action: "k8s.helm.install",
    target: instanceId,
    status: r.code === 0 ? "ok" : "error",
    message: `${opts.release} ${opts.chart}`,
  }).run();
  return r.code === 0 ? { ok: true, message: r.stdout.slice(-1000) } : { ok: false, message: r.stderr.slice(-500) };
}
