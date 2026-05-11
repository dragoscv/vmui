"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { deleteUserAction, updateUserRoleAction } from "@/server/actions/auth";

export function UserRow({
  user,
  isSelf,
}: {
  user: {
    id: string;
    email: string;
    displayName: string;
    role: "admin" | "operator" | "viewer";
    createdAt: Date;
    lastLoginAt: Date | null;
  };
  isSelf: boolean;
}) {
  const [pending, start] = useTransition();
  const changeRole = (role: "admin" | "operator" | "viewer") => {
    start(async () => {
      const r = await updateUserRoleAction({ userId: user.id, role });
      if (!r.ok) toast.error(r.error ?? "Failed");
      else toast.success(`Role set to ${role}`);
    });
  };
  const remove = () => {
    if (!confirm(`Delete user ${user.email}?`)) return;
    start(async () => {
      const r = await deleteUserAction(user.id);
      if (!r.ok) toast.error(r.error ?? "Failed");
      else toast.success("User deleted");
    });
  };
  return (
    <div className="flex flex-wrap items-center gap-3 rounded border border-[var(--color-border)] bg-[var(--color-bg)]/40 px-3 py-2 text-sm">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 font-medium">
          {user.displayName}
          {isSelf && <Badge variant="info">you</Badge>}
        </div>
        <div className="text-xs text-muted">{user.email}</div>
        {user.lastLoginAt && (
          <div className="text-[10px] text-muted">last login {new Date(user.lastLoginAt).toLocaleString()}</div>
        )}
      </div>
      <select
        value={user.role}
        onChange={(e) => changeRole(e.target.value as "admin" | "operator" | "viewer")}
        disabled={pending || isSelf}
        className="h-8 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs"
      >
        <option value="admin">Admin</option>
        <option value="operator">Operator</option>
        <option value="viewer">Viewer</option>
      </select>
      <Button
        size="sm"
        variant="ghost"
        onClick={remove}
        disabled={pending || isSelf}
        title={isSelf ? "Can't delete yourself" : "Delete user"}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
