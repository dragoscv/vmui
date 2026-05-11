import { db } from "@/lib/db";
import { sshKeys, instances, cloudAccounts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { KeyRotationView } from "@/components/key-rotation/key-rotation-view";
import { KeyRound } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function KeyRotationPage() {
  const keys = await db.select().from(sshKeys);
  const insts = await db.select().from(instances).where(eq(instances.state, "running"));
  const accs = await db.select().from(cloudAccounts);
  const accLabel = new Map(accs.map((a) => [a.id, a.name]));

  const vmList = insts.map((i) => ({
    id: i.id,
    name: i.name ?? i.providerInstanceId,
    region: i.region,
    publicIp: i.publicIp,
    accountLabel: accLabel.get(i.accountId) ?? i.accountId,
  }));
  const keyList = keys.map((k) => ({ id: k.id, name: k.name, algo: k.algo, fingerprint: k.fingerprint }));

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 sm:p-6">
      <header className="flex items-center gap-3">
        <KeyRound className="h-6 w-6 text-[var(--color-primary)]" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">SSH key rotation</h1>
          <p className="text-sm text-muted">Push a new public key to every selected VM. Requires probe key configured on the account.</p>
        </div>
      </header>
      {keys.length === 0 ? (
        <p className="text-sm text-muted">No SSH keys configured. Add one in Settings → SSH keys first.</p>
      ) : (
        <KeyRotationView keys={keyList} instances={vmList} />
      )}
    </main>
  );
}
