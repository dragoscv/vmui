"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { motion, AnimatePresence } from "motion/react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  AlertTriangle,
  AlertOctagon,
  Info,
  HelpCircle,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Promise-based confirmation modal. Replaces native `window.confirm()` with a
 * themed, animated, accessible dialog. Mount <ConfirmProvider> once at the app
 * root and call `useConfirm()` from any client component.
 *
 * Usage:
 *   const confirm = useConfirm();
 *   if (!(await confirm({ title: "Delete?", tone: "danger" }))) return;
 */

type Tone = "danger" | "warning" | "info" | "neutral";

export interface ConfirmOptions {
  title: string;
  description?: React.ReactNode;
  tone?: Tone;
  confirmText?: string;
  cancelText?: string;
  /**
   * If provided, the confirm button is disabled until the user types this
   * string into the input field. Useful for irreversible actions.
   */
  requireText?: string;
  /**
   * Optional async work executed when the user confirms. The dialog stays
   * open with a spinner while it runs; rejection shows an inline error.
   */
  onConfirm?: () => Promise<void> | void;
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (v: boolean) => void;
}

const ConfirmContext = createContext<((opts: ConfirmOptions) => Promise<boolean>) | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");

  // We hold the active resolver in a ref so close handlers can settle the
  // promise even when state is stale (e.g. ESC key).
  const activeRef = useRef<PendingConfirm | null>(null);

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      const next: PendingConfirm = { ...opts, resolve };
      activeRef.current = next;
      setPending(next);
      setError(null);
      setBusy(false);
      setTyped("");
      setIsOpen(true);
    });
  }, []);

  function settle(value: boolean) {
    const cur = activeRef.current;
    activeRef.current = null;
    setIsOpen(false);
    cur?.resolve(value);
  }

  async function handleConfirm() {
    if (!pending || busy) return;
    if (pending.onConfirm) {
      setBusy(true);
      setError(null);
      try {
        await pending.onConfirm();
        settle(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Action failed");
        setBusy(false);
        return;
      }
    } else {
      settle(true);
    }
  }

  function handleOpenChange(open: boolean) {
    if (open) return;
    if (busy) return; // ignore close attempts during async work
    settle(false);
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <DialogPrimitive.Root open={isOpen} onOpenChange={handleOpenChange}>
        <AnimatePresence>
          {isOpen && pending && (
            <DialogPrimitive.Portal forceMount>
              <DialogPrimitive.Overlay asChild>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  className="fixed inset-0 z-[100] bg-black/45 backdrop-blur-sm"
                />
              </DialogPrimitive.Overlay>
              <DialogPrimitive.Content asChild>
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: 12 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: 8 }}
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                  className="glass fixed left-1/2 top-1/2 z-[101] w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-xl)] p-6 shadow-2xl"
                >
                  <ConfirmBody
                    pending={pending}
                    busy={busy}
                    error={error}
                    typed={typed}
                    setTyped={setTyped}
                    onCancel={() => !busy && settle(false)}
                    onConfirm={handleConfirm}
                  />
                </motion.div>
              </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
          )}
        </AnimatePresence>
      </DialogPrimitive.Root>
    </ConfirmContext.Provider>
  );
}

const TONE_STYLES: Record<
  Tone,
  { icon: LucideIcon; ring: string; text: string; variant: "primary" | "danger" }
> = {
  danger: {
    icon: AlertOctagon,
    ring: "bg-[color-mix(in_oklch,var(--color-danger)_18%,transparent)] text-[var(--color-danger)] ring-[color-mix(in_oklch,var(--color-danger)_35%,transparent)]",
    text: "text-[var(--color-danger)]",
    variant: "danger",
  },
  warning: {
    icon: AlertTriangle,
    ring: "bg-[color-mix(in_oklch,var(--color-warning,#f59e0b)_18%,transparent)] text-[var(--color-warning,#f59e0b)] ring-[color-mix(in_oklch,var(--color-warning,#f59e0b)_35%,transparent)]",
    text: "text-[var(--color-warning,#f59e0b)]",
    variant: "primary",
  },
  info: {
    icon: Info,
    ring: "bg-[color-mix(in_oklch,var(--color-primary)_18%,transparent)] text-[var(--color-primary)] ring-[color-mix(in_oklch,var(--color-primary)_35%,transparent)]",
    text: "text-[var(--color-primary)]",
    variant: "primary",
  },
  neutral: {
    icon: HelpCircle,
    ring: "bg-[var(--color-bg-muted)] text-[var(--color-fg-muted)] ring-[var(--color-border)]",
    text: "",
    variant: "primary",
  },
};

function ConfirmBody({
  pending,
  busy,
  error,
  typed,
  setTyped,
  onCancel,
  onConfirm,
}: {
  pending: PendingConfirm;
  busy: boolean;
  error: string | null;
  typed: string;
  setTyped: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const tone = pending.tone ?? "neutral";
  const t = TONE_STYLES[tone];
  const Icon = t.icon;
  const requireText = pending.requireText;
  const matched = !requireText || typed === requireText;

  // Auto-focus the cancel button (safe default) — destructive flows shouldn't
  // be triggered by an inadvertent <Enter>.
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const id = window.setTimeout(() => cancelRef.current?.focus(), 30);
    return () => window.clearTimeout(id);
  }, []);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && matched && !busy) {
      e.preventDefault();
      onConfirm();
    }
  }

  return (
    <div onKeyDown={onKeyDown} className="space-y-4">
      <div className="flex items-start gap-3">
        <motion.div
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 420, damping: 18, delay: 0.05 }}
          className={cn(
            "grid h-10 w-10 shrink-0 place-items-center rounded-full ring-1",
            t.ring,
          )}
        >
          <Icon className="h-5 w-5" />
        </motion.div>
        <div className="min-w-0 flex-1">
          <DialogPrimitive.Title className="text-base font-semibold leading-tight">
            {pending.title}
          </DialogPrimitive.Title>
          {pending.description && (
            <DialogPrimitive.Description className="mt-1.5 text-sm text-muted">
              {pending.description}
            </DialogPrimitive.Description>
          )}
        </div>
      </div>

      {requireText && (
        <div className="space-y-1.5">
          <label className="text-xs text-muted">
            Type{" "}
            <code className="rounded bg-[var(--color-bg-muted)] px-1.5 py-0.5 font-mono text-[11px] text-fg">
              {requireText}
            </code>{" "}
            to confirm
          </label>
          <input
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            disabled={busy}
            className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm outline-none transition-colors focus:border-[var(--color-primary)]"
            placeholder={requireText}
            aria-label="Confirmation phrase"
          />
        </div>
      )}

      {error && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-md bg-[color-mix(in_oklch,var(--color-danger)_15%,transparent)] px-3 py-2 text-xs text-[var(--color-danger)]"
        >
          {error}
        </motion.div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button
          ref={cancelRef}
          variant="ghost"
          size="sm"
          onClick={onCancel}
          disabled={busy}
        >
          {pending.cancelText ?? "Cancel"}
        </Button>
        <Button
          variant={t.variant}
          size="sm"
          onClick={onConfirm}
          disabled={busy || !matched}
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {pending.confirmText ?? "Confirm"}
        </Button>
      </div>
    </div>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error("useConfirm must be used within <ConfirmProvider>");
  }
  return ctx;
}

/**
 * Convenience wrapper for the common "danger / require text" pattern.
 * Returns true if confirmed, false otherwise.
 */
export function useConfirmDanger() {
  const confirm = useConfirm();
  return useMemo(
    () =>
      (
        title: string,
        description?: React.ReactNode,
        opts: Partial<ConfirmOptions> = {},
      ) =>
        confirm({
          title,
          description,
          tone: "danger",
          confirmText: "Delete",
          ...opts,
        }),
    [confirm],
  );
}
