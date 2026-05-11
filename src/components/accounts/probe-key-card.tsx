"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Key, ShieldCheck, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { uploadProbeKeyAction, clearProbeKeyAction } from "@/server/actions/probe";

interface Props {
  accountId: string;
  hasKey: boolean;
}

export function ProbeKeyCard({ accountId, hasKey }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [privateKey, setPrivateKey] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [defaultUser, setDefaultUser] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const out = await uploadProbeKeyAction({
        accountId,
        privateKey,
        passphrase: passphrase || undefined,
        defaultUser: defaultUser || undefined,
      });
      if (out.ok) {
        toast.success("Probe key uploaded");
        setPrivateKey("");
        setPassphrase("");
        setOpen(false);
      } else {
        toast.error(out.error ?? "Upload failed");
      }
    });
  };

  const clear = () => {
    if (!confirm("Remove the probe key? Cockpit & cloud-init streaming will stop until you upload a new one.")) {
      return;
    }
    startTransition(async () => {
      await clearProbeKeyAction({ accountId });
      toast.success("Probe key removed");
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Key className="h-4 w-4" /> Probe SSH key
        </CardTitle>
        <CardDescription>
          One private key used by vmui to collect cockpit metrics & stream cloud-init logs for every instance
          in this account. Stored encrypted with your master key.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {hasKey && !open ? (
          <div className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[color-mix(in_oklch,var(--color-primary)_6%,transparent)] px-3 py-2">
            <div className="flex items-center gap-2 text-xs">
              <ShieldCheck className="h-4 w-4 text-[var(--color-primary)]" />
              <span className="font-medium">Probe key configured</span>
              <span className="text-muted">— ready for live metrics</span>
            </div>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" onClick={() => setOpen(true)} disabled={pending}>
                Replace
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={clear}
                disabled={pending}
                className="text-red-600 hover:bg-red-500/10 dark:text-red-400"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ) : !open ? (
          <Button onClick={() => setOpen(true)} size="sm">
            <Key className="mr-1.5 h-3.5 w-3.5" /> Upload probe key
          </Button>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium">Private key (PEM)</span>
              <textarea
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
                required
                rows={6}
                placeholder={"-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----"}
                className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 font-mono text-[11px]"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs font-medium">Passphrase (optional)</span>
                <input
                  type="password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-xs"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium">Default user (optional)</span>
                <input
                  type="text"
                  value={defaultUser}
                  onChange={(e) => setDefaultUser(e.target.value)}
                  placeholder="ubuntu / ec2-user / root"
                  className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-xs"
                />
              </label>
            </div>
            <div className="flex items-center gap-2">
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? "Saving…" : "Save key"}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
