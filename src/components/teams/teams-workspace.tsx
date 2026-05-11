"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Users, UserPlus, X, Copy, Loader2 } from "lucide-react";
import { createTeamAction, listMyTeamsAction, inviteToTeamAction, removeMemberAction } from "@/server/actions/teams";

const INPUT_CLS = "rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1";

interface Team {
  id: string;
  name: string;
  slug: string;
  members: Array<{ userId: string; email: string; displayName: string; role: string; joinedAt: Date }>;
  invitations: Array<{ id: string; email: string; role: string; expiresAt: Date; accepted: boolean }>;
}

export function TeamsWorkspace() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [newName, setNewName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [pending, start] = useTransition();

  const reload = () => start(async () => setTeams((await listMyTeamsAction()) as Team[]));
  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  return (
    <div className="grid gap-6 text-sm">
      <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Create new team</h2>
        <div className="flex flex-wrap gap-2 text-xs">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Team name" className={INPUT_CLS} />
          <input value={newSlug} onChange={(e) => setNewSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} placeholder="slug-here" className={`${INPUT_CLS} font-mono`} />
          <button
            type="button"
            disabled={pending || !newName || !newSlug}
            onClick={() => start(async () => {
              const r = await createTeamAction({ name: newName, slug: newSlug });
              if (r.ok) { toast.success("Team created"); setNewName(""); setNewSlug(""); reload(); }
              else toast.error(r.error);
            })}
            className="inline-flex items-center gap-1 rounded-md bg-[var(--color-primary)] px-3 py-1 font-semibold text-[var(--color-primary-fg)] disabled:opacity-40"
          >
            <Users className="h-3 w-3" /> Create
          </button>
        </div>
      </section>

      {pending && teams.length === 0 ? <Loader2 className="h-4 w-4 animate-spin" /> : null}

      {teams.map((t) => <TeamCard key={t.id} team={t} onChange={reload} />)}
    </div>
  );
}

function TeamCard({ team, onChange }: { team: Team; onChange: () => void }) {
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "operator" | "viewer" | "member">("member");
  const [token, setToken] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <article className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <header className="mb-3 flex items-baseline justify-between">
        <h3 className="text-lg font-semibold">{team.name} <span className="ml-2 font-mono text-xs text-muted">{team.slug}</span></h3>
      </header>

      <h4 className="mb-1 text-[10px] uppercase tracking-wide text-muted">Members ({team.members.length})</h4>
      <ul className="mb-3 space-y-1 text-xs">
        {team.members.map((m) => (
          <li key={m.userId} className="flex items-center gap-2 rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1">
            <span className="font-semibold">{m.displayName}</span>
            <span className="text-muted">{m.email}</span>
            <span className="ml-auto rounded-full bg-[var(--color-primary)]/15 px-2 py-0.5 text-[10px] uppercase text-[var(--color-primary)]">{m.role}</span>
            {m.role !== "owner" ? (
              <button
                type="button"
                onClick={() => start(async () => { await removeMemberAction({ teamId: team.id, userId: m.userId }); onChange(); })}
                className="ml-2 text-rose-300 hover:text-rose-200"
                aria-label="Remove member"
              >
                <X className="h-3 w-3" />
              </button>
            ) : null}
          </li>
        ))}
      </ul>

      <h4 className="mb-1 text-[10px] uppercase tracking-wide text-muted">Pending invitations</h4>
      <ul className="mb-3 space-y-1 text-xs">
        {team.invitations.filter((i) => !i.accepted).length === 0 ? <li className="text-muted">none</li> : null}
        {team.invitations.filter((i) => !i.accepted).map((i) => (
          <li key={i.id} className="flex items-center gap-2 rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1">
            <span>{i.email}</span>
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] uppercase text-amber-300">{i.role}</span>
            <span className="ml-auto text-[10px] text-muted">expires {new Date(i.expiresAt).toLocaleDateString()}</span>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-end gap-2 text-xs">
        <input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="email@example.com" className={INPUT_CLS} />
        <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as typeof inviteRole)} className={INPUT_CLS}>
          <option value="member">member</option>
          <option value="viewer">viewer</option>
          <option value="operator">operator</option>
          <option value="admin">admin</option>
        </select>
        <button
          type="button"
          disabled={pending || !inviteEmail}
          onClick={() => start(async () => {
            const r = await inviteToTeamAction({ teamId: team.id, email: inviteEmail, role: inviteRole });
            if (r.ok) { setToken(r.token); setInviteEmail(""); toast.success("Invitation created"); onChange(); }
            else toast.error(r.error);
          })}
          className="inline-flex items-center gap-1 rounded-md bg-[var(--color-primary)] px-3 py-1 font-semibold text-[var(--color-primary-fg)] disabled:opacity-40"
        >
          <UserPlus className="h-3 w-3" /> Invite
        </button>
      </div>

      {token ? (
        <div className="mt-2 rounded border border-amber-500/40 bg-amber-500/5 p-2 text-xs">
          <p className="mb-1 font-semibold text-amber-200">Share this URL with the invitee (token is shown once):</p>
          <div className="flex items-center gap-2 font-mono text-[11px]">
            <input readOnly value={`/teams/accept?token=${token}`} className={`${INPUT_CLS} flex-1`} />
            <button
              type="button"
              onClick={() => { void navigator.clipboard.writeText(`/teams/accept?token=${token}`); toast.success("Copied"); }}
              className="inline-flex items-center gap-1 rounded border border-[var(--color-border)] px-2 py-1"
            >
              <Copy className="h-3 w-3" />
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}
