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
  Platform,
  ProviderAccountInfo,
} from "./types";

const execFileP = promisify(execFile);

/**
 * Local KVM / local Hyper-V provider — drives a VM on the same Windows host.
 *
 * Supports four kinds, selected at account-creation time:
 *   - "mac"        → macOS (OSX-KVM/OpenCore) inside WSL2/QEMU  (VNC 5900, QMP 4444)
 *   - "win"        → Win11 (UEFI+SecureBoot+TPM) inside WSL2/QEMU (VNC 6900, QMP 4445)
 *   - "ubuntu"     → Ubuntu LTS desktop inside WSL2/QEMU         (VNC 7900, QMP 4446)
 *   - "hyperv-win" → Win11 native on Microsoft Hyper-V (Gen2)    (vmconnect console)
 *
 * For "mac"/"win"/"ubuntu" the lifecycle is driven by the watchdog
 * (scripts/watchdog-vm.ps1) which holds an open wsl.exe handle to defeat
 * WSL2's 60-second idle-shutdown.
 *
 * For "hyperv-win" we dispatch to PowerShell Hyper-V cmdlets directly —
 * no WSL involvement, no QEMU, no watchdog. The current user must be
 * elevated OR a member of "Hyper-V Administrators" (see
 * scripts/grant-hyperv-admin.ps1).
 *
 * All shell commands go through wsl.exe / powershell.exe via execFile
 * (no shell quoting).
 */

export type LocalKvmKind = "mac" | "win" | "ubuntu" | "hyperv-win";

export interface LocalKvmCredentials {
  /** Guest kind. Drives all kind-specific defaults / paths. */
  kind: LocalKvmKind;
  /** WSL distro name (e.g. "Ubuntu-24.04") */
  distro: string;
  /** Absolute Linux path to the VM directory inside the distro. */
  vmDir: string;
  /** Display name shown in the UI */
  hostLabel: string;
  /** VNC port exposed on Windows host */
  vncPort: number;
  /** QMP TCP port on localhost */
  qmpPort: number;
  /** Forwarded SSH port on the Windows host */
  sshPort: number;
  /** WebSocket port for in-browser noVNC viewer */
  wsPort: number;
  /** Allocated RAM in MiB. Applies on next boot. */
  ramMb: number;
  /** Cores per socket. Applies on next boot. */
  cores: number;
  /** Total vCPU threads, must be a multiple of cores. Applies on next boot. */
  threads: number;
  /**
   * Guest OS username baked into the unattended install (cloud-init for
   * Ubuntu, autounattend for Windows). Optional — defaults to "dragos".
   * Only meaningful at first-time setup; changing it after install does
   * not rename the existing user.
   */
  osUsername?: string;
  /**
   * Guest OS password baked into the unattended install. Optional —
   * defaults to "REDACTED_GUEST_PASSWORD". Stored encrypted alongside the rest of the
   * credentials blob.
   */
  osPassword?: string;
  /**
   * Hyper-V VM name. Only meaningful for kind === "hyperv-win". Defaults
   * to "vmui-win" (matches scripts/setup-win-hyperv.ps1).
   */
  hypervVmName?: string;
}

const REGION = "wsl-local";

/** Default settings per guest kind. UI form falls back to these when fields blank. */
export interface KindDefaults {
  vmDir: string;
  vncPort: number;
  qmpPort: number;
  sshPort: number;
  wsPort: number;
  ramMb: number;
  cores: number;
  threads: number;
  platform: Platform;
  hostLabelHint: string;
  vmIdSuffix: string;
}

export const KIND_DEFAULTS: Record<LocalKvmKind, KindDefaults> = {
  mac: {
    vmDir: "/home/dragos/OSX-KVM",
    vncPort: 5900,
    qmpPort: 4444,
    sshPort: 10022,
    wsPort: 6080,
    ramMb: 16384,
    cores: 4,
    threads: 8,
    platform: "macos",
    hostLabelHint: "Local Mac (KVM)",
    vmIdSuffix: "mac",
  },
  win: {
    vmDir: "/home/dragos/vmui-vms/win",
    vncPort: 6900,
    qmpPort: 4445,
    sshPort: 10023,
    wsPort: 6090,
    ramMb: 8192,
    cores: 4,
    threads: 8,
    platform: "windows",
    hostLabelHint: "Local Windows 11 (KVM)",
    vmIdSuffix: "win",
  },
  ubuntu: {
    vmDir: "/home/dragos/vmui-vms/ubuntu",
    vncPort: 7900,
    qmpPort: 4446,
    sshPort: 10024,
    wsPort: 6100,
    ramMb: 4096,
    cores: 2,
    threads: 4,
    platform: "linux",
    hostLabelHint: "Local Ubuntu (KVM)",
    vmIdSuffix: "ubuntu",
  },
  // Hyper-V Windows guest — no WSL, no QEMU. The vmDir/vncPort/qmpPort/
  // wsPort/sshPort fields are unused for this kind but kept populated so
  // the credential shape stays uniform with the WSL/QEMU kinds.
  "hyperv-win": {
    vmDir: "",
    vncPort: 0,
    qmpPort: 0,
    sshPort: 13389, // RDP port on the Hyper-V Default Switch (NAT)
    wsPort: 0,
    ramMb: 8192,
    cores: 4,
    threads: 8,
    platform: "windows",
    hostLabelHint: "Local Windows 11 (Hyper-V)",
    vmIdSuffix: "hyperv-win",
  },
};

/**
 * Bash sampler for realtime stats. Piped via `bash -s` so we never have to
 * worry about double/single quote escaping. The pidfile path is templated
 * per-kind so each VM samples its own QEMU process.
 *
 * Output: a single line — either `NORUN` or
 *   OK <pid> <cpuPct> <vmRssKb> <readBytes> <writeBytes> <rxBytes> <txBytes> <uptimeSec> <qemuMem_MiB> <vcpus>
 */
function statsScript(pidFile: string): string {
  return `set -u
PID="$(cat ${pidFile} 2>/dev/null || true)"
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

VCPUS="$(tr '\\0' ' ' < /proc/\${PID}/cmdline | grep -oE -- '-smp [0-9]+' | head -1 | awk '{print $2}')"
VCPUS="\${VCPUS:-1}"

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
}

/** Run a single bash -lc command inside the named WSL distro. */
async function wslExec(distro: string, cmd: string): Promise<string> {
  const { stdout } = await execFileP(
    "wsl.exe",
    ["-d", distro, "--", "bash", "-lc", cmd],
    { maxBuffer: 4 * 1024 * 1024, encoding: "utf8", windowsHide: true },
  );
  return stdout.replace(/\r/g, "").trim();
}

/**
 * Run a PowerShell snippet on the Windows host. Used by the "hyperv-win"
 * kind so we can drive Hyper-V cmdlets directly without going through WSL.
 */
async function psExec(script: string): Promise<string> {
  const { stdout } = await execFileP(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
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

const TEMPLATES_BY_KIND: Record<LocalKvmKind, InstanceTemplate[]> = {
  mac: [
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
        "Apple's macOS license forbids running macOS on non-Apple hardware. Use at your own risk.",
      ],
    },
  ],
  win: [
    {
      id: "local-windows-11",
      label: "Windows 11 (Local KVM)",
      platform: "windows",
      description:
        "Local QEMU/KVM Windows 11 (25H2) VM with UEFI Secure Boot + emulated TPM 2.0 (swtpm).",
      recommendedTypes: ["4c-8g", "8c-16g"],
      notes: [
        "Run scripts/setup-win-vm.sh once to download VirtIO drivers, build the autounattend ISO and create the qcow2.",
        "Drop the official Windows 11 ISO at ~/vmui-vms/win/Win11.iso before first boot.",
        "Default credentials baked in: dragos / REDACTED_GUEST_PASSWORD (local Administrator).",
        "VNC :6900 · RDP :13389 · SSH :10023 (all on 127.0.0.1).",
      ],
    },
  ],
  ubuntu: [
    {
      id: "local-ubuntu-lts",
      label: "Ubuntu LTS Desktop (Local KVM)",
      platform: "linux",
      description:
        "Local QEMU/KVM Ubuntu desktop VM. Latest LTS (26.04 'Resolute Raccoon') by default.",
      recommendedTypes: ["2c-4g", "4c-8g"],
      notes: [
        "Run scripts/setup-ubuntu-vm.sh once to download the ISO, build the cloud-init seed and create the qcow2.",
        "First boot runs the unattended autoinstall (~10 minutes).",
        "Default credentials baked in: dragos / REDACTED_GUEST_PASSWORD (sudo NOPASSWD).",
        "VNC :7900 · SSH :10024 (on 127.0.0.1).",
      ],
    },
  ],
  "hyperv-win": [
    {
      id: "local-windows-11-hyperv",
      label: "Windows 11 (Local Hyper-V)",
      platform: "windows",
      description:
        "Native Windows 11 (25H2) Enterprise on Microsoft Hyper-V. Gen2 VM with vTPM 2.0, Secure Boot (Microsoft template), nested virtualisation enabled.",
      recommendedTypes: ["4c-8g", "8c-16g"],
      notes: [
        "Run scripts/install-adk-oscdimg.ps1 once (elevated) to install the Microsoft ADK oscdimg tool.",
        "Run scripts/grant-hyperv-admin.ps1 once (elevated) and sign out / in to use Hyper-V without UAC.",
        "Drop the Win11 Enterprise ISO at E:\\Hyper-V\\vmui\\Win11-Enterprise.iso then run scripts/setup-win-hyperv.ps1.",
        "Default credentials baked in: dragos / REDACTED_GUEST_PASSWORD (local Administrator).",
        "Console: vmconnect.exe localhost vmui-win · RDP via guest IP shown in the UI.",
      ],
    },
  ],
};

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

  // ===== kind-derived helpers =====

  private get kind(): LocalKvmKind {
    return this.creds.kind;
  }
  private get pidFile(): string {
    return `/tmp/vmui-${this.kind}.pid`;
  }
  private get logFile(): string {
    return `/tmp/vmui-${this.kind}.log`;
  }
  private get qemuLogFile(): string {
    return `/tmp/vmui-${this.kind}.qemu.log`;
  }
  private get vmId(): string {
    return `local-${KIND_DEFAULTS[this.kind].vmIdSuffix}`;
  }
  private get platform(): Platform {
    return KIND_DEFAULTS[this.kind].platform;
  }

  async verify(): Promise<ProviderAccountInfo> {
    if (this.kind === "hyperv-win") {
      // Probe Hyper-V availability. `Get-VMHost` succeeds only when the
      // current security context can use Hyper-V cmdlets (admin OR member
      // of "Hyper-V Administrators"); a friendly message explains the fix.
      try {
        const out = await psExec(
          `try { Get-VMHost -ErrorAction Stop | Select-Object -ExpandProperty Name } catch { Write-Output ("ERR:" + $_.Exception.Message) }`,
        );
        if (out.startsWith("ERR:")) {
          throw new Error(
            `Hyper-V cmdlets refused: ${out.slice(4)}.\n` +
              `Run scripts/grant-hyperv-admin.ps1 (elevated) once, then sign out and back in.`,
          );
        }
      } catch (err) {
        throw new Error(
          err instanceof Error
            ? err.message
            : "Failed to probe Hyper-V (powershell.exe Get-VMHost).",
        );
      }
      const vmName = this.creds.hypervVmName ?? "vmui-win";
      return {
        accountId: `hyperv:${vmName}`,
        label: this.creds.hostLabel,
      };
    }

    // We deliberately don't require the boot scripts to be present in vmDir
    // pre-flight — run-vm-foreground.sh syncs them from the repo at launch.
    // We only need: distro responsive, /dev/kvm exposed, qemu installed.
    const out = await wslExec(
      this.creds.distro,
      `if [ -e /dev/kvm ] && command -v qemu-system-x86_64 >/dev/null; then echo OK; else echo MISSING; fi`,
    );
    if (!out.includes("OK")) {
      throw new Error(
        `WSL distro "${this.creds.distro}" is missing /dev/kvm or qemu-system-x86_64. ` +
          `Install QEMU and ensure CPU virtualization is enabled (run scripts/setup-${this.kind === "mac" ? "osx-kvm" : this.kind === "win" ? "win-vm" : "ubuntu-vm"}.sh).`,
      );
    }
    return {
      accountId: `${this.creds.distro}:${this.kind}:${this.creds.vmDir}`,
      label: this.creds.hostLabel,
    };
  }

  /**
   * Write `vm-creds.env` into the WSL distro at `vmDir`. The Ubuntu/Windows
   * setup scripts source this file (when present) before generating the
   * cloud-init seed / autounattend ISO, so per-account custom credentials
   * flow end-to-end from the UI through to the unattended install.
   *
   * No-op for "mac" (macOS install is interactive).
   * No-op when osUsername/osPassword are unset (defaults are baked in).
   *
   * The file is written via base64 transport to avoid any quoting issues
   * with passwords containing $, `, ", \, newlines, etc., and chmod 600 so
   * other unprivileged users on the WSL distro can't read it.
   */
  async writeOsCredsFile(): Promise<void> {
    if (this.kind === "mac") return;
    const user = this.creds.osUsername?.trim();
    const pass = this.creds.osPassword;
    if (!user && !pass) return;

    // Bash-safe single-quoted literal: any embedded ' becomes '\''.
    const sq = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";

    const lines: string[] = [];
    if (this.kind === "ubuntu") {
      if (user) lines.push(`UBUNTU_USERNAME=${sq(user)}`);
      if (pass) lines.push(`UBUNTU_PASSWORD=${sq(pass)}`);
    } else if (this.kind === "win") {
      // Windows setup script (setup-win-vm.sh) reads these names.
      if (user) lines.push(`WIN_USERNAME=${sq(user)}`);
      if (pass) lines.push(`WIN_PASSWORD=${sq(pass)}`);
    }
    if (lines.length === 0) return;
    const content = lines.join("\n") + "\n";
    const b64 = Buffer.from(content, "utf8").toString("base64");

    // vmDir is validated upstream as an absolute Linux path (regex /^\/[^\0]+$/).
    // We single-quote it for an extra belt-and-braces guard against shell
    // metacharacters reaching bash.
    const dir = sq(this.creds.vmDir);
    const file = sq(`${this.creds.vmDir}/vm-creds.env`);
    await wslExec(
      this.creds.distro,
      `mkdir -p ${dir} && echo ${sq(b64)} | base64 -d > ${file} && chmod 600 ${file}`,
    );
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
    if (this.kind === "hyperv-win") {
      return await this.getStateHyperV();
    }

    // Source of truth = the actual qemu process. Match by command line so
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
      providerInstanceId: this.vmId,
      region: REGION,
      name: this.creds.hostLabel,
      state,
      platform: this.platform,
      instanceType,
      publicIp: "127.0.0.1",
      publicDns: null,
      privateIp: null,
      keyName: null,
      raw: {
        pid: numericPid,
        kind: this.kind,
        distro: this.creds.distro,
        vmDir: this.creds.vmDir,
        alive,
      },
    };
  }

  async listInstances(): Promise<NormalizedInstance[]> {
    return [await this.getState()];
  }

  async getInstance(_region: string, id: string): Promise<NormalizedInstance | null> {
    if (id !== this.vmId) return null;
    return await this.getState();
  }

  async startInstance(): Promise<void> {
    if (this.kind === "hyperv-win") {
      const vmName = this.hypervVmName;
      await psExec(
        `try { Start-VM -Name '${vmName}' -ErrorAction Stop } catch { if ($_.Exception.Message -notmatch 'already in') { throw } }`,
      );
      return;
    }

    // 1) Pre-clean stale runtime files. The watchdog also cleans, but doing it
    //    here makes the UI feel snappy (state flips to "stopped" → "pending"
    //    immediately rather than waiting for the watchdog to spin up).
    await wslExec(
      this.creds.distro,
      `rm -f ${this.logFile} ${this.qemuLogFile} ${this.pidFile} && ` +
        // Also sync the runner script in case it moved.
        `if [ -f /mnt/e/gh/vmui/scripts/run-vm-foreground.sh ]; then cp /mnt/e/gh/vmui/scripts/run-vm-foreground.sh /tmp/run-vm-foreground.sh && chmod +x /tmp/run-vm-foreground.sh; fi; ` +
        `echo READY`,
    );

    // 2) Spawn the watchdog as a fully-detached Windows process. It runs
    //    `wsl.exe -d <distro> -- bash run-vm-foreground.sh` and re-runs it
    //    on exit, holding a Windows handle on the WSL VM to defeat
    //    idle-shutdown.
    const repoRoot = process.cwd();
    const wdScript = path.join(repoRoot, "scripts", "watchdog-vm.ps1");
    const spawnerScript = path.join(repoRoot, "scripts", "spawn-watchdog.ps1");
    if (!existsSync(wdScript) || !existsSync(spawnerScript)) {
      throw new Error(`watchdog scripts not found in ${path.dirname(wdScript)}`);
    }

    // Kill any existing watchdog (PID file) so we don't stack them.
    await this.killWatchdog().catch(() => {});

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
        "-Kind",
        this.kind,
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

    // Wait for QEMU to actually start listening on the QMP port.
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

  /** Kill the Windows watchdog process for this VM (matched by kind + QMP port). */
  private async killWatchdog(): Promise<void> {
    const findCmd =
      `Get-CimInstance Win32_Process -Filter "Name='powershell.exe' OR Name='pwsh.exe'" | ` +
      `Where-Object { ($_.CommandLine -like '*watchdog-vm.ps1*' -or $_.CommandLine -like '*watchdog-mac.ps1*') -and ` +
      `$_.CommandLine -like '*-QmpPort ${this.creds.qmpPort}*' } | ` +
      `Select-Object -ExpandProperty ProcessId`;
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
          await execFileP("taskkill.exe", ["/PID", pid, "/T", "/F"], { windowsHide: true });
        } catch {
          /* already gone */
        }
      }
    } catch {
      /* ignore — best effort */
    }
  }

  async stopInstance(): Promise<void> {
    if (this.kind === "hyperv-win") {
      // Graceful first; if integration services aren't up yet (mid-install),
      // fall through to TurnOff.
      await psExec(
        `try { Stop-VM -Name '${this.hypervVmName}' -ErrorAction Stop } catch { try { Stop-VM -Name '${this.hypervVmName}' -TurnOff -Force -ErrorAction SilentlyContinue } catch {} }`,
      );
      return;
    }
    await this.killWatchdog().catch(() => {});
    try {
      await qmp(this.creds.qmpPort, "system_powerdown");
    } catch {
      await wslExec(
        this.creds.distro,
        `pkill -f 'qemu-system-x86_64.*qmp tcp:127.0.0.1:${this.creds.qmpPort}' 2>/dev/null || true`,
      );
    }
  }

  async rebootInstance(): Promise<void> {
    if (this.kind === "hyperv-win") {
      await psExec(`Restart-VM -Name '${this.hypervVmName}' -Force -ErrorAction Stop`);
      return;
    }
    await qmp(this.creds.qmpPort, "system_reset");
  }

  async terminateInstance(): Promise<void> {
    if (this.kind === "hyperv-win") {
      await psExec(
        `Stop-VM -Name '${this.hypervVmName}' -TurnOff -Force -ErrorAction SilentlyContinue`,
      );
      return;
    }
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
    if (this.kind === "hyperv-win") {
      return await this.getConnectionInfoHyperV();
    }

    const host = "127.0.0.1";
    const vncPort = this.creds.vncPort;
    const sshPort = this.creds.sshPort;
    const vncFile = buildVncFile(host, vncPort);

    const username = (() => {
      switch (this.kind) {
        case "mac":
          return "(set during macOS install)";
        case "win":
        case "ubuntu":
          return this.creds.osUsername?.trim() || "dragos";
      }
    })();

    const baseNotes = [
      `VNC: open any VNC client and connect to ${host}:${vncPort}.`,
      "Quickest path: download the .vnc file below and double-click it (RealVNC / TightVNC / UltraVNC).",
      `WSL distro: ${this.creds.distro} · VM dir: ${this.creds.vmDir}`,
      `QMP (vmui control plane): ${host}:${this.creds.qmpPort}`,
    ];

    if (this.kind === "win") {
      const pw = this.creds.osPassword;
      baseNotes.push(
        pw
          ? `RDP: mstsc /v:${host}:13389  (user: ${username} · pass: ${pw})`
          : `RDP: mstsc /v:${host}:13389  (user: ${username})`,
        `SSH: ssh -p ${sshPort} ${username}@${host}  (after first logon enables OpenSSH)`,
      );
    } else if (this.kind === "ubuntu") {
      const pw = this.creds.osPassword;
      baseNotes.push(
        pw
          ? `SSH: ssh -p ${sshPort} ${username}@${host}  (pass: ${pw})`
          : `SSH: ssh -p ${sshPort} ${username}@${host}`,
      );
    } else {
      baseNotes.push(`SSH (after enabling Remote Login on the Mac): ssh -p ${sshPort} <user>@${host}`);
    }

    return {
      protocol: "vnc",
      host,
      port: vncPort,
      username,
      vncUrl: `vnc://${host}:${vncPort}`,
      sshCommand: `ssh -p ${sshPort} ${this.kind === "mac" ? "<user>" : username}@${host}`,
      fileContent: vncFile,
      fileName: `vmui-${this.kind}.vnc`,
      fileMime: "application/x-vnc",
      notes: baseNotes,
    };
  }

  async listInstanceTemplates(): Promise<InstanceTemplate[]> {
    return TEMPLATES_BY_KIND[this.kind];
  }

  // ===== Local-KVM-specific extensions (not part of CloudProvider) =====

  /** Read the credentials (so server actions can derive ports/distro etc.) */
  getCredentials(): Readonly<LocalKvmCredentials> {
    return this.creds;
  }

  /** Hyper-V VM name with sensible default. Only meaningful for kind === "hyperv-win". */
  get hypervVmName(): string {
    return this.creds.hypervVmName?.trim() || "vmui-win";
  }

  /** Per-kind pidfile — exposed so server actions can poll without reimplementing. */
  getPidFile(): string {
    return this.pidFile;
  }

  /**
   * Capture a screenshot of the running guest.
   *
   * Uses QMP `screendump` for QEMU kinds — it dumps a PPM (P6) file to
   * the guest VM's WSL filesystem, then we read it back. PPM is a
   * trivial header + raw RGB triples, easy to render anywhere.
   *
   * On Hyper-V we shell out to `Get-VMScreenshot` (Win11+) which returns
   * a JPEG byte stream. We base64 it the same way for transport.
   *
   * @param maxWidth optional max output width in pixels (server-side
   *   nearest-neighbor downsample). Default 480 — keeps payload small
   *   for thumbnails on the dashboard.
   *
   * Returns null if the VM is not running.
   */
  async getScreenshot(
    maxWidth = 480,
  ): Promise<{ width: number; height: number; rgbBase64: string; format: "rgb" } | null> {
    if (this.kind === "hyperv-win") {
      // Hyper-V doesn't expose a stable RGB interface from PowerShell, so
      // we just return null for now — the UI shows a placeholder and the
      // user can use vmconnect.
      return null;
    }

    // Make sure VM is alive
    const st = await this.getState();
    if (st.state !== "running") return null;

    const ppmPath = `/tmp/vmui-${this.kind}.ppm`;
    try {
      await qmp(this.creds.qmpPort, "screendump", { filename: ppmPath, format: "ppm" });
    } catch {
      return null;
    }

    // Read raw bytes via base64 (no shell quoting issues)
    let b64 = "";
    try {
      b64 = await wslExec(this.creds.distro, `base64 -w0 ${ppmPath} 2>/dev/null`);
    } catch {
      return null;
    }
    if (!b64) return null;
    const buf = Buffer.from(b64, "base64");

    // Parse PPM P6 header: "P6\n<w> <h>\n<maxval>\n<raw>"
    // Comments (lines starting with #) and arbitrary whitespace are allowed.
    let i = 0;
    function readToken(): string {
      // skip whitespace and comments
      while (i < buf.length) {
        const c = buf[i];
        if (c === 0x23 /* # */) {
          while (i < buf.length && buf[i] !== 0x0a) i++;
        } else if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) {
          i++;
        } else break;
      }
      const start = i;
      while (i < buf.length) {
        const c = buf[i];
        if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) break;
        i++;
      }
      return buf.slice(start, i).toString("ascii");
    }
    const magic = readToken();
    if (magic !== "P6") return null;
    const w = parseInt(readToken(), 10);
    const h = parseInt(readToken(), 10);
    const maxVal = parseInt(readToken(), 10);
    if (!w || !h || maxVal !== 255) return null;
    // skip exactly one whitespace byte after maxval
    if (i < buf.length && (buf[i] === 0x0a || buf[i] === 0x20)) i++;
    const rgb = buf.slice(i, i + w * h * 3);
    if (rgb.length < w * h * 3) return null;

    // Optional downsample
    const scale = maxWidth > 0 && w > maxWidth ? maxWidth / w : 1;
    if (scale < 1) {
      const outW = Math.max(1, Math.round(w * scale));
      const outH = Math.max(1, Math.round(h * scale));
      const out = Buffer.allocUnsafe(outW * outH * 3);
      for (let y = 0; y < outH; y++) {
        const sy = Math.min(h - 1, Math.floor(y / scale));
        for (let x = 0; x < outW; x++) {
          const sx = Math.min(w - 1, Math.floor(x / scale));
          const si = (sy * w + sx) * 3;
          const di = (y * outW + x) * 3;
          out[di] = rgb[si] ?? 0;
          out[di + 1] = rgb[si + 1] ?? 0;
          out[di + 2] = rgb[si + 2] ?? 0;
        }
      }
      return { width: outW, height: outH, rgbBase64: out.toString("base64"), format: "rgb" };
    }

    return { width: w, height: h, rgbBase64: rgb.toString("base64"), format: "rgb" };
  }

  /** Whether websockify is running and listening on wsPort. */
  async isBridgeRunning(): Promise<boolean> {
    if (this.kind === "hyperv-win") return false;
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
    if (this.kind === "hyperv-win") {
      // Hyper-V uses vmconnect / RDP — no noVNC bridge.
      throw new Error(
        "noVNC bridge is not supported for Hyper-V VMs. Use vmconnect.exe or RDP instead.",
      );
    }
    if (await this.isBridgeRunning()) {
      return `ws://127.0.0.1:${this.creds.wsPort}`;
    }
    await wslExec(
      this.creds.distro,
      `nohup setsid websockify --daemon --log-file=/tmp/vmui-${this.kind}-ws.log ${this.creds.wsPort} 127.0.0.1:${this.creds.vncPort} </dev/null >/dev/null 2>&1 & disown; sleep 1; ss -tln | grep -q ':${this.creds.wsPort}' && echo OK || echo FAIL`,
    );
    const ok = await this.isBridgeRunning();
    if (!ok) {
      throw new Error(
        `Failed to start websockify bridge on port ${this.creds.wsPort}. Is the package installed (apt install websockify)?`,
      );
    }
    return `ws://127.0.0.1:${this.creds.wsPort}`;
  }

  /** Stop the websockify bridge, if running. */
  async stopBridge(): Promise<void> {
    if (this.kind === "hyperv-win") return;
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
   * CPU% computed in-script across a fixed 500 ms gap so callers can be
   * stateless. Counters are still raw — the action layer derives Bps deltas.
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
    if (this.kind === "hyperv-win") {
      return await this.getStatsRawHyperV();
    }
    try {
      const script = statsScript(this.pidFile);
      const out = await new Promise<string>((resolve, reject) => {
        const proc = execFile(
          "wsl.exe",
          ["-d", this.creds.distro, "--", "bash", "-s"],
          { timeout: 5000, maxBuffer: 64 * 1024 },
          (err, stdout) => (err ? reject(err) : resolve(stdout)),
        );
        proc.stdin?.end(script);
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
    if (this.kind === "hyperv-win") {
      try {
        const out = await psExec(
          `(Get-VM -Name '${this.hypervVmName}' -ErrorAction Stop).ProcessorCount`,
        );
        const n = Number(out.trim());
        return Number.isFinite(n) && n > 0 ? n : 1;
      } catch {
        return 1;
      }
    }
    try {
      const out = await wslExec(
        this.creds.distro,
        `PID=$(cat ${this.pidFile} 2>/dev/null) && tr '\\0' ' ' < /proc/$PID/cmdline | grep -oE -- '-smp [^ ]+' | head -1 | awk '{print $2}'`,
      );
      const m = out.trim().match(/^(\d+)/);
      return m ? Number(m[1]) : 1;
    } catch {
      return 1;
    }
  }

  // ============================================================================
  // Hyper-V dispatch helpers (kind === "hyperv-win")
  // ============================================================================

  /** Map a Hyper-V `Get-VM .State` string to our normalized state vocabulary. */
  private mapHyperVState(s: string): NormalizedInstance["state"] {
    switch (s.trim()) {
      case "Running":
        return "running";
      case "Off":
        return "stopped";
      case "Starting":
      case "Resuming":
        return "pending";
      case "Stopping":
      case "Saving":
      case "Pausing":
      case "ShuttingDown":
        return "stopping";
      case "Saved":
      case "Paused":
      case "Suspended":
        return "stopped";
      default:
        return "unknown";
    }
  }

  /** getState() for kind === "hyperv-win". */
  private async getStateHyperV(): Promise<NormalizedInstance> {
    const vmName = this.hypervVmName;
    const providerInstanceId = `hyperv-${vmName}`;
    const name = this.creds.hostLabel;

    let stateStr = "";
    let ip = "";
    let cpuCount = this.creds.cores;
    let memBytes = this.creds.ramMb * 1024 * 1024;
    try {
      const out = await psExec(
        `try { ` +
          `$vm = Get-VM -Name '${vmName}' -ErrorAction Stop; ` +
          `$ip = (Get-VMNetworkAdapter -VM $vm | Select-Object -First 1).IPAddresses | Where-Object { $_ -match '^\\d+\\.' } | Select-Object -First 1; ` +
          `"$($vm.State)|$ip|$($vm.ProcessorCount)|$($vm.MemoryAssigned)" ` +
          `} catch { "MISSING||" }`,
      );
      const [s, i, c, m] = out.split("|");
      stateStr = s ?? "";
      ip = (i ?? "").trim();
      if (c) cpuCount = Number(c) || cpuCount;
      if (m) {
        const mn = Number(m);
        if (Number.isFinite(mn) && mn > 0) memBytes = mn;
      }
    } catch {
      stateStr = "";
    }

    const instanceType = `${cpuCount}c-${Math.round(memBytes / 1024 / 1024 / 1024)}g`;

    if (stateStr === "MISSING" || stateStr === "") {
      return {
        providerInstanceId,
        region: REGION,
        name,
        state: "unknown",
        platform: "windows",
        instanceType,
        publicIp: null,
        publicDns: null,
        privateIp: null,
        keyName: null,
        raw: { hypervVmName: vmName, missing: true },
      };
    }

    return {
      providerInstanceId,
      region: REGION,
      name,
      state: this.mapHyperVState(stateStr),
      platform: "windows",
      instanceType,
      publicIp: null,
      publicDns: null,
      privateIp: ip || null,
      keyName: null,
      raw: { hypervVmName: vmName, hyperVState: stateStr },
    };
  }

  /** getConnectionInfo() for kind === "hyperv-win". */
  private async getConnectionInfoHyperV(): Promise<ConnectionInfo> {
    const vmName = this.hypervVmName;
    const username = this.creds.osUsername?.trim() || "dragos";
    const pw = this.creds.osPassword;

    // Best-effort IP probe so the user can RDP/SSH directly.
    let ip = "";
    try {
      ip = (
        await psExec(
          `try { ((Get-VMNetworkAdapter -VMName '${vmName}' -ErrorAction Stop).IPAddresses | Where-Object { $_ -match '^\\d+\\.' } | Select-Object -First 1) } catch { '' }`,
        )
      ).trim();
    } catch {
      /* ignore */
    }

    const notes: string[] = [
      `Hyper-V VM: ${vmName} (Gen2 · vTPM · Secure Boot · nested virtualisation)`,
      `Console: run \`vmconnect.exe localhost ${vmName}\` (or click "Open Console" in the UI — launches vmconnect).`,
    ];
    if (ip) {
      notes.push(
        pw
          ? `RDP: mstsc /v:${ip}  (user: ${username} · pass: ${pw})`
          : `RDP: mstsc /v:${ip}  (user: ${username})`,
        `SSH (after first logon enables OpenSSH.Server): ssh ${username}@${ip}`,
      );
    } else {
      notes.push(
        "Guest IP not yet reported by integration services — wait for the install to complete or refresh in a moment.",
      );
    }

    return {
      protocol: "rdp",
      host: ip || "localhost",
      port: 3389,
      username,
      sshCommand: ip ? `ssh ${username}@${ip}` : `ssh ${username}@<guest-ip>`,
      notes,
    };
  }

  /** getStatsRaw() for kind === "hyperv-win". */
  private async getStatsRawHyperV(): Promise<{
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
    const vmName = this.hypervVmName;
    try {
      // One PowerShell round-trip; tab-separated to keep parsing trivial.
      // Fields:
      //   state cpuPct memBytes uptimeSec procCount
      // PowerShell uses backtick as its escape char (`t = TAB). In a JS
      // template literal we have to double-escape the backticks (\`).
      const out = await psExec(
        `try { ` +
          `$vm = Get-VM -Name '${vmName}' -ErrorAction Stop; ` +
          `if ($vm.State -ne 'Running') { Write-Output 'NORUN'; exit 0 }; ` +
          `$up = [int]$vm.Uptime.TotalSeconds; ` +
          `"OK\`t$($vm.CPUUsage)\`t$($vm.MemoryAssigned)\`t$up\`t$($vm.ProcessorCount)" ` +
          `} catch { Write-Output 'NORUN' }`,
      );
      if (!out || out.startsWith("NORUN")) return null;
      const parts = out.split(/\t/);
      if (parts[0] !== "OK" || parts.length < 5) return null;
      const [, cpu, mem, up, pc] = parts;
      const memBytes = Number(mem) || 0;
      const vcpus = Number(pc) || 1;
      return {
        // Hyper-V doesn't expose a host-side PID. Use a stable synthetic ID
        // (negative so it never collides with a Linux PID) so the stats
        // cache key in the action layer stays consistent across samples.
        pid: -1,
        cpuPct: Number(cpu) || 0,
        // Hyper-V "MemoryAssigned" is the total assigned to the VM — there
        // is no "RSS". Treat it as both used and total so the UI shows a
        // sensible bar without claiming we know guest-side usage.
        rssKb: Math.round(memBytes / 1024),
        // No host-side disk/net counters for the VM as a whole through
        // Get-VM. Counters could be added later via
        // Get-VMHardDiskDrive + perf counters; for now we report 0 so the
        // UI "throughput" sparklines stay flat instead of going haywire.
        readBytes: 0,
        writeBytes: 0,
        rxBytes: 0,
        txBytes: 0,
        uptimeSeconds: Number(up) || 0,
        qemuMemBytes: memBytes,
        vcpus,
      };
    } catch {
      return null;
    }
  }
}
