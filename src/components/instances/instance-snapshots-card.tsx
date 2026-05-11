"use client";

import { useEffect, useState, useTransition } from "react";
import { Camera, Loader2, RefreshCw, AlertTriangle, Trash2, Rocket } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  createInstanceSnapshotAction,
  deleteInstanceSnapshotAction,
  listInstanceSnapshotsAction,
  restoreInstanceFromSnapshotAction,
  type InstanceSnapshotRow,
} from "@/server/actions/snapshots";

interface Props {
  accountId: string;
  region: string;
  providerInstanceId: string;
  provider: string;
}

const SUPPORTED = new Set(["aws", "azure", "gcp"]);

export function InstanceSnapshotsCard({ accountId, region, providerInstanceId, provider }: Props) {
  const [rows, setRows] = useState<InstanceSnapshotRow[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [label, setLabel] = useState("");
  const [pending, start] = useTransition();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const supported = SUPPORTED.has(provider);
  const restoreSupported = provider === "aws" || provider === "azure" || provider === "gcp";
  const confirm = useConfirm();

  async function refresh() {
    setRefreshing(true);
    const r = await listInstanceSnapshotsAction({ accountId, region, providerInstanceId });
    setRefreshing(false);
    if (r.ok) setRows(r.rows);
  }

  useEffect(() => {
    if (supported) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, region, providerInstanceId, supported]);

  function takeSnapshot() {
    const trimmed = label.trim();
    if (!trimmed) {
      toast.error("Give the snapshot a label first.");
      return;
    }
    start(async () => {
      const r = await createInstanceSnapshotAction({
        accountId,
        region,
        providerInstanceId,
        label: trimmed,
      });
      if (r.ok) {
        toast.success("Snapshot created", {
          description: `${r.snapshotId}${r.note ? ` · ${r.note}` : ""}`,
        });
        setLabel("");
        void refresh();
      } else {
        toast.error("Snapshot failed", { description: r.error });
      }
    });
  }

  async function removeSnapshot(snap: InstanceSnapshotRow) {
    const ok = await confirm({
      title: `Delete snapshot ${snap.name ?? snap.externalId}?`,
      description: (
        <>
          This permanently destroys the snapshot. Storage cost stops accruing
          immediately on AWS / GCP and after a short async delete on Azure.{" "}
          <b>Cannot be undone.</b>
        </>
      ),
      tone: "danger",
      confirmText: "Delete",
      requireText: "delete",
    });
    if (!ok) return;
    setDeletingId(snap.id);
    const r = await deleteInstanceSnapshotAction({
      accountId,
      region: snap.region,
      snapshotId: snap.externalId,
    });
    setDeletingId(null);
    if (r.ok) {
      toast.success("Snapshot deleted");
      // Optimistic local removal.
      setRows((prev) => (prev ? prev.filter((x) => x.id !== snap.id) : prev));
    } else {
      toast.error("Delete failed", { description: r.error });
    }
  }

  async function restoreSnapshot(snap: InstanceSnapshotRow) {
    const defaultType =
      provider === "aws" ? "t3.small" : provider === "azure" ? "Standard_B2s" : "e2-small";
    const ok = await confirm({
      title: `Restore from ${snap.name ?? snap.externalId}?`,
      description: (
        <>
          Launches a brand-new instance booting from this snapshot. The original
          VM and snapshot stay untouched. New VM uses instance type{" "}
          <code>{defaultType}</code>.
        </>
      ),
      tone: "warning",
      confirmText: "Launch",
    });
    if (!ok) return;
    setRestoringId(snap.id);
    const r = await restoreInstanceFromSnapshotAction({
      accountId,
      region: snap.region,
      snapshotId: snap.externalId,
      label: snap.name ?? snap.externalId,
      instanceType: defaultType,
    });
    setRestoringId(null);
    if (r.ok) {
      toast.success("Instance launched from snapshot", { description: r.providerInstanceId });
    } else {
      toast.error("Restore failed", { description: r.error });
    }
  }

  if (!supported) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Camera className="h-4 w-4" /> Snapshots
          </CardTitle>
          <CardDescription>
            Snapshots are not supported for the <code>{provider}</code> provider yet.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const matched = (rows ?? []).filter((r) => r.isLikelyMatch);
  const others = (rows ?? []).filter((r) => !r.isLikelyMatch);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Camera className="h-4 w-4" /> Snapshots
            </CardTitle>
            <CardDescription>
              Boot-disk snapshot of this instance. Cached results refresh when the resource sync runs.
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={refresh} disabled={refreshing}>
            {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-48 space-y-1.5">
            <Label htmlFor="snap-label">Label</Label>
            <Input
              id="snap-label"
              placeholder="pre-upgrade"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              disabled={pending}
              maxLength={120}
            />
          </div>
          <Button onClick={takeSnapshot} disabled={pending || !label.trim()}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
            Take snapshot
          </Button>
        </div>

        {rows == null ? (
          <p className="text-xs text-muted">Loading snapshots…</p>
        ) : rows.length === 0 ? (
          <p className="text-xs text-muted">No snapshots cached for this account / region yet.</p>
        ) : (
          <div className="space-y-3">
            {matched.length > 0 && (
              <SnapshotList
                title="Likely matches"
                rows={matched}
                muted={false}
                onDelete={removeSnapshot}
                deletingId={deletingId}
                onRestore={restoreSupported ? restoreSnapshot : undefined}
                restoringId={restoringId}
              />
            )}
            {others.length > 0 && (
              <SnapshotList
                title={`Other snapshots in ${region}`}
                subtitle="Not directly tied to this VM."
                rows={others}
                muted
                onDelete={removeSnapshot}
                deletingId={deletingId}
                onRestore={restoreSupported ? restoreSnapshot : undefined}
                restoringId={restoringId}
              />
            )}
            {matched.length === 0 && others.length > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-dashed border-[var(--color-border)] p-2 text-[11px] text-muted">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                Snapshot ↔ instance link is heuristic (name contains the instance id). Take a fresh snapshot to confirm.
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SnapshotList({
  title,
  subtitle,
  rows,
  muted,
  onDelete,
  deletingId,
  onRestore,
  restoringId,
}: {
  title: string;
  subtitle?: string;
  rows: InstanceSnapshotRow[];
  muted: boolean;
  onDelete: (snap: InstanceSnapshotRow) => void;
  deletingId: string | null;
  onRestore?: (snap: InstanceSnapshotRow) => void;
  restoringId: string | null;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline gap-2">
        <h4 className={`text-xs font-medium ${muted ? "text-muted" : "text-fg"}`}>{title}</h4>
        {subtitle && <span className="text-[11px] text-muted">{subtitle}</span>}
      </div>
      <ul className="divide-y divide-[var(--color-border)] rounded-md border border-[var(--color-border)]">
        {rows.map((r) => {
          const isDeleting = deletingId === r.id;
          const isRestoring = restoringId === r.id;
          return (
            <li key={r.id} className="flex items-center gap-3 px-3 py-2 text-xs">
              <Camera className="h-3.5 w-3.5 shrink-0 text-muted" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{r.name ?? r.externalId}</div>
                <div className="mt-0.5 truncate font-mono text-[10px] text-muted">{r.externalId}</div>
              </div>
              {r.status && (
                <Badge variant={r.status.toLowerCase().includes("ready") || r.status === "completed" ? "success" : "info"}>
                  {r.status}
                </Badge>
              )}
              {r.sizeBytes != null && (
                <span className="hidden text-[11px] text-muted sm:inline">{formatBytes(r.sizeBytes)}</span>
              )}
              {onRestore && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted hover:text-[var(--color-fg)]"
                  onClick={() => onRestore(r)}
                  disabled={isRestoring || isDeleting}
                  title="Launch new instance from this snapshot"
                >
                  {isRestoring ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted hover:text-[var(--color-danger)]"
                onClick={() => onDelete(r)}
                disabled={isDeleting || isRestoring}
                title="Delete snapshot"
              >
                {isDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function formatBytes(b: number): string {
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let n = b;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
}
