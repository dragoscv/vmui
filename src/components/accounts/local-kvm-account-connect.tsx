"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, ShieldCheck, Apple, MonitorCog, Terminal } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { addLocalKvmAccount, type LocalKvmAccountFormState } from "@/server/actions/accounts";

const initial: LocalKvmAccountFormState = {};

type Kind = "mac" | "win" | "ubuntu" | "hyperv-win";

interface KindPreset {
  vmDir: string;
  hostLabel: string;
  vncPort: number;
  qmpPort: number;
  sshPort: number;
  wsPort: number;
  ramMb: number;
  cores: number;
  threads: number;
  bootScript: string;
  setupScript: string;
  setupHint: string;
  pidPath: string;
}

// Keep these in sync with KIND_DEFAULTS in src/lib/providers/local-kvm.ts.
const PRESETS: Record<Kind, KindPreset> = {
  mac: {
    vmDir: "/home/dragos/OSX-KVM",
    hostLabel: "Local Mac (KVM)",
    vncPort: 5900,
    qmpPort: 4444,
    sshPort: 10022,
    wsPort: 6080,
    ramMb: 16384,
    cores: 4,
    threads: 8,
    bootScript: "boot-mac.sh",
    setupScript: "scripts/setup-osx-kvm.sh",
    setupHint: "Clones OSX-KVM and installs QEMU + libvirt.",
    pidPath: "/tmp/vmui-mac.pid",
  },
  win: {
    vmDir: "/home/dragos/vmui-vms/win",
    hostLabel: "Local Windows 11 (KVM)",
    vncPort: 6900,
    qmpPort: 4445,
    sshPort: 10023,
    wsPort: 6090,
    ramMb: 8192,
    cores: 4,
    threads: 8,
    bootScript: "boot-win.sh",
    setupScript: "scripts/setup-win-vm.sh",
    setupHint:
      "Builds the autounattend ISO with your guest credentials, copies OVMF + initialises swtpm.",
    pidPath: "/tmp/vmui-win.pid",
  },
  ubuntu: {
    vmDir: "/home/dragos/vmui-vms/ubuntu",
    hostLabel: "Local Ubuntu (KVM)",
    vncPort: 7900,
    qmpPort: 4446,
    sshPort: 10024,
    wsPort: 6100,
    ramMb: 4096,
    cores: 2,
    threads: 4,
    bootScript: "boot-ubuntu.sh",
    setupScript: "scripts/setup-ubuntu-vm.sh",
    setupHint:
      "Downloads the Ubuntu LTS cloud image and builds the cloud-init seed with your guest credentials.",
    pidPath: "/tmp/vmui-ubuntu.pid",
  },
  // Native Hyper-V Win11 — the WSL fields here are unused at runtime but
  // we still ask for a vmDir/distro to keep the form schema uniform.
  "hyperv-win": {
    vmDir: "",
    hostLabel: "Local Windows 11 (Hyper-V)",
    vncPort: 0,
    qmpPort: 0,
    sshPort: 13389,
    wsPort: 0,
    ramMb: 8192,
    cores: 4,
    threads: 8,
    bootScript: "setup-win-hyperv.ps1",
    setupScript: "scripts/setup-win-hyperv.ps1",
    setupHint:
      "Builds the autounattend ISO with oscdimg and creates a Gen2 Hyper-V VM (vTPM, Secure Boot, nested virt).",
    pidPath: "(Hyper-V — no pidfile)",
  },
};

const KIND_LABELS: Record<Kind, { label: string; sub: string; icon: React.ComponentType<{ className?: string }> }> = {
  mac: { label: "macOS", sub: "OSX-KVM + OpenCore", icon: Apple },
  win: { label: "Windows 11 (KVM)", sub: "WSL2 + QEMU + swtpm", icon: MonitorCog },
  ubuntu: { label: "Ubuntu LTS", sub: "Desktop with autoinstall", icon: Terminal },
  "hyperv-win": { label: "Windows 11 (Hyper-V)", sub: "Native Gen2 + vTPM", icon: MonitorCog },
};

export function LocalKvmAccountConnect() {
  const [state, action, pending] = useActionState(addLocalKvmAccount, initial);
  const [kind, setKind] = useState<Kind>("mac");
  const router = useRouter();
  const preset = useMemo(() => PRESETS[kind], [kind]);

  useEffect(() => {
    if (state.ok && state.accountId) {
      if (state.generatedCreds) {
        // Stick around — the user must save these creds before navigating
        // away. We won't be able to recover the plaintext password later.
        toast.success(
          `Account created. Generated guest credentials: ${state.generatedCreds.username} / ${state.generatedCreds.password}`,
          { duration: 30_000 },
        );
      } else {
        toast.success("Local KVM host connected");
        router.push("/");
      }
      router.refresh();
    } else if (state.error && !state.fieldErrors) {
      toast.error(state.error);
    }
  }, [state, router]);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader className="flex-row items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-[var(--radius-md)] bg-[color-mix(in_oklch,var(--color-primary)_15%,transparent)]">
            <MonitorCog className="h-5 w-5 text-[var(--color-primary)]" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Local KVM host (WSL2)</h2>
            <p className="text-xs text-muted">
              Connect a WSL2 distro running QEMU/KVM. Pick a guest kind — vmui drives lifecycle through QMP.
            </p>
          </div>
        </CardHeader>
        <CardContent>
          {/* The form re-keys on `kind` so the defaultValues update when the
              user switches between mac/win/ubuntu without manual clears. */}
          <form key={kind} action={action} className="grid gap-4">
            <input type="hidden" name="kind" value={kind} />

            <div className="grid gap-1.5">
              <Label>Guest kind</Label>
              <div className="grid grid-cols-4 gap-2">
                {(Object.keys(PRESETS) as Kind[]).map((k) => {
                  const meta = KIND_LABELS[k];
                  const Icon = meta.icon;
                  const active = k === kind;
                  return (
                    <button
                      type="button"
                      key={k}
                      onClick={() => setKind(k)}
                      className={`flex flex-col items-start gap-1 rounded-[var(--radius-md)] border p-3 text-left transition ${
                        active
                          ? "border-[var(--color-primary)] bg-[color-mix(in_oklch,var(--color-primary)_10%,transparent)]"
                          : "border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4" />
                        <span className="text-sm font-semibold">{meta.label}</span>
                      </div>
                      <span className="text-[11px] text-muted">{meta.sub}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <Field
              name="name"
              label="Display name"
              placeholder={`Local ${KIND_LABELS[kind].label}`}
              error={state.fieldErrors?.name}
              required
            />
            <Field
              name="hostLabel"
              label="Host label"
              placeholder="dragos-pc · WSL2 Ubuntu"
              description="Shown in the instances list as the 'host' for this VM."
              error={state.fieldErrors?.hostLabel}
              required
              defaultValue={preset.hostLabel}
            />
            <Field
              name="distro"
              label="WSL distro name"
              placeholder="Ubuntu-24.04"
              description="Name shown by `wsl --list` (case-sensitive)."
              error={state.fieldErrors?.distro}
              required
              defaultValue="Ubuntu-24.04"
            />
            <Field
              name="vmDir"
              label="VM directory"
              placeholder={preset.vmDir}
              description={`Absolute Linux path. Must contain ${preset.bootScript} (synced from the repo on launch).`}
              error={state.fieldErrors?.vmDir}
              required
              defaultValue={preset.vmDir}
            />
            <div className="grid grid-cols-4 gap-3">
              <Field
                name="vncPort"
                label="VNC port"
                type="number"
                defaultValue={String(preset.vncPort)}
                error={state.fieldErrors?.vncPort}
              />
              <Field
                name="qmpPort"
                label="QMP port"
                type="number"
                defaultValue={String(preset.qmpPort)}
                error={state.fieldErrors?.qmpPort}
              />
              <Field
                name="sshPort"
                label="SSH fwd"
                type="number"
                defaultValue={String(preset.sshPort)}
                error={state.fieldErrors?.sshPort}
              />
              <Field
                name="wsPort"
                label="WS port"
                type="number"
                defaultValue={String(preset.wsPort)}
                error={state.fieldErrors?.wsPort}
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field
                name="cores"
                label="Cores / socket"
                type="number"
                defaultValue={String(preset.cores)}
                error={state.fieldErrors?.cores}
              />
              <Field
                name="threads"
                label="vCPU threads"
                type="number"
                defaultValue={String(preset.threads)}
                error={state.fieldErrors?.threads}
              />
              <Field
                name="ramMb"
                label="RAM (MiB)"
                type="number"
                defaultValue={String(preset.ramMb)}
                error={state.fieldErrors?.ramMb}
              />
            </div>
            {kind !== "mac" && (
              <div className="grid grid-cols-2 gap-3">
                <Field
                  name="osUsername"
                  label="Guest username"
                  placeholder="dragos"
                  description="Baked into the unattended install. Lowercase, digits, _ and - (max 32). Leave blank for default."
                  error={state.fieldErrors?.osUsername}
                />
                <Field
                  name="osPassword"
                  label="Guest password"
                  type="password"
                  placeholder="REDACTED_GUEST_PASSWORD"
                  description="Stored encrypted; written to vm-creds.env in the WSL distro."
                  error={state.fieldErrors?.osPassword}
                />
              </div>
            )}
            <Button type="submit" disabled={pending} size="lg">
              {pending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Verifying WSL host…
                </>
              ) : (
                <>
                  <ShieldCheck className="h-4 w-4" /> Verify &amp; connect
                </>
              )}
            </Button>
            {state.generatedCreds && (
              <div className="rounded-[var(--radius-md)] border border-[var(--color-warning,#d4a017)] bg-[color-mix(in_oklch,var(--color-warning,#d4a017)_10%,transparent)] p-3 text-xs">
                <p className="font-semibold">Save these guest credentials now</p>
                <p className="mt-1 text-muted">
                  They were auto-generated and cannot be recovered later. Re-run
                  the setup script if you lose them — it will reinstall the VM.
                </p>
                <pre className="mt-2 select-all rounded bg-[var(--color-surface-muted)] p-2 font-mono text-[11px]">
{`username: ${state.generatedCreds.username}
password: ${state.generatedCreds.password}`}
                </pre>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-2"
                  onClick={() => {
                    void navigator.clipboard.writeText(
                      `${state.generatedCreds!.username}:${state.generatedCreds!.password}`,
                    );
                    toast.success("Copied to clipboard");
                  }}
                >
                  Copy user:password
                </Button>
              </div>
            )}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-[var(--radius-md)] bg-[color-mix(in_oklch,var(--color-primary)_15%,transparent)]">
            <Terminal className="h-5 w-5 text-[var(--color-primary)]" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Setup checklist · {KIND_LABELS[kind].label}</h2>
            <p className="text-xs text-muted">
              Run these once inside the chosen WSL distro before connecting.
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <Check title="WSL2 with /dev/kvm">
            <code className="block whitespace-pre-wrap rounded bg-[var(--color-surface-muted)] p-2 text-xs">
              wsl -- bash -lc &apos;ls -la /dev/kvm&apos;
            </code>
            Should print <code>crw-rw---- 1 root kvm</code>. If missing, your CPU virt is off in BIOS or
            Hyper-V is broken.
          </Check>
          <Check title="QEMU installed">
            <code className="block whitespace-pre-wrap rounded bg-[var(--color-surface-muted)] p-2 text-xs">
              wsl -- bash -lc &apos;qemu-system-x86_64 --version&apos;
            </code>
            Run <code>{preset.setupScript}</code> if not present. {preset.setupHint}
          </Check>
          <Check title={`Run ${preset.setupScript}`}>
            <code className="block whitespace-pre-wrap rounded bg-[var(--color-surface-muted)] p-2 text-xs">
              wsl -- bash /mnt/e/gh/vmui/{preset.setupScript}
            </code>
            One-time setup: creates {preset.vmDir}, downloads ISOs, copies OVMF, builds the
            unattended-install seed.
          </Check>
          {kind === "mac" && (
            <Check title="macOS installed (or installing)">
              Connect a VNC client to <code>127.0.0.1:5900</code> after starting the VM. First boot
              needs you to format the virtual disk in Disk Utility and pick &quot;Reinstall macOS&quot;.
            </Check>
          )}
          {kind === "win" && (
            <Check title="Drop the Windows 11 ISO at $VMDIR/Win11.iso">
              Get the official ISO from{" "}
              <code>microsoft.com/software-download/windows11</code> (x64 English). 25H2 is the
              latest stable as of 2026. Local administrator credentials are baked into
              autounattend.xml from the values you set above (or auto-generated when blank).
            </Check>
          )}
          {kind === "ubuntu" && (
            <Check title="First boot runs cloud-init">
              The setup script downloads the Ubuntu LTS cloud image and seeds cloud-init with
              the guest credentials you set above (or auto-generated when blank) plus sudo
              NOPASSWD. SSH is up within ~60s; <code>ubuntu-desktop-minimal</code> install
              completes in 5–8 min.
            </Check>
          )}
          <Check title="ignore_msrs (only required for macOS)">
            <code className="block whitespace-pre-wrap rounded bg-[var(--color-surface-muted)] p-2 text-xs">
              wsl -- bash -lc &apos;echo 1 | sudo tee /sys/module/kvm/parameters/ignore_msrs&apos;
            </code>
          </Check>
        </CardContent>
      </Card>
    </div>
  );
}

function Check({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-medium">{title}</h3>
      <div className="mt-1 space-y-1 text-xs text-muted">{children}</div>
    </div>
  );
}

function Field({
  name,
  label,
  placeholder,
  description,
  error,
  required,
  type = "text",
  defaultValue,
}: {
  name: string;
  label: string;
  placeholder?: string;
  description?: string;
  error?: string;
  required?: boolean;
  type?: string;
  defaultValue?: string;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        placeholder={placeholder}
        required={required}
        type={type}
        defaultValue={defaultValue}
      />
      {description && <p className="text-xs text-muted">{description}</p>}
      {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
    </div>
  );
}
