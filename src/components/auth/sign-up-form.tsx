"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { signUpAction, type SignUpState } from "@/server/actions/auth";

const initial: SignUpState = undefined;

export function SignUpForm({ firstUser }: { firstUser: boolean }) {
  const [state, action, pending] = useActionState(signUpAction, initial);
  return (
    <form action={action} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="displayName">Display name</Label>
        <Input id="displayName" name="displayName" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
        <p className="text-[10px] text-muted">At least 8 characters.</p>
      </div>
      {!firstUser && (
        <div className="space-y-1.5">
          <Label htmlFor="role">Role</Label>
          <select
            id="role"
            name="role"
            className="flex h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
            defaultValue="viewer"
          >
            <option value="admin">Admin</option>
            <option value="operator">Operator</option>
            <option value="viewer">Viewer</option>
          </select>
        </div>
      )}
      {state?.error && (
        <div className="rounded bg-[color-mix(in_oklch,var(--color-danger)_15%,transparent)] px-3 py-2 text-xs text-[var(--color-danger)]">
          {state.error}
        </div>
      )}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : firstUser ? "Create admin" : "Create user"}
      </Button>
    </form>
  );
}
