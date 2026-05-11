"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

const SHORTCUTS: { keys: string; desc: string }[] = [
  { keys: "⌘ K", desc: "Open command palette" },
  { keys: "?", desc: "Show this help" },
  { keys: "/", desc: "Focus dashboard search" },
  { keys: "G I", desc: "Go to Instances" },
  { keys: "G A", desc: "Go to Accounts" },
  { keys: "G L", desc: "Go to Activity log" },
  { keys: "G S", desc: "Go to Settings" },
  { keys: "N", desc: "Launch new instance" },
  { keys: "R", desc: "Sync all accounts" },
  { keys: "T", desc: "Toggle theme" },
  { keys: "Esc", desc: "Clear selection / close dialog" },
];

export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Move through vmui without leaving the keyboard.</DialogDescription>
        </DialogHeader>
        <ul className="grid gap-2 text-sm sm:grid-cols-2">
          {SHORTCUTS.map((s) => (
            <li
              key={s.keys}
              className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-muted)] px-3 py-2"
            >
              <span className="text-muted">{s.desc}</span>
              <kbd className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-0.5 font-mono text-[11px]">
                {s.keys}
              </kbd>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
