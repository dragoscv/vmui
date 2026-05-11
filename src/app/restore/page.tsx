import { RestoreWizard } from "@/components/restore/restore-wizard";

export const dynamic = "force-dynamic";

export default function RestorePage() {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Restore</h1>
        <p className="text-sm text-muted">
          Launch a new VM from a successful backup. Cross-cloud migration: pick any account, any region — vmui will hand the snapshot id to the provider and call createInstance.
        </p>
      </header>
      <RestoreWizard />
    </main>
  );
}
