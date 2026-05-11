"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Trash2, Copy, Check, Key } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { deleteSshKeyAction } from "@/server/actions/ssh-keys";

interface KeyRow {
  id: string;
  name: string;
  algo: string;
  publicKey: string;
  fingerprint: string | null;
  hasPrivateKey: boolean;
  notes: string | null;
  createdAt: Date;
}

export function SshKeyList({ keys }: { keys: KeyRow[] }) {
  const [pending, start] = useTransition();
  const [copied, setCopied] = useState<string | null>(null);

  const remove = (id: string, name: string) => {
    if (!confirm(`Delete SSH key “${name}”? Existing VMs using it remain accessible — only vmui forgets it.`)) return;
    start(async () => {
      const r = await deleteSshKeyAction(id);
      if (r.ok) toast.success("Key deleted");
      else toast.error("Delete failed");
    });
  };

  const copyKey = async (k: KeyRow) => {
    await navigator.clipboard.writeText(k.publicKey);
    setCopied(k.id);
    setTimeout(() => setCopied(null), 1200);
  };

  if (keys.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Key className="mx-auto mb-2 h-6 w-6 text-muted" />
          <p className="text-sm text-muted">No SSH keys saved yet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Saved keys ({keys.length})</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-[var(--color-border)]">
          {keys.map((k) => (
            <li key={k.id} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{k.name}</span>
                  <Badge variant="info" className="text-[10px]">
                    {k.algo}
                  </Badge>
                  {k.hasPrivateKey ? (
                    <Badge className="bg-[var(--color-success)]/10 text-[var(--color-success)] text-[10px]">
                      private
                    </Badge>
                  ) : (
                    <Badge variant="info" className="text-[10px]">
                      public-only
                    </Badge>
                  )}
                </div>
                <div className="mt-0.5 truncate font-mono text-[11px] text-muted">{k.fingerprint ?? "—"}</div>
                {k.notes && <div className="text-xs text-muted">{k.notes}</div>}
              </div>
              <Button size="sm" variant="ghost" onClick={() => copyKey(k)}>
                {copied === k.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied === k.id ? "Copied" : "Copy public"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => remove(k.id, k.name)}
                disabled={pending}
                className="text-[var(--color-danger)] hover:text-[var(--color-danger)]"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
