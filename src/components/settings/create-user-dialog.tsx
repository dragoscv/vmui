"use client";

import { Alert, Button, Field, Input } from "@/components/ui";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { signUpAction, type SignUpState } from "@/server/actions/auth";
import { UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";

const ROLES = ["admin", "operator", "viewer"] as const;

export function CreateUserDialog() {
  const t = useTranslations("settings.users");
  const tc = useTranslations("common");
  const ta = useTranslations("auth");
  const tr = useTranslations("auth.roles");
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<(typeof ROLES)[number]>("viewer");
  const [state, action, pending] = useActionState<SignUpState, FormData>(signUpAction, undefined);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <UserPlus className="size-4" aria-hidden /> {t("add")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form action={action} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t("create.title")}</DialogTitle>
            <DialogDescription>{t("create.description")}</DialogDescription>
          </DialogHeader>
          {state?.error && <Alert tone="danger">{state.error}</Alert>}
          <Field label={ta("fields.displayName")}>
            <Input name="displayName" required maxLength={80} autoComplete="name" />
          </Field>
          <Field label={ta("fields.email")}>
            <Input name="email" type="email" required autoComplete="email" />
          </Field>
          <Field label={ta("fields.password")} hint={ta("fields.passwordHint")}>
            <Input name="password" type="password" required minLength={8} autoComplete="new-password" />
          </Field>
          <Field label={ta("fields.role")}>
            <input type="hidden" name="role" value={role} />
            <Select value={role} onValueChange={(v) => setRole(v as (typeof ROLES)[number])}>
              <SelectTrigger aria-label={ta("fields.role")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {tr(r)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              {tc("cancel")}
            </Button>
            <Button type="submit" loading={pending}>
              {t("create.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
