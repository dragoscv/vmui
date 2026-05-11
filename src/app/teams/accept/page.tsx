import { acceptInvitationAction } from "@/server/actions/teams";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AcceptInvitationPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (!token) return <main className="p-6"><p className="text-rose-300">Missing token.</p></main>;
  const user = await getCurrentUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(`/teams/accept?token=${token}`)}`);
  const r = await acceptInvitationAction({ token });
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-3 p-6 text-sm">
      {r.ok ? (
        <>
          <h1 className="text-xl font-semibold text-emerald-300">Joined team!</h1>
          <a href="/teams" className="underline">Go to teams →</a>
        </>
      ) : (
        <>
          <h1 className="text-xl font-semibold text-rose-300">Could not accept</h1>
          <p>{r.error}</p>
        </>
      )}
    </main>
  );
}
