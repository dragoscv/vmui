"use client";

import { RoomGrantsEditor } from "@/components/home/room-grants-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field, Panel, Subsection } from "@/components/ui/settings-panel";
import { FAMILY_ROLES, type FamilyRole, type RoomGrants } from "@/lib/home/access-model";
import { ROOMS } from "@/lib/home/catalog";
import { bindDeviceAction, createInviteAction, createMemberAccountAction, removeMemberAction, revokeInviteAction, upsertMemberAction } from "@/server/actions/family";
import { Check, Copy, Laptop, Link2, Loader2, Smartphone, Trash2, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import * as React from "react";
import { toast } from "sonner";

export type InviteRole = Exclude<FamilyRole, "owner">;

export type FamilyMemberView = {
  userId: string;
  email: string;
  displayName: string;
  role: FamilyRole;
  rooms: RoomGrants;
  /** ISO string */
  expiresAt: string | null;
  /** ISO string */
  lastLoginAt: string | null;
  devices: Array<{ id: string; name: string; platform: string; lastSeenAt: string | null }>;
};

export type FamilyInviteView = {
  id: string;
  name: string;
  role: InviteRole;
  rooms: RoomGrants;
  /** ISO string — guest access expiry copied at acceptance */
  accessExpiresAt: string | null;
  /** ISO string — when the link stops working */
  expiresAt: string;
};

export type FamilyCandidate = { id: string; email: string; displayName: string };

export type FamilyCardProps = {
  members: FamilyMemberView[];
  invites: FamilyInviteView[];
  candidates: FamilyCandidate[];
  /** Current user's id — cannot remove themselves. */
  me: string;
  /** `https://host` used to build invite links. */
  origin: string;
};

type T = ReturnType<typeof useTranslations<"family">>;
const INVITE_ROLES: InviteRole[] = ["adult", "child", "guest"];

// datetime-local wants a local wall-clock value without zone; the actions want ISO.
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function toIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function sameGrants(a: RoomGrants, b: RoomGrants): boolean {
  return ROOMS.every((r) => (a[r.id] ?? "none") === (b[r.id] ?? "none"));
}
function errorText(t: T, error: string): string {
  if (error === "email_taken") return t("errors.emailTaken");
  if (error === "invalid") return t("errors.invalid");
  return t("errors.generic", { message: error });
}
function generatePassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length] ?? "x").join("");
}

/** Household access: members with per-room grants, invite links with QR, direct account creation. */
export function FamilyCard({ members, invites, candidates, me, origin }: FamilyCardProps) {
  const t = useTranslations("family");
  return (
    <Panel id="family" title={t("title")} description={t("description")}>
      <div className="space-y-4">
        <Subsection title={t("members.title")} hint={t("members.hint")}>
          {members.length === 0 ? (
            <p className="text-sm text-muted">{t("members.empty")}</p>
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {members.map((m) => (
                <MemberRow key={`${m.userId}:${m.role}:${JSON.stringify(m.rooms)}:${m.expiresAt ?? ""}:${m.devices.length}`} member={m} isMe={m.userId === me} />
              ))}
            </ul>
          )}
        </Subsection>
        <InviteSection invites={invites} origin={origin} />
        <CreateAccountSection />
        {candidates.length > 0 && <ExistingUserSection candidates={candidates} />}
      </div>
    </Panel>
  );
}

// ---- members

function MemberRow({ member, isMe }: { member: FamilyMemberView; isMe: boolean }) {
  const t = useTranslations("family");
  const router = useRouter();
  const [role, setRole] = React.useState<FamilyRole>(member.role);
  const [rooms, setRooms] = React.useState<RoomGrants>(member.rooms);
  const [expiresAt, setExpiresAt] = React.useState(toLocalInput(member.expiresAt));
  const [busy, setBusy] = React.useState<"save" | "remove" | string | null>(null);

  const dirty = role !== member.role || !sameGrants(rooms, member.rooms) || expiresAt !== toLocalInput(member.expiresAt);
  const expired = member.expiresAt !== null && new Date(member.expiresAt).getTime() < Date.now();

  const save = async () => {
    setBusy("save");
    const r = await upsertMemberAction({ userId: member.userId, role, rooms, expiresAt: role === "guest" ? toIso(expiresAt) : null });
    setBusy(null);
    if (!r.ok) return void toast.error(errorText(t, r.error));
    toast.success(t("members.saved", { name: member.displayName }));
    router.refresh();
  };
  const remove = async () => {
    if (!window.confirm(t("members.removeConfirm", { name: member.displayName }))) return;
    setBusy("remove");
    const r = await removeMemberAction(member.userId);
    setBusy(null);
    if (!r.ok) return void toast.error(errorText(t, r.error));
    toast.success(t("members.removed", { name: member.displayName }));
    router.refresh();
  };
  const unbind = async (d: FamilyMemberView["devices"][number]) => {
    setBusy(d.id);
    const r = await bindDeviceAction({ deviceId: d.id, userId: null });
    setBusy(null);
    if (!r.ok) return void toast.error(errorText(t, r.error));
    toast.success(t("devices.unbound", { name: d.name }));
    router.refresh();
  };

  const initial = (member.displayName || member.email || "?").trim().charAt(0).toUpperCase();
  return (
    <li className="space-y-3 py-3 first:pt-0 last:pb-0">
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3">
        <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-[color-mix(in_oklch,var(--color-primary)_18%,transparent)] text-sm font-semibold text-[var(--color-primary)]">{initial}</span>
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 truncate text-sm font-semibold">{member.displayName}</span>
            {isMe && <Badge variant="info">{t("members.you")}</Badge>}
            {expired && <Badge variant="danger">{t("members.expired")}</Badge>}
          </div>
          <div className="min-w-0 truncate text-xs text-muted">{member.email}</div>
          <div className="min-w-0 truncate text-xs text-muted">{member.lastLoginAt ? t("members.lastLogin", { ago: ago(t, member.lastLoginAt) }) : t("members.neverLoggedIn")}</div>
        </div>
      </div>

      <div className="grid items-start gap-3 sm:grid-cols-2">
        <Field label={t("members.role")} hint={t(`roleHints.${role}`)}>
          <RoleSelect value={role} onChange={setRole} roles={FAMILY_ROLES} />
        </Field>
        {role === "guest" && (
          <Field label={t("members.expiresAt")} hint={t("members.expiresHint")}>
            <Input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          </Field>
        )}
      </div>

      {role !== "owner" ? (
        <div className="space-y-1.5">
          <span className="block text-xs text-muted">{t("members.rooms")}</span>
          <RoomGrantsEditor value={rooms} onChange={setRooms} />
        </div>
      ) : (
        <p className="text-xs text-muted">{t("members.allRooms")}</p>
      )}

      <div className="space-y-1.5">
        <span className="block text-xs text-muted">{t("devices.title")}</span>
        {member.devices.length === 0 ? (
          <p className="text-xs text-muted">{t("devices.none")}</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {member.devices.map((d) => (
              <li key={d.id} className="min-w-0 max-w-full">
                <Badge variant="muted" className="max-w-full gap-1 pr-1">
                  <DeviceIcon platform={d.platform} />
                  <span className="min-w-0 truncate">{d.name} · {d.platform}</span>
                  <button
                    type="button"
                    aria-label={t("devices.unbindAria", { name: d.name })}
                    title={t("devices.unbind")}
                    disabled={busy === d.id}
                    onClick={() => void unbind(d)}
                    className="grid size-4 shrink-0 place-items-center rounded-full hover:bg-[color-mix(in_oklch,var(--color-fg)_12%,transparent)] disabled:opacity-50"
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <Button size="sm" variant="ghost" className="shrink-0" aria-label={t("members.removeAria", { name: member.displayName })} disabled={isMe || busy !== null} onClick={() => void remove()}>
          {busy === "remove" ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
          {t("members.remove")}
        </Button>
        <Button size="sm" className="shrink-0" disabled={!dirty || busy !== null} onClick={() => void save()}>
          {busy === "save" ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          {t("members.save")}
        </Button>
      </div>
    </li>
  );
}

function RoleSelect<R extends FamilyRole>({ value, onChange, roles, disabled }: { value: R; onChange: (r: R) => void; roles: readonly R[]; disabled?: boolean }) {
  const t = useTranslations("family.roles");
  return (
    <Select value={value} onValueChange={(v) => onChange(v as R)} disabled={disabled}>
      <SelectTrigger aria-label={value}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {roles.map((r: FamilyRole) => (
          <SelectItem key={r} value={r}>{t(r)}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function DeviceIcon({ platform }: { platform: string }) {
  return /android|ios|iphone|ipad/i.test(platform) ? <Smartphone className="size-3 shrink-0" aria-hidden /> : <Laptop className="size-3 shrink-0" aria-hidden />;
}

function ago(t: T, iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return t("ago.now");
  if (s < 3600) return t("ago.minutes", { n: Math.round(s / 60) });
  if (s < 86400) return t("ago.hours", { n: Math.round(s / 3600) });
  return t("ago.days", { n: Math.round(s / 86400) });
}

function roomsSummary(t: T, rooms: ReturnType<typeof useTranslations<"home.rooms">>, grants: RoomGrants): string {
  const ids = ROOMS.filter((r) => grants[r.id]).map((r) => r.id);
  if (ids.length === 0) return t("members.roomsCount", { count: 0 });
  return ids.map((id) => `${rooms(id)} (${t(`level.${grants[id] ?? "view"}`)})`).join(", ");
}

// ---- invite by link

function InviteSection({ invites, origin }: { invites: FamilyInviteView[]; origin: string }) {
  const t = useTranslations("family");
  const rooms = useTranslations("home.rooms");
  const locale = useLocale();
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [role, setRole] = React.useState<InviteRole>("adult");
  const [grants, setGrants] = React.useState<RoomGrants>({});
  const [expiresAt, setExpiresAt] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [created, setCreated] = React.useState<{ url: string; expiresAt: string } | null>(null);
  const [qr, setQr] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!created) return void setQr(null);
    let alive = true;
    QRCode.toDataURL(created.url, { margin: 1, width: 192 })
      .then((d) => { if (alive) setQr(d); })
      .catch(() => { if (alive) setQr(null); });
    return () => { alive = false; };
  }, [created]);

  const fmtDate = (iso: string) => new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
  const daysLeft = (iso: string) => Math.max(0, Math.floor((new Date(iso).getTime() - Date.now()) / 86_400_000));

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy("create");
    const r = await createInviteAction({ name, role, rooms: grants, accessExpiresAt: role === "guest" ? toIso(expiresAt) : null });
    setBusy(null);
    if (!r.ok) return void toast.error(errorText(t, r.error));
    setCreated({ url: `${origin}/invite/${r.data.token}`, expiresAt: r.data.expiresAt });
    setCopied(false);
    setName("");
    toast.success(t("invite.created"));
    router.refresh();
  };
  const copy = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.url);
      setCopied(true);
      toast.success(t("invite.copied"));
    } catch {
      toast.error(t("invite.copyFailed"));
    }
  };
  const revoke = async (inv: FamilyInviteView) => {
    if (!window.confirm(t("invite.revokeConfirm", { name: inv.name }))) return;
    setBusy(inv.id);
    const r = await revokeInviteAction(inv.id);
    setBusy(null);
    if (!r.ok) return void toast.error(errorText(t, r.error));
    toast.success(t("invite.revoked"));
    router.refresh();
  };

  return (
    <Subsection title={t("invite.title")} hint={t("invite.hint")}>
      <form onSubmit={(e) => void create(e)} className="space-y-3">
        <div className="grid items-start gap-3 sm:grid-cols-2">
          <Field label={t("invite.name")}>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("invite.namePlaceholder")} maxLength={64} required />
          </Field>
          <Field label={t("members.role")} hint={t(`roleHints.${role}`)}>
            <RoleSelect value={role} onChange={setRole} roles={INVITE_ROLES} />
          </Field>
          {role === "guest" && (
            <Field label={t("members.expiresAt")} hint={t("members.expiresHint")} className="sm:col-span-2">
              <Input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
            </Field>
          )}
        </div>
        <div className="space-y-1.5">
          <span className="block text-xs text-muted">{t("members.rooms")}</span>
          <RoomGrantsEditor value={grants} onChange={setGrants} />
        </div>
        <div className="flex justify-end">
          <Button type="submit" size="sm" className="shrink-0" disabled={busy !== null || name.trim().length === 0}>
            {busy === "create" ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
            {t("invite.create")}
          </Button>
        </div>
      </form>

      {created && (
        <div className="grid items-start gap-3 rounded-lg border border-[color-mix(in_oklch,var(--color-success)_45%,var(--color-border))] bg-[color-mix(in_oklch,var(--color-success)_8%,transparent)] p-3 sm:grid-cols-[auto_minmax(0,1fr)]">
          {qr ? (
            <img src={qr} alt={t("invite.qrAlt")} width={192} height={192} className="mx-auto size-48 rounded-md bg-white p-1 sm:mx-0" />
          ) : (
            <div className="mx-auto size-48 animate-pulse rounded-md bg-[var(--color-bg-muted)] sm:mx-0" aria-hidden />
          )}
          <div className="min-w-0 space-y-2">
            <span className="block text-xs text-muted">{t("invite.link")}</span>
            <code className="block min-w-0 break-all rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-xs">{created.url}</code>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" variant="secondary" className="shrink-0" onClick={() => void copy()}>
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                {t("invite.copy")}
              </Button>
              <span className="min-w-0 break-words text-xs text-muted">{t("invite.linkExpires", { date: fmtDate(created.expiresAt) })}</span>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <span className="block text-xs text-muted">{t("invite.pending")}</span>
        {invites.length === 0 ? (
          <p className="text-xs text-muted">{t("invite.pendingEmpty")}</p>
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {invites.map((inv) => (
              <li key={inv.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 py-2">
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="min-w-0 truncate text-sm font-medium">{inv.name}</span>
                    <Badge variant="muted">{t(`roles.${inv.role}`)}</Badge>
                  </div>
                  <div className="min-w-0 break-words text-xs text-muted">{roomsSummary(t, rooms, inv.rooms)}</div>
                  <div className="min-w-0 break-words text-xs text-muted">
                    {[t("invite.expiresIn", { days: daysLeft(inv.expiresAt) }), inv.accessExpiresAt ? t("invite.accessUntil", { date: fmtDate(inv.accessExpiresAt) }) : null].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <Button size="sm" variant="ghost" className="shrink-0" aria-label={t("invite.revokeAria", { name: inv.name })} disabled={busy !== null} onClick={() => void revoke(inv)}>
                  {busy === inv.id ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                  <span className="hidden sm:inline">{t("invite.revoke")}</span>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Subsection>
  );
}

// ---- create account directly

function CreateAccountSection() {
  const t = useTranslations("family");
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [displayName, setDisplayName] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [role, setRole] = React.useState<InviteRole>("child");
  const [grants, setGrants] = React.useState<RoomGrants>({});
  const [expiresAt, setExpiresAt] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return void toast.error(t("errors.passwordShort"));
    setBusy(true);
    const r = await createMemberAccountAction({ email, displayName, password, role, rooms: grants, expiresAt: role === "guest" ? toIso(expiresAt) : null });
    setBusy(false);
    if (!r.ok) return void toast.error(errorText(t, r.error));
    toast.success(t("create.created", { name: displayName }));
    setEmail("");
    setDisplayName("");
    setPassword("");
    setShowPassword(false);
    setGrants({});
    setExpiresAt("");
    router.refresh();
  };

  return (
    <Subsection title={t("create.title")} hint={t("create.hint")}>
      <form onSubmit={(e) => void submit(e)} className="space-y-3">
        <div className="grid items-start gap-3 sm:grid-cols-2">
          <Field label={t("create.displayName")}>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="off" maxLength={80} required />
          </Field>
          <Field label={t("create.email")}>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" maxLength={200} required />
          </Field>
          <Field label={t("create.password")} hint={showPassword ? t("create.generatedNote") : t("create.passwordHint")}>
            <div className="flex min-w-0 gap-2">
              <Input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => { setPassword(e.target.value); setShowPassword(false); }}
                autoComplete="new-password"
                minLength={8}
                maxLength={200}
                required
                className={showPassword ? "font-mono" : undefined}
              />
              <Button type="button" size="sm" variant="secondary" className="h-9 shrink-0" onClick={() => { setPassword(generatePassword()); setShowPassword(true); }}>
                {t("create.generate")}
              </Button>
            </div>
          </Field>
          <Field label={t("members.role")} hint={t(`roleHints.${role}`)}>
            <RoleSelect value={role} onChange={setRole} roles={INVITE_ROLES} />
          </Field>
          {role === "guest" && (
            <Field label={t("members.expiresAt")} hint={t("members.expiresHint")} className="sm:col-span-2">
              <Input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
            </Field>
          )}
        </div>
        <div className="space-y-1.5">
          <span className="block text-xs text-muted">{t("members.rooms")}</span>
          <RoomGrantsEditor value={grants} onChange={setGrants} />
        </div>
        <div className="flex justify-end">
          <Button type="submit" size="sm" className="shrink-0" disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            {t("create.submit")}
          </Button>
        </div>
      </form>
    </Subsection>
  );
}

// ---- add existing user

function ExistingUserSection({ candidates }: { candidates: FamilyCandidate[] }) {
  const t = useTranslations("family");
  const router = useRouter();
  const [userId, setUserId] = React.useState("");
  const [role, setRole] = React.useState<FamilyRole>("adult");
  const [grants, setGrants] = React.useState<RoomGrants>({});
  const [expiresAt, setExpiresAt] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const c = candidates.find((x) => x.id === userId);
    if (!c) return;
    setBusy(true);
    const r = await upsertMemberAction({ userId, role, rooms: grants, expiresAt: role === "guest" ? toIso(expiresAt) : null });
    setBusy(false);
    if (!r.ok) return void toast.error(errorText(t, r.error));
    toast.success(t("existing.added", { name: c.displayName }));
    setUserId("");
    setGrants({});
    setExpiresAt("");
    router.refresh();
  };

  return (
    <Subsection title={t("existing.title")} hint={t("existing.hint")}>
      <form onSubmit={(e) => void submit(e)} className="space-y-3">
        <div className="grid items-start gap-3 sm:grid-cols-2">
          <Field label={t("existing.user")}>
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger aria-label={t("existing.user")}>
                <SelectValue placeholder={t("existing.pick")} />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.displayName} · {c.email}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("members.role")} hint={t(`roleHints.${role}`)}>
            <RoleSelect value={role} onChange={setRole} roles={FAMILY_ROLES} />
          </Field>
          {role === "guest" && (
            <Field label={t("members.expiresAt")} hint={t("members.expiresHint")} className="sm:col-span-2">
              <Input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
            </Field>
          )}
        </div>
        {role !== "owner" && (
          <div className="space-y-1.5">
            <span className="block text-xs text-muted">{t("members.rooms")}</span>
            <RoomGrantsEditor value={grants} onChange={setGrants} />
          </div>
        )}
        <div className="flex justify-end">
          <Button type="submit" size="sm" className="shrink-0" disabled={busy || !userId}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            {t("existing.add")}
          </Button>
        </div>
      </form>
    </Subsection>
  );
}
