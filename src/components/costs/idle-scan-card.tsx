"use client";

import { useState, useTransition } from "react";
import { Pause, RefreshCcw, ZapOff } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { findIdleAwsInstances } from "@/server/actions/idle-scan";

interface IdleHint {
  instanceId: string;
  providerInstanceId: string;
  name: string;
  averageCpuPct: number;
}

export function IdleScanCard() {
  const [pending, startTransition] = useTransition();
  const [hints, setHints] = useState<IdleHint[] | null>(null);

  function run() {
    startTransition(async () => {
      try {
        const r = await findIdleAwsInstances();
        setHints(r);
        if (r.length === 0) toast.success("No idle AWS instances found.");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Idle scan failed");
      }
    });
  }

  return (
    <Card className="surface">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ZapOff className="h-4 w-4 text-[var(--color-warning)]" />
          Idle CPU scan
          <Button variant="ghost" size="sm" disabled={pending} onClick={run} className="ml-auto">
            <RefreshCcw className="h-3.5 w-3.5" />
            {pending ? "Scanning…" : hints ? "Re-scan" : "Scan AWS"}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {hints === null ? (
          <p className="text-xs text-muted">
            Click <em>Scan AWS</em> to query CloudWatch and flag running EC2 instances with average CPU below 5% over
            the last 7 days. Read-only — no actions are taken automatically.
          </p>
        ) : hints.length === 0 ? (
          <p className="text-xs text-muted">All running AWS VMs look active. Nothing to flag.</p>
        ) : (
          <div className="grid gap-2">
            {hints.map((h) => (
              <Link
                key={h.instanceId}
                href={`/instances/${encodeURIComponent(h.instanceId)}`}
                className="flex items-center justify-between rounded border border-[var(--color-border)] bg-[var(--color-bg)]/40 px-3 py-2 hover:border-[var(--color-warning)]/40"
              >
                <div className="flex items-center gap-3">
                  <Badge variant="warning">IDLE</Badge>
                  <span className="text-sm">{h.name}</span>
                  <span className="font-mono text-[11px] text-muted">{h.providerInstanceId}</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <Pause className="h-3 w-3 text-muted" />
                  <span>{h.averageCpuPct}% avg CPU · 7d</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
