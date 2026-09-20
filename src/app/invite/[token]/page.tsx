import { AcceptInviteForm } from "@/components/auth/accept-invite-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { inviteByToken } from "@/lib/home/family";
import { UserPlus } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTranslations("family.accept");
  const inv = await inviteByToken(token);

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md items-center">
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex min-w-0 items-center gap-2 text-base">
            <UserPlus className="size-4 shrink-0 text-[var(--color-primary)]" />
            <span className="min-w-0 truncate">{inv ? t("title") : t("invalidTitle")}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {inv ? (
            <AcceptInviteForm token={token} name={inv.name} role={inv.role} rooms={inv.rooms} accessExpiresAt={inv.accessExpiresAt?.toISOString() ?? null} />
          ) : (
            <>
              <p className="text-sm text-muted">{t("invalidBody")}</p>
              <Link href="/sign-in" className="block text-sm text-[var(--color-primary)] underline-offset-4 hover:underline">{t("signIn")}</Link>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
