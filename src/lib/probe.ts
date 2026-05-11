import "server-only";
import { Client as SshClient } from "ssh2";
import { db } from "@/lib/db";
import { cloudAccounts, instances, probeSamples } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { decryptJSON } from "@/lib/crypto";

function defaultSshUser(platform: string, provider: string): string {
  if (platform === "macos") return "ec2-user";
  if (platform === "windows") return "Administrator";
  switch (provider) {
    case "aws":
      return "ubuntu";
    case "azure":
      return "azureuser";
    case "gcp":
      return "ubuntu";
    case "digitalocean":
    case "hetzner":
    case "scaleway":
      return "root";
    default:
      return "ubuntu";
  }
}

export interface ProbeKey {
  privateKey: string;
  passphrase?: string;
  defaultUser?: string;
}

export interface ProbeMetrics {
  cpu: number;        // 0..100
  cores: number[];    // per-core percent
  mem: number;        // 0..100
  memUsedMb: number;
  memTotalMb: number;
  disk: number;       // root fs percent
  diskUsedGb: number;
  diskTotalGb: number;
  netIn: number;      // bytes/s
  netOut: number;     // bytes/s
  iopsRead: number;
  iopsWrite: number;
  load1: number;
  load5: number;
  load15: number;
  uptimeSec: number;
  hostname: string;
  collectedAt: number; // ms epoch
}

/**
 * Single bash snippet that emits a deterministic JSON line. Two samples are
 * taken 1s apart so we can compute CPU% and network rates without depending
 * on `top`/`sar` being installed.
 */
const LINUX_PROBE = `bash -lc '
read_cpu() {
  awk "/^cpu / {print \\$2+\\$4, \\$2+\\$4+\\$5}" /proc/stat
}
read_cores() {
  awk "/^cpu[0-9]+ / {print \\$2+\\$4 \\\",\\\" \\$2+\\$4+\\$5}" /proc/stat
}
read_net() {
  awk "NR>2 && \\$2!~/^lo:/ {rx+=\\$2; tx+=\\$10} END {print rx, tx}" /proc/net/dev
}
read_io() {
  awk "{r+=\\$4; w+=\\$8} END {print r, w}" /proc/diskstats 2>/dev/null || echo "0 0"
}
read cpu_a1 cpu_a2 <<<\\$(read_cpu)
cores_a=\\$(read_cores)
read rx_a tx_a <<<\\$(read_net)
read io_r_a io_w_a <<<\\$(read_io)
sleep 1
read cpu_b1 cpu_b2 <<<\\$(read_cpu)
cores_b=\\$(read_cores)
read rx_b tx_b <<<\\$(read_net)
read io_r_b io_w_b <<<\\$(read_io)
cpu_used=\\$((cpu_b1 - cpu_a1))
cpu_total=\\$((cpu_b2 - cpu_a2))
cpu_pct=0
[ \\$cpu_total -gt 0 ] && cpu_pct=\\$(awk -v u=\\$cpu_used -v t=\\$cpu_total "BEGIN{printf \\\"%.2f\\\", u*100/t}")
cores_json="["
n=0
for line_a in \\$cores_a; do
  line_b=\\$(echo "\\$cores_b" | sed -n "\\$((n+1))p")
  IFS="," read ua ta <<<"\\$line_a"
  IFS="," read ub tb <<<"\\$line_b"
  diff_u=\\$((ub - ua))
  diff_t=\\$((tb - ta))
  pct=0
  [ \\$diff_t -gt 0 ] && pct=\\$(awk -v u=\\$diff_u -v t=\\$diff_t "BEGIN{printf \\\"%.1f\\\", u*100/t}")
  [ \\$n -gt 0 ] && cores_json="\\$cores_json,"
  cores_json="\\$cores_json\\$pct"
  n=\\$((n+1))
done
cores_json="\\$cores_json]"
net_in=\\$((rx_b - rx_a))
net_out=\\$((tx_b - tx_a))
io_r=\\$((io_r_b - io_r_a))
io_w=\\$((io_w_b - io_w_a))
mem_total=\\$(awk "/^MemTotal:/ {print \\$2}" /proc/meminfo)
mem_avail=\\$(awk "/^MemAvailable:/ {print \\$2}" /proc/meminfo)
mem_used=\\$((mem_total - mem_avail))
mem_pct=\\$(awk -v u=\\$mem_used -v t=\\$mem_total "BEGIN{if(t==0)print 0; else printf \\\"%.2f\\\", u*100/t}")
disk_line=\\$(df -kP / | tail -1)
disk_used_k=\\$(echo "\\$disk_line" | awk "{print \\$3}")
disk_total_k=\\$(echo "\\$disk_line" | awk "{print \\$2}")
disk_pct=\\$(echo "\\$disk_line" | awk "{print \\$5}" | tr -d "%")
read l1 l5 l15 _ < /proc/loadavg
up=\\$(awk "{print \\$1}" /proc/uptime)
host=\\$(hostname)
printf "{\\"cpu\\":%s,\\"cores\\":%s,\\"memPct\\":%s,\\"memUsedKb\\":%s,\\"memTotalKb\\":%s,\\"diskPct\\":%s,\\"diskUsedKb\\":%s,\\"diskTotalKb\\":%s,\\"netIn\\":%s,\\"netOut\\":%s,\\"ioR\\":%s,\\"ioW\\":%s,\\"load1\\":%s,\\"load5\\":%s,\\"load15\\":%s,\\"up\\":%s,\\"host\\":\\"%s\\"}\\n" \\
  "\\$cpu_pct" "\\$cores_json" "\\$mem_pct" "\\$mem_used" "\\$mem_total" "\\$disk_pct" "\\$disk_used_k" "\\$disk_total_k" "\\$net_in" "\\$net_out" "\\$io_r" "\\$io_w" "\\$l1" "\\$l5" "\\$l15" "\\$up" "\\$host"
'`;

interface RawLinuxProbe {
  cpu: number;
  cores: number[];
  memPct: number;
  memUsedKb: number;
  memTotalKb: number;
  diskPct: number;
  diskUsedKb: number;
  diskTotalKb: number;
  netIn: number;
  netOut: number;
  ioR: number;
  ioW: number;
  load1: number;
  load5: number;
  load15: number;
  up: number;
  host: string;
}

async function execOnce(host: string, port: number, user: string, key: ProbeKey, cmd: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const conn = new SshClient();
    let timer: NodeJS.Timeout | null = null;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      try {
        conn.end();
      } catch {
        // ignore
      }
    };
    conn.on("ready", () => {
      conn.exec(cmd, (err, stream) => {
        if (err) {
          cleanup();
          reject(err);
          return;
        }
        let buf = "";
        let errBuf = "";
        stream
          .on("close", (code: number) => {
            cleanup();
            if (code !== 0 && !buf) reject(new Error(`exit ${code}: ${errBuf.slice(0, 256)}`));
            else resolve(buf);
          })
          .on("data", (d: Buffer) => {
            buf += d.toString("utf8");
          });
        stream.stderr.on("data", (d: Buffer) => {
          errBuf += d.toString("utf8");
        });
      });
    });
    conn.on("error", (err) => {
      cleanup();
      reject(err);
    });
    timer = setTimeout(() => {
      cleanup();
      reject(new Error("probe timeout (10s)"));
    }, 10_000);
    conn.connect({
      host,
      port,
      username: user,
      privateKey: key.privateKey,
      passphrase: key.passphrase,
      readyTimeout: 8_000,
    });
  });
}

/**
 * Probe a single instance over SSH using the account-level probe key. Returns
 * normalized metrics. Throws on connection/parse failures.
 */
export async function probeInstance(instanceId: string): Promise<ProbeMetrics> {
  const inst = await db.query.instances.findFirst({ where: eq(instances.id, instanceId) });
  if (!inst) throw new Error("Instance not found");
  if (!inst.publicIp && !inst.publicDns) throw new Error("Instance has no public IP/DNS");
  if (inst.platform !== "linux" && inst.platform !== "macos") {
    throw new Error(`Probe currently supports Linux/macOS only (got ${inst.platform})`);
  }

  const acc = await db.query.cloudAccounts.findFirst({
    where: eq(cloudAccounts.id, inst.accountId),
  });
  if (!acc) throw new Error("Account not found");
  if (!acc.probeKeyEnc) {
    throw new Error("No probe key uploaded for this account. Add one in Account settings.");
  }
  const key = decryptJSON<ProbeKey>(acc.probeKeyEnc);

  const host = inst.publicIp ?? inst.publicDns!;
  const port = 22;
  const user = key.defaultUser ?? defaultSshUser(inst.platform, inst.provider);

  const raw = await execOnce(host, port, user, key, LINUX_PROBE);
  let parsed: RawLinuxProbe;
  try {
    const firstLine = raw.split("\n").find((l) => l.startsWith("{")) ?? raw;
    parsed = JSON.parse(firstLine) as RawLinuxProbe;
  } catch (err) {
    throw new Error(`Probe parse failed: ${err instanceof Error ? err.message : "unknown"}`);
  }

  const collectedAt = Date.now();
  const metrics: ProbeMetrics = {
    cpu: parsed.cpu,
    cores: parsed.cores,
    mem: parsed.memPct,
    memUsedMb: Math.round(parsed.memUsedKb / 1024),
    memTotalMb: Math.round(parsed.memTotalKb / 1024),
    disk: parsed.diskPct,
    diskUsedGb: parsed.diskUsedKb / 1024 / 1024,
    diskTotalGb: parsed.diskTotalKb / 1024 / 1024,
    netIn: parsed.netIn,
    netOut: parsed.netOut,
    iopsRead: parsed.ioR,
    iopsWrite: parsed.ioW,
    load1: parsed.load1,
    load5: parsed.load5,
    load15: parsed.load15,
    uptimeSec: Math.round(parsed.up),
    hostname: parsed.host,
    collectedAt,
  };

  await db.insert(probeSamples).values({
    instanceId,
    metricsJson: JSON.stringify(metrics),
  });

  return metrics;
}
