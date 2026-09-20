"use client";

import { Badge } from "@/components/ui/badge";
import { signOutAction } from "@/server/actions/auth";
import { LogOut, ShieldCheck } from "lucide-react";
import { useTransition } from "react";

export function UserMenu({
  user,
}: {
  user: { email: string; displayName: string; role: "admin" | "operator" | "viewer" };
}) {
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-1 text-xs sm:gap-2">
      <div className="hidden max-w-48 flex-col items-end leading-tight lg:flex">
        <span className="truncate font-medium">{user.displayName}</span>
        <span className="truncate text-muted">{user.email}</span>
      </div>
      <Badge variant={user.role === "admin" ? "info" : user.role === "operator" ? "default" : "muted"} title={`${user.displayName} · ${user.email}`} className="hidden sm:inline-flex">
        <ShieldCheck className="mr-1 h-3 w-3" />
        {user.role}
      </Badge>
      <button
        type="button"
        disabled={pending}
        onClick={() => start(() => signOutAction())}
        title="Sign out"
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-white/5 hover:text-fg disabled:opacity-50"
      >
        <LogOut className="h-4 w-4" />
      </button>
    </div>
  );
}
