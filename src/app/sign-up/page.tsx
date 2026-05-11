import { redirect } from "next/navigation";
import { UserPlus } from "lucide-react";
import { userCount, getCurrentUser, ROLE_RANK } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SignUpForm } from "@/components/auth/sign-up-form";

export const dynamic = "force-dynamic";

export default async function SignUpPage() {
  const n = await userCount();
  const isFirst = n === 0;
  if (!isFirst) {
    const me = await getCurrentUser();
    if (!me || ROLE_RANK[me.role] < ROLE_RANK.admin) {
      redirect("/sign-in");
    }
  }
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md items-center">
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserPlus className="h-4 w-4 text-[var(--color-primary)]" />
            {isFirst ? "Create the first vmui admin" : "Add a user"}
          </CardTitle>
          {isFirst && (
            <p className="text-xs text-muted">
              No users exist yet — this account becomes the local admin.
            </p>
          )}
        </CardHeader>
        <CardContent>
          <SignUpForm firstUser={isFirst} />
        </CardContent>
      </Card>
    </div>
  );
}
