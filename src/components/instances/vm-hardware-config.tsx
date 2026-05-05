"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Cpu, MemoryStick, Save, AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getHostCapabilitiesAction,
  getVmHardwareAction,
  updateVmHardwareAction,
  type HostCapabilities,
} from "@/server/actions/local-kvm";

const RAM_PRESETS_MB = [4096, 8192, 12288, 16384, 24576, 32768];
const CORES_OPTIONS = [1, 2, 4, 6, 8];
const THREAD_FACTORS = [1, 2]; // SMT 1× or 2×

interface Hardware {
  cores: number;
  threads: number;
  ramMb: number;
}

export function VmHardwareConfig({
  accountId,
  vmRunning,
}: {
  accountId: string;
  vmRunning: boolean;
}) {
  const [caps, setCaps] = useState<HostCapabilities | null>(null);
  const [initial, setInitial] = useState<Hardware | null>(null);
  const [draft, setDraft] = useState<Hardware | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  // Load current config + host caps in parallel
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [hwR, capsR] = await Promise.all([
        getVmHardwareAction(accountId),
        getHostCapabilitiesAction(accountId),
      ]);
      if (cancelled) return;
      if (hwR.ok) {
        const hw = { cores: hwR.cores, threads: hwR.threads, ramMb: hwR.ramMb };
        setInitial(hw);
        setDraft(hw);
      } else {
        setError(hwR.error);
      }
      if (capsR.ok) setCaps(capsR.caps);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">VM hardware</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-[var(--color-danger)]">{error}</div>
        </CardContent>
      </Card>
    );
  }

  if (!draft || !initial) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">VM hardware</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Probing host…
          </div>
        </CardContent>
      </Card>
    );
  }

  const dirty =
    draft.cores !== initial.cores ||
    draft.threads !== initial.threads ||
    draft.ramMb !== initial.ramMb;

  const maxRamMb = caps ? Math.max(1024, caps.hostMemMb - 1536) : 65536;
  const maxCores = caps ? caps.hostCores : 32;

  function setCores(c: number) {
    setDraft((d) =>
      d ? { ...d, cores: c, threads: Math.max(d.threads, c) } : d,
    );
  }
  function setThreads(t: number) {
    setDraft((d) => (d ? { ...d, threads: t } : d));
  }
  function setRam(r: number) {
    setDraft((d) => (d ? { ...d, ramMb: r } : d));
  }

  function reset() {
    setDraft(initial);
    setFieldErrors({});
  }

  function save() {
    if (!draft) return;
    setFieldErrors({});
    startTransition(async () => {
      const r = await updateVmHardwareAction(accountId, draft);
      if (r.ok) {
        setInitial(draft);
        toast.success(
          r.appliedNextBoot
            ? "Saved — restart the VM to apply changes"
            : "Saved",
        );
      } else {
        if (r.fieldErrors) setFieldErrors(r.fieldErrors);
        toast.error(r.error);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">VM hardware</CardTitle>
          {caps && (
            <div className="text-[11px] text-muted">
              host: {caps.hostCores} threads · {(caps.hostMemMb / 1024).toFixed(1)} GiB
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Cores */}
        <Field
          icon={Cpu}
          label="Cores per socket"
          value={String(draft.cores)}
          right={`${draft.cores} core${draft.cores > 1 ? "s" : ""}`}
        >
          <Pills
            value={draft.cores}
            options={CORES_OPTIONS.filter((c) => c <= maxCores)}
            onChange={setCores}
          />
        </Field>

        {/* Threads (SMT factor) */}
        <Field
          icon={Cpu}
          label="vCPU threads"
          value={`${draft.threads} (${(draft.threads / draft.cores).toFixed(0)}×SMT)`}
          right={`${draft.threads} threads`}
          error={fieldErrors.threads}
        >
          <Pills
            value={draft.threads}
            options={THREAD_FACTORS.map((f) => draft.cores * f).filter(
              (t) => t <= maxCores,
            )}
            onChange={setThreads}
            renderLabel={(t) => `${t}t (${(t / draft.cores).toFixed(0)}×)`}
          />
        </Field>

        {/* RAM */}
        <Field
          icon={MemoryStick}
          label="RAM"
          value={`${(draft.ramMb / 1024).toFixed(draft.ramMb % 1024 === 0 ? 0 : 1)} GiB`}
          right={`${draft.ramMb} MiB`}
          error={fieldErrors.ramMb}
        >
          <Pills
            value={draft.ramMb}
            options={RAM_PRESETS_MB.filter((r) => r <= maxRamMb)}
            onChange={setRam}
            renderLabel={(r) => `${r / 1024}G`}
          />
          <input
            type="range"
            min={1024}
            max={maxRamMb}
            step={1024}
            value={draft.ramMb}
            onChange={(e) => setRam(Number(e.target.value))}
            className="vmui-range mt-2 w-full"
            aria-label="RAM"
          />
        </Field>

        <AnimatePresence>
          {dirty && vmRunning && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="flex items-start gap-2 rounded-md border border-[color-mix(in_oklch,var(--color-warning,#f59e0b)_40%,transparent)] bg-[color-mix(in_oklch,var(--color-warning,#f59e0b)_10%,transparent)] p-2.5 text-xs">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-warning,#f59e0b)]" />
                <span>VM is running — changes apply on the next reboot.</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border)] pt-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={reset}
            disabled={!dirty || pending}
          >
            Reset
          </Button>
          <Button size="sm" onClick={save} disabled={!dirty || pending}>
            {pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({
  icon: Icon,
  label,
  value,
  right,
  children,
  error,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  right?: string;
  children: React.ReactNode;
  error?: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted">
          <Icon className="h-3 w-3" />
          {label}
        </div>
        <div className="font-mono text-sm tabular-nums">{value}</div>
      </div>
      {children}
      <div className="flex items-center justify-between text-[11px]">
        <span className={error ? "text-[var(--color-danger)]" : "text-muted"}>
          {error ?? "\u00a0"}
        </span>
        <span className="text-muted">{right}</span>
      </div>
    </div>
  );
}

function Pills<T extends number>({
  value,
  options,
  onChange,
  renderLabel,
}: {
  value: T;
  options: T[];
  onChange: (v: T) => void;
  renderLabel?: (v: T) => string;
}) {
  // Stable id-per-mount so each Pills group has its own layout animation
  const groupId = useId();
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const active = opt === value;
        return (
          <motion.button
            key={opt}
            type="button"
            layout
            whileTap={{ scale: 0.96 }}
            onClick={() => onChange(opt)}
            aria-pressed={active}
            className={
              "relative rounded-full border px-3 py-1 text-xs font-medium tabular-nums transition-colors " +
              (active
                ? "border-[var(--color-primary)] text-[var(--color-primary)]"
                : "border-[var(--color-border)] text-muted hover:text-fg")
            }
          >
            {active && (
              <motion.span
                layoutId={`pill-bg-${groupId}`}
                className="absolute inset-0 -z-10 rounded-full bg-[color-mix(in_oklch,var(--color-primary)_18%,transparent)]"
                transition={{ type: "spring", stiffness: 380, damping: 32 }}
              />
            )}
            {renderLabel ? renderLabel(opt) : opt}
          </motion.button>
        );
      })}
    </div>
  );
}
