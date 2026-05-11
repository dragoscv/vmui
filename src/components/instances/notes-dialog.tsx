"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { setInstanceNotesAction } from "@/server/actions/instances";
import type { InstanceRow } from "@/lib/db/schema";

export function NotesDialog({
  open,
  onOpenChange,
  instance,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  instance: InstanceRow;
}) {
  const router = useRouter();
  const [value, setValue] = useState(instance.notes ?? "");
  const [pending, start] = useTransition();

  useEffect(() => {
    if (open) setValue(instance.notes ?? "");
  }, [open, instance.notes]);

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    start(async () => {
      const r = await setInstanceNotesAction({
        id: instance.id,
        notes: value.trim() ? value : null,
      });
      if (r.ok) {
        toast.success("Notes saved");
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error(r.error ?? "Failed");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Notes</DialogTitle>
            <DialogDescription>
              Private notes stored locally. Markdown is not rendered.
            </DialogDescription>
          </DialogHeader>
          <div className="my-4 space-y-2">
            <Label htmlFor="vmui-notes">Notes</Label>
            <textarea
              id="vmui-notes"
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              rows={6}
              maxLength={2000}
              className="flex w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-[var(--color-fg-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklch,var(--color-primary)_55%,transparent)]"
              placeholder="e.g. Build agent for evocrm. Don’t terminate."
            />
            <p className="text-right text-[11px] text-muted">{value.length}/2000</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
