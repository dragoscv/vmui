"use client";

import { useTransition } from "react";
import { LogOut, ShieldCheck } from "lucide-react";
import { signOutAction } from "@/server/actions/auth";
import { Badge } from "@/components/ui/badge";

export function UserMenu({
  user,
}: {
  user: { email: string; displayName: string; role: "admin" | "operator" | "viewer" };
}) {
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-2 text-xs">
      <div className="hidden sm:flex flex-col items-end leading-tight">
        <span className="font-medium">{user.displayName}</span>
        <span className="text-muted">{user.email}</span>
      </div>
      <Badge variant={user.role === "admin" ? "info" : user.role === "operator" ? "default" : "muted"}>
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
