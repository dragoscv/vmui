import { notFound } from "next/navigation";
import { getInstanceById } from "@/server/queries";
import { listSshKeys } from "@/server/queries/ssh-keys";
import { SshClient } from "@/components/instances/ssh-client";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function InstanceSshPage({ params }: PageProps) {
  const { id } = await params;
  const instance = await getInstanceById(decodeURIComponent(id));
  if (!instance) notFound();
  const keys = await listSshKeys();
  const savedKeys = keys.map((k) => ({
    id: k.id,
    name: k.name,
    algo: k.algo,
    hasPrivate: k.hasPrivateKey,
  }));
  return <SshClient instance={instance} savedKeys={savedKeys} />;
}
