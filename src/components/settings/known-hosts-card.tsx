"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ShieldCheck, Trash2, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { forgetKnownHostAction, type KnownHostRow } from "@/server/actions/known-hosts";

export function KnownHostsCard({ initial }: { initial: KnownHostRow[] }) {
  const [rows, setRows] = useState(initial);
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const confirm = useConfirm();

  function forget(row: KnownHostRow) {
    start(async () => {
      const ok = await confirm({
        title: `Forget host key for ${row.host}:${row.port}?`,
        description:
          "Next SSH connection to this host will accept whatever fingerprint the server presents and pin it again. Use this only when you intentionally rotated the server's key.",
        tone: "warning",
        confirmText: "Forget pin",
      });
      if (!ok) return;
      setBusy(row.id);
      const r = await forgetKnownHostAction({ host: row.host, port: row.port });
      setBusy(null);
      if (r.ok) {
        toast.success("Host key forgotten");
        setRows((prev) => prev.filter((x) => x.id !== row.id));
      } else {
        toast.error("Failed", { description: r.error });
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <ShieldCheck className="h-4 w-4" /> SSH known hosts
        </CardTitle>
        <CardDescription>
          The SSH bridge pins each server's host key on first connect (trust-on-first-use). Connections refuse if a
          fingerprint changes — protects against MITM. Forget a pin when you intentionally rotate a server's key.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-xs text-muted">
            No host keys pinned yet — open any SSH session and the fingerprint will be recorded automatically.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--color-border)] rounded-md border border-[var(--color-border)]">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-3 py-2 text-xs">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">
                    {r.host}
                    <span className="text-muted">:{r.port}</span>
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[10px] text-muted">
                    sha256:{r.fingerprintSha256.slice(0, 32)}…
                  </div>
                  <div className="mt-0.5 text-[10px] text-muted">
                    first seen {new Date(r.firstSeenAt).toLocaleDateString()} · last{" "}
                    {new Date(r.lastSeenAt).toLocaleString()}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted hover:text-[var(--color-danger)]"
                  onClick={() => forget(r)}
                  disabled={pending && busy === r.id}
                  title="Forget pin"
                >
                  {pending && busy === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
