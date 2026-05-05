import { notFound } from "next/navigation";
import { getInstanceById } from "@/server/queries";
import { VncConsoleClient } from "@/components/instances/vnc-console-client";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function InstanceConsolePage({ params }: PageProps) {
  const { id } = await params;
  const instance = await getInstanceById(decodeURIComponent(id));
  if (!instance) notFound();
  if (instance.provider !== "local-kvm") {
    return (
      <div className="rounded-md border border-[var(--color-border)] p-6 text-sm">
        In-browser console is currently only available for{" "}
        <span className="font-medium">Local · KVM</span> instances.
      </div>
    );
  }

  return (
    <VncConsoleClient
      accountId={instance.accountId}
      region={instance.region}
      providerInstanceId={instance.providerInstanceId}
      instanceName={instance.name ?? instance.providerInstanceId}
    />
  );
}
