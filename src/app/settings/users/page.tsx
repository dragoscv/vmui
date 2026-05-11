import "server-only";
import { redirect } from "next/navigation";
import { Users } from "lucide-react";
import Link from "next/link";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getCurrentUser, ROLE_RANK, authEnabled } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UserRow } from "@/components/settings/user-row";
import { SessionsCard } from "@/components/settings/sessions-card";
import { PasskeysCard } from "@/components/settings/passkeys-card";
import { TotpCard } from "@/components/settings/totp-card";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  if (!(await authEnabled())) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted">
            Multi-user mode is not enabled.{" "}
            <Link href="/sign-up" className="text-[var(--color-primary)] underline">
              Create the first admin
            </Link>{" "}
            to enable sign-in.
          </CardContent>
        </Card>
      </div>
    );
  }
  const me = await getCurrentUser();
  if (!me || ROLE_RANK[me.role] < ROLE_RANK.admin) {
    redirect("/");
  }
  const rows = await db.select().from(users).orderBy(desc(users.createdAt));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <Button asChild size="sm">
          <Link href="/sign-up">Add user</Link>
        </Button>
      </div>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4" /> Local users
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {rows.map((u) => (
            <UserRow
              key={u.id}
              user={{
                id: u.id,
                email: u.email,
                displayName: u.displayName,
                role: u.role,
                createdAt: u.createdAt,
                lastLoginAt: u.lastLoginAt,
              }}
              isSelf={u.id === me.id}
            />
          ))}
        </CardContent>
      </Card>
      <p className="text-xs text-muted">
        Roles: <Badge variant="info">admin</Badge> manage users + everything,{" "}
        <Badge variant="default">operator</Badge> can mutate cloud resources,{" "}
        <Badge variant="muted">viewer</Badge> read-only.
      </p>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Active sessions</CardTitle>
        </CardHeader>
        <CardContent>
          <SessionsCard />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Passkeys</CardTitle>
        </CardHeader>
        <CardContent>
          <PasskeysCard />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Two-factor authentication</CardTitle>
        </CardHeader>
        <CardContent>
          <TotpCard />
        </CardContent>
      </Card>
    </div>
  );
}
