import { listInstances } from "@/server/queries";
import { SecretsWorkspace } from "@/components/secrets/secrets-workspace";

export const dynamic = "force-dynamic";

export default async function SecretsPage() {
  const all = await listInstances();
  const reachable = all
    .filter((i) => i.state === "running" && (i.publicIp || i.publicDns))
    .map((i) => ({
      id: i.id,
      name: i.name,
      providerInstanceId: i.providerInstanceId,
      provider: i.provider,
    }));

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Secrets</h1>
        <p className="text-sm text-muted">
          AES-256-GCM-encrypted secrets with rotation reminders, audit log, push-to-VM as .env, and sealed scrypt-encrypted export.
        </p>
      </header>
      <SecretsWorkspace instances={reachable} />
    </main>
  );
}
