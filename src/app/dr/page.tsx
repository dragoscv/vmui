import { ChaosButton } from "@/components/dr/chaos-button";

export const dynamic = "force-dynamic";

export default function DrPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">DR drill</h1>
        <p className="text-sm text-muted">
          Read-only verification that every running VM has a fresh backup policy, that provider credentials still work, and that GitOps sources are syncing. Click the button — it will not touch any infrastructure.
        </p>
      </header>
      <ChaosButton />
    </main>
  );
}
