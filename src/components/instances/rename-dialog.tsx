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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { renameInstanceAction } from "@/server/actions/instances";
import type { InstanceRow } from "@/lib/db/schema";
import { instanceLabel } from "./instance-label";

export function RenameInstanceDialog({
  open,
  onOpenChange,
  instance,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  instance: InstanceRow;
}) {
  const router = useRouter();
  const [value, setValue] = useState(instance.displayName ?? instance.name ?? "");
  const [pending, start] = useTransition();

  useEffect(() => {
    if (open) setValue(instance.displayName ?? instance.name ?? "");
  }, [open, instance.displayName, instance.name]);

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const next = value.trim();
    start(async () => {
      const r = await renameInstanceAction({
        id: instance.id,
        displayName: next.length === 0 ? null : next,
      });
      if (r.ok) {
        toast.success(next ? `Renamed to "${next}"` : "Custom name cleared");
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error(r.error ?? "Rename failed");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Rename instance</DialogTitle>
            <DialogDescription>
              Currently:{" "}
              <span className="font-mono text-xs">{instanceLabel(instance)}</span>. The provider
              name <span className="font-mono text-xs">{instance.name ?? "—"}</span> is
              preserved.
            </DialogDescription>
          </DialogHeader>
          <div className="my-4 space-y-2">
            <Label htmlFor="vmui-rename">Custom display name</Label>
            <Input
              id="vmui-rename"
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={instance.name ?? instance.providerInstanceId}
              maxLength={80}
            />
            <p className="text-xs text-muted">
              Leave blank to use the provider-supplied name. Up to 80 characters.
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
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
