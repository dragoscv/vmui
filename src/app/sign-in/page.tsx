import { redirect } from "next/navigation";
import { LogIn } from "lucide-react";
import { userCount } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SignInForm } from "@/components/auth/sign-in-form";
import { SignInWithPasskeyButton } from "@/components/auth/sign-in-with-passkey-button";

export const dynamic = "force-dynamic";

export default async function SignInPage() {
  const n = await userCount();
  if (n === 0) {
    redirect("/sign-up");
  }
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md items-center">
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <LogIn className="h-4 w-4 text-[var(--color-primary)]" /> Sign in to vmui
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <SignInForm />
          <div className="relative py-1 text-center text-[11px] uppercase tracking-wider text-muted">
            <span className="absolute left-0 top-1/2 h-px w-[40%] -translate-y-1/2 bg-[var(--color-border)]" />
            <span className="absolute right-0 top-1/2 h-px w-[40%] -translate-y-1/2 bg-[var(--color-border)]" />
            <span className="relative bg-[var(--color-surface)] px-2">or</span>
          </div>
          <SignInWithPasskeyButton />
        </CardContent>
      </Card>
    </div>
  );
}
