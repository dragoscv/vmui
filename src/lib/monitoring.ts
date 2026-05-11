import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { instances, cloudAccounts, auditLog } from "@/lib/db/schema";
import { decryptJSON } from "@/lib/crypto";
import { sshExec } from "@/lib/ssh-exec";
import type { ProbeKey } from "@/lib/probe";

/** Auto-deploy node_exporter via SSH on a Linux/macOS VM. Returns the URL it's listening on. */
export async function deployNodeExporter(instanceId: string): Promise<{ ok: boolean; url?: string; message: string }> {
  const inst = db.select().from(instances).where(eq(instances.id, instanceId)).get();
  if (!inst || (!inst.publicIp && !inst.publicDns)) return { ok: false, message: "instance unreachable" };
  const acc = db.select().from(cloudAccounts).where(eq(cloudAccounts.id, inst.accountId)).get();
  if (!acc?.probeKeyEnc) return { ok: false, message: "no probe key" };
  const key = decryptJSON<ProbeKey>(acc.probeKeyEnc);
  const host = inst.publicIp ?? inst.publicDns!;
  const user = key.defaultUser ?? (inst.provider === "aws" ? "ec2-user" : "ubuntu");

  // Idempotent: install node_exporter v1.8.2 via tarball + systemd unit, listening on :9100.
  const script = [
    "set -e",
    "command -v node_exporter >/dev/null 2>&1 || sudo useradd --no-create-home --shell /usr/sbin/nologin node_exporter 2>/dev/null || true",
    "cd /tmp",
    "if [ ! -x /usr/local/bin/node_exporter ]; then",
    "  ARCH=$(uname -m); case $ARCH in x86_64) A=amd64;; aarch64|arm64) A=arm64;; *) A=$ARCH;; esac",
    "  curl -fsSL -o ne.tgz \"https://github.com/prometheus/node_exporter/releases/download/v1.8.2/node_exporter-1.8.2.linux-${A}.tar.gz\"",
    "  tar xf ne.tgz",
    "  sudo install -m 0755 node_exporter-*/node_exporter /usr/local/bin/node_exporter",
    "  rm -rf node_exporter-* ne.tgz",
    "fi",
    "sudo tee /etc/systemd/system/node_exporter.service > /dev/null <<'EOF'",
    "[Unit]",
    "Description=Prometheus node_exporter",
    "After=network.target",
    "[Service]",
    "User=node_exporter",
    "Group=node_exporter",
    "ExecStart=/usr/local/bin/node_exporter --web.listen-address=:9100",
    "Restart=on-failure",
    "[Install]",
    "WantedBy=multi-user.target",
    "EOF",
    "sudo systemctl daemon-reload",
    "sudo systemctl enable --now node_exporter",
    "sleep 1",
    "curl -fsS http://127.0.0.1:9100/metrics | head -1",
  ].join("\n");

  const r = await sshExec({ host, port: 22, user, key, command: script, timeoutMs: 120_000 });
  db.insert(auditLog).values({
    action: "monitoring.deploy_node_exporter",
    target: instanceId,
    status: r.code === 0 ? "ok" : "error",
    message: r.code === 0 ? `http://${host}:9100/metrics` : r.stderr.slice(-300),
  }).run();
  if (r.code !== 0) return { ok: false, message: r.stderr.slice(-300) };
  return { ok: true, url: `http://${host}:9100/metrics`, message: "node_exporter deployed and started" };
}

/** Generate a Prometheus scrape config snippet for every reachable VM with node_exporter. */
export async function generatePromConfig(): Promise<string> {
  const rows = db.select().from(instances).all();
  const targets = rows
    .filter((i) => i.state === "running" && (i.publicIp || i.publicDns))
    .map((i) => ({ ip: i.publicIp ?? i.publicDns!, name: i.name ?? i.providerInstanceId, provider: i.provider, region: i.region }));
  const yaml = [
    "scrape_configs:",
    "  - job_name: 'node'",
    "    static_configs:",
    ...targets.map((t) => `      - targets: ['${t.ip}:9100']\n        labels: {name: '${t.name}', provider: '${t.provider}', region: '${t.region}'}`),
  ].join("\n");
  return yaml;
}
