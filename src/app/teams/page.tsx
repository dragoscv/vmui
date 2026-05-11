import { TeamsWorkspace } from "@/components/teams/teams-workspace";

export const dynamic = "force-dynamic";

export default function TeamsPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Teams</h1>
        <p className="text-sm text-muted">Group users, invite collaborators, and scope future per-team cloud accounts. Invitations are one-time tokens valid for 7 days.</p>
      </header>
      <TeamsWorkspace />
    </main>
  );
}
