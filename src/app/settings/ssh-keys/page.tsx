import { Key } from "lucide-react";
import { listSshKeys } from "@/server/queries/ssh-keys";
import { SshKeyComposer } from "@/components/settings/ssh-key-composer";
import { SshKeyList } from "@/components/settings/ssh-key-list";
import { SshConfigExport } from "@/components/settings/ssh-config-export";
import { listInstances } from "@/server/queries";

export const dynamic = "force-dynamic";

export default async function SshKeysPage() {
  const [keys, vms] = await Promise.all([listSshKeys(), listInstances()]);
  const reachable = vms.filter((v) => v.publicIp || v.publicDns);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Key className="h-6 w-6 text-[var(--color-primary)]" />
          SSH keys
        </h1>
        <p className="text-sm text-muted">
          Stored locally in <code>vmui.db</code>, encrypted with your master key. Inject the public half at create-time
          for Azure / GCP / Scaleway VMs; AWS uses provider-side keypairs.
        </p>
      </div>
      <SshKeyComposer />
      <SshKeyList keys={keys} />
      <SshConfigExport
        instances={reachable.map((v) => ({
          id: v.id,
          host: v.displayName ?? v.name ?? v.providerInstanceId,
          provider: v.provider,
          ip: v.publicIp ?? v.publicDns ?? "",
          keyName: v.keyName,
          platform: v.platform,
        }))}
      />
    </div>
  );
}
