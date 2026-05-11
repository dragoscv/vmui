"use server";

import { decryptJSON, encryptJSON } from "@/lib/crypto";
import { db } from "@/lib/db";
import { auditLog, cloudAccounts, instances } from "@/lib/db/schema";
import { LocalKvmProvider, type LocalKvmCredentials } from "@/lib/providers/local-kvm";
import { AwsProvider } from "@/lib/providers/aws";
import { getProvider } from "@/lib/providers/registry";
import type { InstanceStatsSample } from "@/lib/providers/types";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";

const execFileP = promisify(execFile);

/**
 * Server actions exclusive to the LocalKvmProvider:
 *  - VNC websocket bridge (websockify) lifecycle for in-browser noVNC.
 *  - Windows Task Scheduler integration for boot-on-logon autostart.
 */

function asLocalKvm(provider: unknown): LocalKvmProvider {
  if (!(provider instanceof LocalKvmProvider)) {
    throw new Error("This action only works on local-kvm accounts.");
  }
  return provider;
}

/** Get the current bridge status + ws URL. Idempotent. */
export async function getBridgeStatusAction(accountId: string): Promise<{
  ok: boolean;
  running: boolean;
  url?: string;
  error?: string;
}> {
  try {
    const { provider } = await getProvider(accountId);
    const lk = asLocalKvm(provider);
    const creds = lk.getCredentials();
    const running = await lk.isBridgeRunning();
    return {
      ok: true,
      running,
      url: running ? `ws://127.0.0.1:${creds.wsPort}` : undefined,
    };
  } catch (err) {
    return { ok: false, running: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

/** Start the websockify bridge. Idempotent. */
export async function startBridgeAction(accountId: string): Promise<{
  ok: boolean;
  url?: string;
  error?: string;
}> {
  try {
    const { provider } = await getProvider(accountId);
    const lk = asLocalKvm(provider);
    const url = await lk.startBridge();
    await db.insert(auditLog).values({
      accountId,
      action: "bridge.start",
      target: url,
      status: "ok",
    });
    return { ok: true, url };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed";
    await db.insert(auditLog).values({
      accountId,
      action: "bridge.start",
      status: "error",
      message: msg,
    });
    return { ok: false, error: msg };
  }
}

/** Stop the websockify bridge. */
export async function stopBridgeAction(accountId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { provider } = await getProvider(accountId);
    const lk = asLocalKvm(provider);
    await lk.stopBridge();
    await db.insert(auditLog).values({
      accountId,
      action: "bridge.stop",
      status: "ok",
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

// ============================================================================
// Windows Task Scheduler — autostart on user logon
// ============================================================================

/**
 * Encode the task name. We prefix with `vmui_` so users can find/remove
 * easily and so we can list them via wildcard.
 */
function taskName(accountId: string): string {
  return `vmui_localkvm_${accountId}`;
}

/** Check whether a scheduled task with this name exists. */
async function taskExists(name: string): Promise<boolean> {
  try {
    await execFileP("schtasks.exe", ["/Query", "/TN", name], { windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

export async function getAutoStartStatusAction(
  accountId: string,
): Promise<{ ok: boolean; enabled: boolean; taskName: string; error?: string }> {
  const name = taskName(accountId);
  // Hyper-V kind: read AutomaticStartAction from Get-VM. We still return a
  // synthetic taskName so the UI keeps the same shape.
  try {
    const { provider } = await getProvider(accountId);
    if (
      provider instanceof LocalKvmProvider &&
      provider.getCredentials().kind === "hyperv-win"
    ) {
      const vmName = provider.hypervVmName;
      const { stdout } = await execFileP(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          `try { (Get-VM -Name '${vmName}' -ErrorAction Stop).AutomaticStartAction } catch { 'MISSING' }`,
        ],
        { windowsHide: true, maxBuffer: 256 * 1024 },
      );
      const action = stdout.replace(/\r/g, "").trim();
      return {
        ok: action !== "MISSING",
        enabled: action === "Start" || action === "StartIfRunning",
        taskName: `hyperv:${vmName}:AutomaticStartAction`,
      };
    }
  } catch {
    /* fall through to schtasks check */
  }
  try {
    const exists = await taskExists(name);
    return { ok: true, enabled: exists, taskName: name };
  } catch (err) {
    return {
      ok: false,
      enabled: false,
      taskName: name,
      error: err instanceof Error ? err.message : "Failed",
    };
  }
}

/**
 * Create a Scheduled Task that runs at user logon and launches the VM via
 * `wsl.exe -d <distro> -- bash <vmDir>/boot-${kind}.sh`.
 *
 * Uses /SC ONLOGON so it triggers when the current Windows user signs in.
 * Uses /RL LIMITED (no admin elevation needed). /F forces overwrite.
 */
export async function enableAutoStartAction(accountId: string): Promise<{
  ok: boolean;
  error?: string;
}> {
  const { provider } = await getProvider(accountId);
  const lk = asLocalKvm(provider);
  const creds = lk.getCredentials();
  const name = taskName(accountId);

  // Hyper-V VMs use the hypervisor's own AutomaticStartAction setting
  // instead of a Windows scheduled task. We set Start + a 0s delay so the
  // VM boots when the host comes up; the user only sees an "auto-start"
  // toggle in the UI either way.
  if (creds.kind === "hyperv-win") {
    const vmName = (lk as LocalKvmProvider).hypervVmName;
    try {
      await execFileP(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          `Set-VM -Name '${vmName}' -AutomaticStartAction Start -AutomaticStartDelay 0 -ErrorAction Stop`,
        ],
        { windowsHide: true, maxBuffer: 1024 * 1024 },
      );
      await db.insert(auditLog).values({
        accountId,
        action: "autostart.enable",
        target: vmName,
        status: "ok",
        message: "Set Hyper-V AutomaticStartAction=Start",
      });
      revalidatePath(`/instances/${accountId}:hyperv:${vmName}`);
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Set-VM failed";
      await db.insert(auditLog).values({
        accountId,
        action: "autostart.enable",
        status: "error",
        message: msg,
      });
      return { ok: false, error: msg };
    }
  }

  const bootScript = `boot-${creds.kind}.sh`;
  const logFile = `/tmp/vmui-${creds.kind}.log`;

  // The action: invoke wsl.exe with the full boot path.
  // schtasks needs the "Action" passed as a single quoted string in /TR.
  const tr =
    `wsl.exe -d ${creds.distro} -- bash -lc ` +
    `"cd '${creds.vmDir}' && nohup setsid bash ./${bootScript} > ${logFile} 2>&1 < /dev/null & disown"`;

  try {
    await execFileP(
      "schtasks.exe",
      [
        "/Create",
        "/SC",
        "ONLOGON",
        "/TN",
        name,
        "/TR",
        tr,
        "/RL",
        "LIMITED",
        "/F",
      ],
      { windowsHide: true, maxBuffer: 1024 * 1024 },
    );

    await db.insert(auditLog).values({
      accountId,
      action: "autostart.enable",
      target: name,
      status: "ok",
      message: "Created Windows scheduled task on user logon",
    });

    revalidatePath(`/instances/${accountId}:wsl-local:local-${creds.kind}`);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "schtasks failed";
    await db.insert(auditLog).values({
      accountId,
      action: "autostart.enable",
      status: "error",
      message: msg,
    });
    return { ok: false, error: msg };
  }
}

export async function disableAutoStartAction(accountId: string): Promise<{
  ok: boolean;
  error?: string;
}> {
  const name = taskName(accountId);
  // Best-effort kind lookup for revalidatePath; fall back to mac if unknown.
  let kind: string = "mac";
  let lkProvider: LocalKvmProvider | null = null;
  try {
    const { provider } = await getProvider(accountId);
    if (provider instanceof LocalKvmProvider) {
      lkProvider = provider;
      kind = provider.getCredentials().kind;
    }
  } catch {
    /* ignore */
  }

  if (lkProvider && kind === "hyperv-win") {
    const vmName = lkProvider.hypervVmName;
    try {
      await execFileP(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          `Set-VM -Name '${vmName}' -AutomaticStartAction Nothing -ErrorAction Stop`,
        ],
        { windowsHide: true, maxBuffer: 1024 * 1024 },
      );
      await db.insert(auditLog).values({
        accountId,
        action: "autostart.disable",
        target: vmName,
        status: "ok",
        message: "Set Hyper-V AutomaticStartAction=Nothing",
      });
      revalidatePath(`/instances/${accountId}:hyperv:${vmName}`);
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Set-VM failed";
      await db.insert(auditLog).values({
        accountId,
        action: "autostart.disable",
        status: "error",
        message: msg,
      });
      return { ok: false, error: msg };
    }
  }

  try {
    if (!(await taskExists(name))) {
      return { ok: true }; // already gone
    }
    await execFileP(
      "schtasks.exe",
      ["/Delete", "/TN", name, "/F"],
      { windowsHide: true },
    );

    await db.insert(auditLog).values({
      accountId,
      action: "autostart.disable",
      target: name,
      status: "ok",
    });

    revalidatePath(`/instances/${accountId}:wsl-local:local-${kind}`);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "schtasks failed";
    await db.insert(auditLog).values({
      accountId,
      action: "autostart.disable",
      status: "error",
      message: msg,
    });
    return { ok: false, error: msg };
  }
}

// ============================================================================
// Realtime resource stats — local-kvm reads from /proc; cloud providers stub.
// ============================================================================

interface RawSample {
  t: number;
  readBytes: number;
  writeBytes: number;
  rxBytes: number;
  txBytes: number;
}

/**
 * Per-instance last-sample cache, used to compute Bps deltas (disk/net) across
 * polls. Keyed by `${accountId}:${pid}` — the pid is included so a VM restart
 * resets the cache instead of emitting a huge negative spike.
 *
 * NOTE: CPU% is no longer derived from this cache — it is computed inside the
 * bash sampler over a fixed 500 ms window, so concurrent consumers (panel +
 * dialog) can't race on a shared prev-sample slot and pin CPU% at 100.
 */
const lastSamples = new Map<string, RawSample>();

export async function getInstanceStatsAction(
  accountId: string,
  providerInstanceId?: string,
): Promise<{ ok: true; sample: InstanceStatsSample } | { ok: false; error: string }> {
  let provider;
  try {
    ({ provider } = await getProvider(accountId));
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed" };
  }

  if (!(provider instanceof LocalKvmProvider)) {
    if (provider instanceof AwsProvider) {
      // Look up region for the requested instance (or fall back to first VM).
      const where = providerInstanceId
        ? and(eq(instances.accountId, accountId), eq(instances.providerInstanceId, providerInstanceId))
        : eq(instances.accountId, accountId);
      const row = await db.select().from(instances).where(where).limit(1);
      const inst = row[0];
      if (!inst) {
        return {
          ok: true,
          sample: { sampledAt: Date.now(), running: false, note: "No synced AWS instances yet." },
        };
      }
      try {
        const sample = await provider.getMetrics(inst.region, inst.providerInstanceId);
        return { ok: true, sample };
      } catch (err) {
        return {
          ok: true,
          sample: {
            sampledAt: Date.now(),
            running: false,
            note: err instanceof Error ? `CloudWatch: ${err.message}` : "CloudWatch error",
          },
        };
      }
    }

    return {
      ok: true,
      sample: {
        sampledAt: Date.now(),
        running: false,
        note: "Realtime metrics are only available for local-kvm and AWS instances right now.",
      },
    };
  }

  const lk = provider;
  const raw = await lk.getStatsRaw();
  if (!raw) {
    return {
      ok: true,
      sample: { sampledAt: Date.now(), running: false },
    };
  }

  const now = Date.now();
  const cacheKey = `${accountId}:${raw.pid}`;
  const prev = lastSamples.get(cacheKey);

  // CPU% is computed in-script (stateless 500ms window).
  const cpuPercent = Number.isFinite(raw.cpuPct) ? raw.cpuPct : undefined;

  let diskReadBps: number | undefined;
  let diskWriteBps: number | undefined;
  let netRxBps: number | undefined;
  let netTxBps: number | undefined;

  if (prev) {
    const dtSec = Math.max(0.001, (now - prev.t) / 1000);
    diskReadBps = Math.max(0, (raw.readBytes - prev.readBytes) / dtSec);
    diskWriteBps = Math.max(0, (raw.writeBytes - prev.writeBytes) / dtSec);
    netRxBps = Math.max(0, (raw.rxBytes - prev.rxBytes) / dtSec);
    netTxBps = Math.max(0, (raw.txBytes - prev.txBytes) / dtSec);
  }

  lastSamples.set(cacheKey, {
    t: now,
    readBytes: raw.readBytes,
    writeBytes: raw.writeBytes,
    rxBytes: raw.rxBytes,
    txBytes: raw.txBytes,
  });

  return {
    ok: true,
    sample: {
      sampledAt: now,
      running: true,
      cpuPercent,
      memUsedBytes: raw.rssKb * 1024,
      memTotalBytes: raw.qemuMemBytes || undefined,
      diskReadBps,
      diskWriteBps,
      netRxBps,
      netTxBps,
      uptimeSeconds: raw.uptimeSeconds,
    },
  };
}

// ============================================================================
// Hardware configuration — cores / RAM allocation
// ============================================================================

const hardwareSchema = z.object({
  cores: z.coerce.number().int().min(1).max(64),
  threads: z.coerce.number().int().min(1).max(128),
  ramMb: z.coerce.number().int().min(1024).max(1024 * 1024),
});

export interface HostCapabilities {
  hostCores: number;
  hostMemMb: number;
  /** Host MemAvailable now (helps prevent overcommit). */
  hostMemAvailableMb: number;
  vmRunning: boolean;
}

/** Probe the WSL host for CPU + memory limits to gate the UI sliders. */
export async function getHostCapabilitiesAction(
  accountId: string,
): Promise<{ ok: true; caps: HostCapabilities } | { ok: false; error: string }> {
  try {
    const { provider } = await getProvider(accountId);
    if (!(provider instanceof LocalKvmProvider)) {
      return { ok: false, error: "Hardware config is only available for local-kvm." };
    }
    const creds = provider.getCredentials();
    const pidFile = provider.getPidFile();
    const out = await execFileP(
      "wsl.exe",
      ["-d", creds.distro, "--", "bash", "-lc",
        // single-line: nproc, MemTotal kB, MemAvailable kB, qemu-running flag (per-kind pidfile)
        `printf '%s %s %s %s' "$(nproc)" "$(awk '/^MemTotal:/{print $2}' /proc/meminfo)" "$(awk '/^MemAvailable:/{print $2}' /proc/meminfo)" "$([ -f ${pidFile} ] && [ -d /proc/$(cat ${pidFile} 2>/dev/null) ] && echo 1 || echo 0)"`,
      ],
      { timeout: 5000, windowsHide: true },
    );
    const parts = out.stdout.trim().split(/\s+/);
    const [hc, mt, ma, run] = parts;
    return {
      ok: true,
      caps: {
        hostCores: Number(hc) || 1,
        hostMemMb: Math.floor(Number(mt) / 1024) || 0,
        hostMemAvailableMb: Math.floor(Number(ma) / 1024) || 0,
        vmRunning: run === "1",
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

/** Read the current hardware config for the UI. */
export async function getVmHardwareAction(
  accountId: string,
): Promise<
  | { ok: true; cores: number; threads: number; ramMb: number }
  | { ok: false; error: string }
> {
  try {
    const { provider } = await getProvider(accountId);
    if (!(provider instanceof LocalKvmProvider)) {
      return { ok: false, error: "Only available for local-kvm." };
    }
    const c = provider.getCredentials();
    return { ok: true, cores: c.cores, threads: c.threads, ramMb: c.ramMb };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

/**
 * Persist new hardware allocation. Re-encrypts the credentials blob; takes
 * effect on the next VM boot. Validates against host caps so users can't
 * configure more than the host has.
 */
export async function updateVmHardwareAction(
  accountId: string,
  input: { cores: number; threads: number; ramMb: number },
): Promise<{ ok: true; appliedNextBoot: boolean } | { ok: false; error: string; fieldErrors?: Record<string, string> }> {
  const parsed = hardwareSchema.safeParse(input);
  if (!parsed.success) {
    const fe: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const k = issue.path[0];
      if (typeof k === "string" && !fe[k]) fe[k] = issue.message;
    }
    return { ok: false, error: "Invalid configuration", fieldErrors: fe };
  }
  const { cores, threads, ramMb } = parsed.data;

  if (threads % cores !== 0) {
    return {
      ok: false,
      error: "Total threads must be a multiple of cores per socket.",
      fieldErrors: { threads: "Must be a multiple of cores" },
    };
  }

  // Cap against host capabilities.
  const caps = await getHostCapabilitiesAction(accountId);
  if (caps.ok) {
    const fe: Record<string, string> = {};
    if (threads > caps.caps.hostCores) {
      fe.threads = `Host has only ${caps.caps.hostCores} threads`;
    }
    // Leave ~1.5 GB headroom for host + WSL.
    const maxRam = Math.max(1024, caps.caps.hostMemMb - 1536);
    if (ramMb > maxRam) {
      fe.ramMb = `Max ~${maxRam} MiB (host has ${caps.caps.hostMemMb} MiB).`;
    }
    if (Object.keys(fe).length > 0) {
      return { ok: false, error: "Exceeds host capabilities.", fieldErrors: fe };
    }
  }

  // Load + decrypt + mutate + re-encrypt the credentials.
  const rows = await db.select().from(cloudAccounts).where(eq(cloudAccounts.id, accountId)).limit(1);
  const row = rows[0];
  if (!row) return { ok: false, error: "Account not found." };
  if (row.provider !== "local-kvm") {
    return { ok: false, error: "Hardware config is only available for local-kvm." };
  }

  const current = decryptJSON<Partial<LocalKvmCredentials>>(row.credentialsEnc);
  const kind: LocalKvmCredentials["kind"] = (current.kind ?? "mac") as LocalKvmCredentials["kind"];
  const next: LocalKvmCredentials = {
    kind,
    distro: current.distro ?? "Ubuntu-24.04",
    vmDir: current.vmDir ?? "/home/dragos/OSX-KVM",
    hostLabel: current.hostLabel ?? "Local VM",
    vncPort: current.vncPort ?? 5900,
    qmpPort: current.qmpPort ?? 4444,
    sshPort: current.sshPort ?? 10022,
    wsPort: current.wsPort ?? 6080,
    cores,
    threads,
    ramMb,
  };

  await db
    .update(cloudAccounts)
    .set({ credentialsEnc: encryptJSON(next), updatedAt: new Date() })
    .where(eq(cloudAccounts.id, accountId));

  await db.insert(auditLog).values({
    accountId,
    action: "hardware.update",
    target: `${cores}c/${threads}t/${ramMb}MiB`,
    status: "ok",
    message: `Updated hardware allocation to ${threads} vCPU (${cores} cores) / ${(ramMb / 1024).toFixed(1)} GiB`,
  });

  const running = caps.ok && caps.caps.vmRunning;
  revalidatePath(`/instances/${accountId}:wsl-local:local-${next.kind}`);
  revalidatePath("/");
  return { ok: true, appliedNextBoot: running };
}
