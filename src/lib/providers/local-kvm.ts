import "server-only";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { Socket } from "node:net";
import { existsSync } from "node:fs";
import path from "node:path";
import type {
  CloudProvider,
  ConnectionInfo,
  CreateInstanceInput,
  InstanceTemplate,
  NormalizedInstance,
  NormalizedState,
  ProviderAccountInfo,
} from "./types";

const execFileP = promisify(execFile);

/**
 * Local KVM provider — drives a QEMU/KVM macOS VM running inside WSL2.
 *
 *  - One "account" = one WSL distro + path to OSX-KVM checkout.
 *  - Exposes its single VM as one synthetic instance ("local-mac").
 *  - Lifecycle: relies on `boot-mac.sh` writing /tmp/vmui-mac.pid and listening
 *    on QMP (TCP 4444) + VNC (TCP 5900) inside the WSL distro.
 *  - All shell commands go through wsl.exe via execFile (no shell quoting).
 */

export interface LocalKvmCredentials {
  /** WSL distro name (e.g. "Ubuntu") */
  distro: string;
  /** Absolute Linux path to the OSX-KVM checkout */
  vmDir: string;
  /** Display name shown in the UI */
  hostLabel: string;
  /** VNC port exposed on Windows host (default 5900) */
  vncPort: number;
  /** QMP TCP port on localhost (default 4444) */
  qmpPort: number;
  /** Forwarded SSH port (default 10022) */
  sshPort: number;
  /** WebSocket port for in-browser noVNC viewer (default 6080) */
  wsPort: number;
  /** Allocated RAM in MiB (default 16384). Applies on next boot. */
  ramMb: number;
  /** Cores per socket (default 4). Applies on next boot. */
  cores: number;
  /** Total vCPU threads, must be a multiple of cores (default 8). Applies on next boot. */
  threads: number;
}

const REGION = "wsl-local";
const VM_ID = "local-mac";

/**
 * Bash sampler for realtime stats. Piped via `bash -s` so we never have to
 * worry about double/single quote escaping through PowerShell + wsl.exe + bash.
 *
 * Computes CPU% **stateless** by sampling /proc/<pid>/stat twice with a
 * 500 ms gap inside this single invocation. This avoids races between
 * concurrent consumers of the action (e.g. inline panel + dialog) sharing
 * the same prev-sample slot, which previously caused tiny dt's and CPU%
 * pinned at 100. cpuPct is "% of total vCPUs busy" (0..100, 2 decimals).
 *
 * Output: a single line — either `NORUN` or
 *   OK <pid> <cpuPct> <vmRssKb> <readBytes> <writeBytes> <rxBytes> <txBytes> <uptimeSec> <qemuMem_MiB> <vcpus>
 */
const STATS_SCRIPT = `set -u
PID="$(cat /tmp/vmui-mac.pid 2>/dev/null || true)"
if [ -z "\${PID}" ] || [ ! -d "/proc/\${PID}" ]; then echo NORUN; exit 0; fi

read_ust() {
  awk '{n=index($0,")"); s=substr($0,n+1); split(s,a," "); print a[12]+a[13]}' /proc/$1/stat 2>/dev/null
}

CLK="$(getconf CLK_TCK)"; CLK="\${CLK:-100}"
SAMPLE_MS=500
UST1="$(read_ust \${PID})"
UST1="\${UST1:-0}"
sleep 0.5
UST2="$(read_ust \${PID})"
UST2="\${UST2:-0}"

# vCPU count from -smp (first numeric token).
VCPUS="$(tr '\\0' ' ' < /proc/\${PID}/cmdline | grep -oE -- '-smp [0-9]+' | head -1 | awk '{print $2}')"
VCPUS="\${VCPUS:-1}"

# CPU% = (delta_ticks / clk) / dt_sec / vcpus * 100. Compute in awk for floats.
CPU_PCT="$(awk -v a="\${UST1}" -v b="\${UST2}" -v clk="\${CLK}" -v ms="\${SAMPLE_MS}" -v n="\${VCPUS}" 'BEGIN { d=b-a; if (d<0) d=0; pct=(d/clk)/(ms/1000)/n*100; if (pct<0) pct=0; if (pct>100) pct=100; printf "%.2f", pct }')"

RSS="$(awk '/^VmRSS:/{print $2}' /proc/\${PID}/status)"
RB="$(awk '/^read_bytes:/{print $2}' /proc/\${PID}/io 2>/dev/null || echo 0)"
WB="$(awk '/^write_bytes:/{print $2}' /proc/\${PID}/io 2>/dev/null || echo 0)"
NET="$(awk 'NR>2 && $1!="lo:"{rx+=$2; tx+=$10} END{print rx+0,tx+0}' /proc/net/dev)"
RX="\${NET% *}"
TX="\${NET#* }"
UP="$(awk '{print int($1)}' /proc/uptime)"
MEM="$(tr '\\0' ' ' < /proc/\${PID}/cmdline | grep -oE -- '-m [0-9]+' | awk '{print $2}' | head -1)"
MEM="\${MEM:-0}"

echo "OK \${PID} \${CPU_PCT} \${RSS:-0} \${RB:-0} \${WB:-0} \${RX:-0} \${TX:-0} \${UP:-0} \${MEM} \${VCPUS}"
`;

/** Run a single bash -lc command inside the named WSL distro. */
async function wslExec(distro: string, cmd: string): Promise<string> {
  const { stdout } = await execFileP(
    "wsl.exe",
    ["-d", distro, "--", "bash", "-lc", cmd],
    { maxBuffer: 4 * 1024 * 1024, encoding: "utf8", windowsHide: true },
  );
  return stdout.replace(/\r/g, "").trim();
}

/** Send one QMP command and return parsed reply.return */
async function qmp(port: number, command: string, args?: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const sock = new Socket();
    let buf = "";
    let stage: "greet" | "negotiate" | "command" = "greet";
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error("QMP timeout"));
    }, 5000);

    sock.connect(port, "127.0.0.1");

    sock.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (stage === "greet" && "QMP" in msg) {
            stage = "negotiate";
            sock.write(JSON.stringify({ execute: "qmp_capabilities" }) + "\n");
          } else if (stage === "negotiate" && "return" in msg) {
            stage = "command";
            sock.write(
              JSON.stringify(args ? { execute: command, arguments: args } : { execute: command }) + "\n",
            );
          } else if (stage === "command") {
            clearTimeout(timer);
            sock.end();
            if ("error" in msg) {
              reject(new Error((msg as { error: { desc: string } }).error.desc));
            } else {
              resolve((msg as { return: unknown }).return);
            }
          }
        } catch {
          /* incomplete json line */
        }
      }
    });

    sock.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

const TEMPLATES: InstanceTemplate[] = [
  {
    id: "local-macos",
    label: "macOS (Local KVM)",
    platform: "macos",
    description: "Local QEMU/KVM macOS VM running inside WSL2. Uses OSX-KVM + OpenCore.",
    recommendedTypes: ["8c-16g", "4c-8g", "16c-32g"],
    notes: [
      "Requires WSL2 with /dev/kvm exposed and OSX-KVM checked out at the configured path.",
      "VNC accessible on localhost:5900 (auto-forwarded by WSL2 to Windows).",
      "First boot needs interactive macOS install via Disk Utility → Reinstall macOS.",
      "Note: Apple's macOS license forbids running macOS on non-Apple hardware. Use at your own risk.",
    ],
  },
];

/** Build a RealVNC / TightVNC / UltraVNC compatible .vnc connection file. */
function buildVncFile(host: string, port: number): string {
  return [
    "[Connection]",
    `Host=${host}:${port}`,
    "[Options]",
    "UseLocalCursor=1",
    "FullScreen=0",
    "Encoding=Tight",
    "ColorLevel=full",
    "Compression=6",
    "QualityLevel=8",
    "AutoSelect=1",
    "",
  ].join("\r\n");
}

export class LocalKvmProvider implements CloudProvider {
  readonly id = "local-kvm" as const;
  private creds: LocalKvmCredentials;

  constructor(creds: LocalKvmCredentials) {
    this.creds = creds;
  }

  async verify(): Promise<ProviderAccountInfo> {
    const out = await wslExec(
      this.creds.distro,
      `if [ -d "${this.creds.vmDir}" ] && [ -x "${this.creds.vmDir}/boot-mac.sh" ] && [ -e /dev/kvm ]; then echo OK; else echo MISSING; fi`,
    );
    if (!out.includes("OK")) {
      throw new Error(
        `WSL distro "${this.creds.distro}" does not have a usable VM at ${this.creds.vmDir}. ` +
          `Ensure boot-mac.sh exists, is executable, and /dev/kvm is accessible.`,
      );
    }
    return {
      accountId: `${this.creds.distro}:${this.creds.vmDir}`,
      label: this.creds.hostLabel,
    };
  }

  async listRegions(): Promise<string[]> {
    return [REGION];
  }

  /** Map QMP query-status `status` field to our normalized state. */
  private mapQmpStatus(s: string | undefined): NormalizedState {
    switch (s) {
      case "running":
        return "running";
      case "paused":
      case "suspended":
      case "prelaunch":
        return "pending";
      case "shutdown":
      case "guest-panicked":
      case "internal-error":
        return "stopping";
      default:
        return "running";
    }
  }

  private async getState(): Promise<NormalizedInstance> {
    // Source of truth = the actual qemu process. The -pidfile is unreliable
    // (qemu deletes it on exit, and races during watchdog restarts can leave
    // it stale or missing while the VM is healthy). Match by command line so
    // we only count *our* qemu (different QMP port = different VM).
    let numericPid = "0";
    try {
      const out = await wslExec(
        this.creds.distro,
        `pgrep -af 'qemu-system-x86_64.*qmp tcp:127.0.0.1:${this.creds.qmpPort}' 2>/dev/null | awk '{print $1; exit}'`,
      );
      numericPid = out.trim().replace(/\D/g, "") || "0";
    } catch {
      numericPid = "0";
    }
    const alive = !!numericPid && numericPid !== "0";

    let state: NormalizedState = alive ? "running" : "stopped";
    if (alive) {
      try {
        const status = (await qmp(this.creds.qmpPort, "query-status")) as { status?: string };
        state = this.mapQmpStatus(status.status);
      } catch {
        // QMP not responsive yet — leave as "running"
      }
    }

    const instanceType = `${this.creds.cores}c-${Math.round(this.creds.ramMb / 1024)}g`;

    return {
      providerInstanceId: VM_ID,
      region: REGION,
      name: this.creds.hostLabel,
      state,
      platform: "macos",
      instanceType,
      publicIp: "127.0.0.1",
      publicDns: null,
      privateIp: null,
      keyName: null,
      raw: { pid: numericPid, distro: this.creds.distro, vmDir: this.creds.vmDir, alive },
    };
  }

  async listInstances(): Promise<NormalizedInstance[]> {
    return [await this.getState()];
  }

  async getInstance(_region: string, id: string): Promise<NormalizedInstance | null> {
    if (id !== VM_ID) return null;
    return await this.getState();
  }

  async startInstance(): Promise<void> {
    // 1) Sync hardware config + boot-mac.sh into the VM dir.
    //    The VM is launched by a Windows-side watchdog process (see (2)),
    //    which keeps the WSL distro alive — without it, WSL2 idle-shuts
    //    the distro after ~60s and kills QEMU.
    await wslExec(
      this.creds.distro,
      `cd "${this.creds.vmDir}" && rm -f /tmp/vmui-mac.log /tmp/vmui-mac.qemu.log /tmp/vmui-mac.pid && ` +
        // make sure latest boot-mac.sh is in place if vmui repo is mounted
        `if [ -f /mnt/e/gh/vmui/scripts/boot-mac.sh ]; then cp /mnt/e/gh/vmui/scripts/boot-mac.sh ./boot-mac.sh && chmod +x ./boot-mac.sh; fi; ` +
        // also drop the foreground runner so the watchdog can call it
        `if [ -f /mnt/e/gh/vmui/scripts/run-mac-foreground.sh ]; then cp /mnt/e/gh/vmui/scripts/run-mac-foreground.sh /tmp/run-mac-foreground.sh && chmod +x /tmp/run-mac-foreground.sh; fi; ` +
        `echo READY`,
    );

    // 2) Spawn the watchdog as a fully-detached Windows process. It runs
    //    `wsl.exe -d <distro> -- bash run-mac-foreground.sh` and re-runs it
    //    on exit. The PowerShell process holds a Windows handle on the WSL
    //    VM, defeating idle-shutdown.
    const repoRoot = process.cwd();
    const wdScript = path.join(repoRoot, "scripts", "watchdog-mac.ps1");
    const spawnerScript = path.join(repoRoot, "scripts", "spawn-watchdog.ps1");
    if (!existsSync(wdScript) || !existsSync(spawnerScript)) {
      throw new Error(
        `watchdog scripts not found in ${path.dirname(wdScript)}`,
      );
    }

    // Kill any existing watchdog (PID file) so we don't stack them.
    await this.killWatchdog().catch(() => {});

    // Why we go through a small launcher .ps1 instead of spawning powershell
    // directly with `detached: true`:
    //   - On Windows, Next.js dev (and Node generally) puts spawned children
    //     in a Job Object. SIGHUP/termination propagates when the Server
    //     Action returns. The child gets killed → wsl.exe handle drops → WSL
    //     idle-shuts → QEMU dies.
    //   - PowerShell's `Start-Process` uses a CreateProcess flow that does
    //     NOT inherit the job object, so the watchdog truly outlives us.
    //   - Doing it via a dedicated .ps1 file (instead of -Command launcher)
    //     avoids cross-platform argv quoting hell.
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-WindowStyle",
        "Hidden",
        "-File",
        spawnerScript,
        "-Distro",
        this.creds.distro,
        "-AllocatedRamMb",
        String(this.creds.ramMb),
        "-Cores",
        String(this.creds.cores),
        "-Threads",
        String(this.creds.threads),
        "-VncDisplay",
        String(this.creds.vncPort - 5900),
        "-QmpPort",
        String(this.creds.qmpPort),
        "-SshPort",
        String(this.creds.sshPort),
      ],
      { detached: true, stdio: "ignore", windowsHide: true },
    );
    child.unref();

    // Wait for QEMU to actually start listening on the QMP port (the most
    // reliable readiness signal — pidfile is unreliable across restarts).
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 800));
      const ready = await wslExec(
        this.creds.distro,
        `ss -tln 2>/dev/null | grep -q ':${this.creds.qmpPort} ' && echo READY || echo no`,
      );
      if (ready.includes("READY")) break;
    }
  }

  /** Kill the Windows watchdog process (matched by command-line tag). */
  private async killWatchdog(): Promise<void> {
    // Find watchdog powershell processes by their script path + QMP port arg.
    const findCmd = `Get-CimInstance Win32_Process -Filter "Name='powershell.exe' OR Name='pwsh.exe'" | Where-Object { $_.CommandLine -like '*watchdog-mac.ps1*' -and $_.CommandLine -like '*-QmpPort ${this.creds.qmpPort}*' } | Select-Object -ExpandProperty ProcessId`;
    try {
      const { stdout } = await execFileP(
        "powershell.exe",
        ["-NoProfile", "-WindowStyle", "Hidden", "-Command", findCmd],
        { windowsHide: true },
      );
      const pids = stdout
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter((s) => /^\d+$/.test(s));
      for (const pid of pids) {
        try {
          await execFileP("taskkill.exe", ["/PID", pid, "/T", "/F"], {
            windowsHide: true,
          });
        } catch {
          /* already gone */
        }
      }
    } catch {
      /* ignore — best effort */
    }
  }

  async stopInstance(): Promise<void> {
    // Stop the watchdog first so it doesn't auto-restart QEMU.
    await this.killWatchdog().catch(() => {});
    try {
      await qmp(this.creds.qmpPort, "system_powerdown");
    } catch {
      // QMP unreachable; fall back to SIGTERM by command-line match.
      await wslExec(
        this.creds.distro,
        `pkill -f 'qemu-system-x86_64.*qmp tcp:127.0.0.1:${this.creds.qmpPort}' 2>/dev/null || true`,
      );
    }
  }

  async rebootInstance(): Promise<void> {
    await qmp(this.creds.qmpPort, "system_reset");
  }

  async terminateInstance(): Promise<void> {
    // "Terminate" = hard kill. Does NOT delete the disk image.
    await this.killWatchdog().catch(() => {});
    try {
      await qmp(this.creds.qmpPort, "quit");
    } catch {
      await wslExec(
        this.creds.distro,
        `pkill -9 -f 'qemu-system-x86_64.*qmp tcp:127.0.0.1:${this.creds.qmpPort}' 2>/dev/null || true`,
      );
    }
  }

  async createInstance(_input: CreateInstanceInput): Promise<NormalizedInstance> {
    await this.startInstance();
    await new Promise((r) => setTimeout(r, 1500));
    return await this.getState();
  }

  async getConnectionInfo(): Promise<ConnectionInfo> {
    const host = "127.0.0.1";
    const vncPort = this.creds.vncPort;
    const sshPort = this.creds.sshPort;
    const vncFile = buildVncFile(host, vncPort);

    return {
      protocol: "vnc",
      host,
      port: vncPort,
      username: "(set during macOS install)",
      vncUrl: `vnc://${host}:${vncPort}`,
      sshCommand: `ssh -p ${sshPort} <user>@${host}`,
      fileContent: vncFile,
      fileName: "vmui-mac.vnc",
      fileMime: "application/x-vnc",
      notes: [
        `VNC: open any VNC client and connect to ${host}:${vncPort}.`,
        "Quickest path: download the .vnc file below and double-click it (RealVNC / TightVNC / UltraVNC).",
        `SSH (after enabling Remote Login on the Mac): ssh -p ${sshPort} <user>@${host}`,
        `WSL distro: ${this.creds.distro} · VM dir: ${this.creds.vmDir}`,
        `QMP (vmui control plane): ${host}:${this.creds.qmpPort}`,
      ],
    };
  }

  async listInstanceTemplates(): Promise<InstanceTemplate[]> {
    return TEMPLATES;
  }

  // ===== Local-KVM-specific extensions (not part of CloudProvider) =====

  /** Read the credentials (so server actions can derive ports/distro etc.) */
  getCredentials(): Readonly<LocalKvmCredentials> {
    return this.creds;
  }

  /** Whether websockify is running and listening on wsPort. */
  async isBridgeRunning(): Promise<boolean> {
    try {
      const out = await wslExec(
        this.creds.distro,
        `ss -tln 2>/dev/null | awk '{print $4}' | grep -q ':${this.creds.wsPort}$' && echo YES || echo NO`,
      );
      return out.includes("YES");
    } catch {
      return false;
    }
  }

  /**
   * Start a websockify bridge so the browser can connect to noVNC over
   * ws://localhost:wsPort. Idempotent — no-op if already running.
   * Returns the ws URL.
   */
  async startBridge(): Promise<string> {
    if (await this.isBridgeRunning()) {
      return `ws://127.0.0.1:${this.creds.wsPort}`;
    }
    // Detached websockify: bridges TCP $vncPort <-> WS $wsPort
    await wslExec(
      this.creds.distro,
      `nohup setsid websockify --daemon --log-file=/tmp/vmui-mac-ws.log ${this.creds.wsPort} 127.0.0.1:${this.creds.vncPort} </dev/null >/dev/null 2>&1 & disown; sleep 1; ss -tln | grep -q ':${this.creds.wsPort}' && echo OK || echo FAIL`,
    );
    // Re-check
    const ok = await this.isBridgeRunning();
    if (!ok) {
      throw new Error(`Failed to start websockify bridge on port ${this.creds.wsPort}. Is the package installed (apt install websockify)?`);
    }
    return `ws://127.0.0.1:${this.creds.wsPort}`;
  }

  /** Stop the websockify bridge, if running. */
  async stopBridge(): Promise<void> {
    try {
      await wslExec(
        this.creds.distro,
        `pkill -f "websockify.*${this.creds.wsPort} 127.0.0.1:${this.creds.vncPort}" 2>/dev/null || true`,
      );
    } catch {
      /* ignore */
    }
  }

  /**
   * Sample the QEMU host process for realtime resource usage.
   * CPU% is computed in-script across a fixed 500 ms gap so callers can be
   * stateless. Counters are still raw — the action layer derives Bps deltas.
   *
   * Implemented by piping the script via `bash -s` to avoid quoting hell.
   */
  async getStatsRaw(): Promise<{
    pid: number;
    cpuPct: number;
    rssKb: number;
    readBytes: number;
    writeBytes: number;
    rxBytes: number;
    txBytes: number;
    uptimeSeconds: number;
    qemuMemBytes: number;
    vcpus: number;
  } | null> {
    try {
      const out = await new Promise<string>((resolve, reject) => {
        const proc = execFile(
          "wsl.exe",
          ["-d", this.creds.distro, "--", "bash", "-s"],
          { timeout: 5000, maxBuffer: 64 * 1024 },
          (err, stdout) => (err ? reject(err) : resolve(stdout)),
        );
        proc.stdin?.end(STATS_SCRIPT);
      });

      const trimmed = out.trim();
      if (!trimmed || trimmed.startsWith("NORUN")) return null;
      const parts = trimmed.split(/\s+/);
      if (parts[0] !== "OK" || parts.length < 11) return null;

      const [, pid, cpu, rss, rb, wb, rx, tx, up, memMb, vcpus] = parts;
      return {
        pid: Number(pid),
        cpuPct: Number(cpu),
        rssKb: Number(rss),
        readBytes: Number(rb),
        writeBytes: Number(wb),
        rxBytes: Number(rx),
        txBytes: Number(tx),
        uptimeSeconds: Number(up),
        qemuMemBytes: Number(memMb) * 1024 * 1024,
        vcpus: Number(vcpus) || 1,
      };
    } catch {
      return null;
    }
  }

  /** Number of vCPUs configured for the QEMU process (parses -smp from cmdline). */
  async getVcpuCount(): Promise<number> {
    try {
      const out = await wslExec(
        this.creds.distro,
        `PID=$(cat /tmp/vmui-mac.pid 2>/dev/null) && tr '\\0' ' ' < /proc/$PID/cmdline | grep -oE -- '-smp [^ ]+' | head -1 | awk '{print $2}'`,
      );
      const m = out.trim().match(/^(\d+)/);
      return m ? Number(m[1]) : 1;
    } catch {
      return 1;
    }
  }
}
