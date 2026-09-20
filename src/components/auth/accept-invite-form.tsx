"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FamilyRole, RoomGrants } from "@/lib/home/access-model";
import { ROOMS } from "@/lib/home/catalog";
import { acceptInviteAction } from "@/server/actions/family";
import { Loader2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

export function AcceptInviteForm({ token, name, role, rooms, accessExpiresAt }: { token: string; name: string; role: Exclude<FamilyRole, "owner">; rooms: RoomGrants; accessExpiresAt: string | null }) {
  const t = useTranslations("family");
  const roomNames = useTranslations("home.rooms");
  const locale = useLocale();
  const router = useRouter();
  const [displayName, setDisplayName] = React.useState(name);
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  const granted = ROOMS.filter((r) => rooms[r.id]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return void setError(t("errors.passwordShort"));
    if (password !== confirm) return void setError(t("errors.passwordMismatch"));
    setPending(true);
    const r = await acceptInviteAction({ token, email, displayName, password });
    if (!r.ok) {
      setPending(false);
      setError(r.error === "email_taken" ? t("errors.emailTaken") : r.error === "invalid" ? t("errors.invalid") : t("errors.generic", { message: r.error }));
      return;
    }
    toast.success(t("accept.joined"));
    router.push("/home");
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3">
      <div className="space-y-1 rounded-md border border-[var(--color-border)] bg-[color-mix(in_oklch,var(--color-primary)_8%,transparent)] px-3 py-2 text-xs">
        <p className="break-words">{t("accept.invited", { role: t(`roles.${role}`) })}</p>
        {granted.length === 0 ? (
          <p className="text-muted">{t("accept.noRooms")}</p>
        ) : (
          <>
            <p className="text-muted">{t("accept.roomsIntro")}</p>
            <ul className="flex flex-wrap gap-x-3 gap-y-1">
              {granted.map((r) => (
                <li key={r.id} className="min-w-0 break-words">
                  {roomNames(r.id)} <span className="text-muted">· {t(`level.${rooms[r.id] ?? "view"}`)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {accessExpiresAt && <p className="text-muted">{t("accept.accessUntil", { date: new Date(accessExpiresAt).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" }) })}</p>}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="displayName">{t("accept.displayName")}</Label>
        <Input id="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="name" maxLength={80} required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="email">{t("accept.email")}</Label>
        <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" maxLength={200} required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">{t("accept.password")}</Label>
        <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={8} maxLength={200} required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirm">{t("accept.confirmPassword")}</Label>
        <Input id="confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" minLength={8} maxLength={200} required />
      </div>
      {error && (
        <div role="alert" className="break-words rounded bg-[color-mix(in_oklch,var(--color-danger)_15%,transparent)] px-3 py-2 text-xs text-[var(--color-danger)]">
          {error}
        </div>
      )}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? <Loader2 className="size-4 animate-spin" /> : t("accept.submit")}
      </Button>
    </form>
  );
}
