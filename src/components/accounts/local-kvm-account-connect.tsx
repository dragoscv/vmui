"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, ShieldCheck, MonitorCog, Terminal } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { addLocalKvmAccount, type LocalKvmAccountFormState } from "@/server/actions/accounts";

const initial: LocalKvmAccountFormState = {};

export function LocalKvmAccountConnect() {
  const [state, action, pending] = useActionState(addLocalKvmAccount, initial);
  const router = useRouter();

  useEffect(() => {
    if (state.ok && state.accountId) {
      toast.success("Local KVM host connected");
      router.push("/");
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
              Connect a WSL2 distro running QEMU/KVM with an OSX-KVM checkout. vmui drives lifecycle through QMP.
            </p>
          </div>
        </CardHeader>
        <CardContent>
          <form action={action} className="grid gap-4">
            <Field
              name="name"
              label="Display name"
              placeholder="Local Mac (KVM)"
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
              label="OSX-KVM directory"
              placeholder="/home/dragos/OSX-KVM"
              description="Absolute Linux path inside the WSL distro. Must contain boot-mac.sh."
              error={state.fieldErrors?.vmDir}
              required
              defaultValue="/home/dragos/OSX-KVM"
            />
            <div className="grid grid-cols-4 gap-3">
              <Field
                name="vncPort"
                label="VNC port"
                type="number"
                defaultValue="5900"
                error={state.fieldErrors?.vncPort}
              />
              <Field
                name="qmpPort"
                label="QMP port"
                type="number"
                defaultValue="4444"
                error={state.fieldErrors?.qmpPort}
              />
              <Field
                name="sshPort"
                label="SSH fwd"
                type="number"
                defaultValue="10022"
                error={state.fieldErrors?.sshPort}
              />
              <Field
                name="wsPort"
                label="WS port"
                type="number"
                defaultValue="6080"
                error={state.fieldErrors?.wsPort}
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field
                name="cores"
                label="Cores / socket"
                type="number"
                defaultValue="4"
                error={state.fieldErrors?.cores}
              />
              <Field
                name="threads"
                label="vCPU threads"
                type="number"
                defaultValue="8"
                error={state.fieldErrors?.threads}
              />
              <Field
                name="ramMb"
                label="RAM (MiB)"
                type="number"
                defaultValue="16384"
                error={state.fieldErrors?.ramMb}
              />
            </div>
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
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-[var(--radius-md)] bg-[color-mix(in_oklch,var(--color-primary)_15%,transparent)]">
            <Terminal className="h-5 w-5 text-[var(--color-primary)]" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Setup checklist</h2>
            <p className="text-xs text-muted">Verify the WSL2 side has everything before connecting.</p>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <Check title="WSL2 with /dev/kvm">
            <code className="block whitespace-pre-wrap rounded bg-[var(--color-surface-muted)] p-2 text-xs">
              wsl -- bash -lc &apos;ls -la /dev/kvm&apos;
            </code>
            Should print <code>crw-rw---- 1 root kvm</code>. If missing, your CPU virt is off in BIOS or Hyper-V is broken.
          </Check>
          <Check title="QEMU + libvirt installed">
            <code className="block whitespace-pre-wrap rounded bg-[var(--color-surface-muted)] p-2 text-xs">
              wsl -- bash -lc &apos;qemu-system-x86_64 --version&apos;
            </code>
            Run <code>scripts/setup-osx-kvm.sh</code> if not present.
          </Check>
          <Check title="OSX-KVM checked out and boot-mac.sh present">
            <code className="block whitespace-pre-wrap rounded bg-[var(--color-surface-muted)] p-2 text-xs">
              wsl -- bash -lc &apos;ls ~/OSX-KVM/boot-mac.sh&apos;
            </code>
            <code>boot-mac.sh</code> is from <code>scripts/boot-mac.sh</code> (16 GB, 8 vCPU, VNC + QMP).
          </Check>
          <Check title="macOS installed (or installing)">
            Connect a VNC client to <code>127.0.0.1:5900</code> after starting the VM. First boot needs you to format
            the virtual disk in Disk Utility and pick &quot;Reinstall macOS&quot;.
          </Check>
          <Check title="ignore_msrs enabled">
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
