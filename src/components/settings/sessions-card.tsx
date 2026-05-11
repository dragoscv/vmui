"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LogOut, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  listSessionsAction,
  revokeAllOtherSessionsAction,
  revokeSessionAction,
  type SessionListItem,
} from "@/server/actions/sessions";

function relative(d: Date): string {
  const diff = Math.max(0, Date.now() - new Date(d).getTime());
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function SessionsCard() {
  const router = useRouter();
  const [rows, setRows] = useState<SessionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, start] = useTransition();

  async function refresh() {
    const s = await listSessionsAction();
    setRows(s);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  function revoke(id: string, isCurrent: boolean) {
    start(async () => {
      const r = await revokeSessionAction(id);
      if (r.ok) {
        toast.success("Session revoked");
        if (isCurrent) {
          router.push("/sign-in");
          router.refresh();
        } else {
          await refresh();
          router.refresh();
        }
      } else {
        toast.error(r.error ?? "Failed");
      }
    });
  }

  function revokeAll() {
    start(async () => {
      const r = await revokeAllOtherSessionsAction();
      if (r.ok) {
        toast.success(`Revoked ${r.count} other session(s)`);
        await refresh();
        router.refresh();
      }
    });
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading sessions…
      </div>
    );
  }

  if (rows.length === 0) {
    return <div className="text-xs text-muted">No active sessions.</div>;
  }

  const others = rows.filter((r) => !r.isCurrent).length;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted">
          {rows.length} active session{rows.length === 1 ? "" : "s"}
        </span>
        {others > 0 && (
          <Button size="sm" variant="ghost" onClick={revokeAll} disabled={pending}>
            <LogOut className="h-3.5 w-3.5" /> Sign out everywhere else
          </Button>
        )}
      </div>
      <ul className="divide-y divide-[var(--color-border)] rounded-[var(--radius-md)] border border-[var(--color-border)]">
        {rows.map((s) => (
          <li key={s.id} className="flex items-center justify-between px-3 py-2 text-sm">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium">{s.displayName}</span>
                <code className="text-[11px] text-muted">{s.email}</code>
                {s.isCurrent && <Badge variant="success">this session</Badge>}
              </div>
              <div className="mt-0.5 text-[11px] text-muted">
                Last seen {relative(s.lastSeenAt)} · created {relative(s.createdAt)} · expires {relative(s.expiresAt)}
              </div>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => revoke(s.id, s.isCurrent)}
              disabled={pending}
              aria-label="Revoke"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {s.isCurrent ? "Sign out" : "Revoke"}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
