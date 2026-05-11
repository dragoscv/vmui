"use server";
import "server-only";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { cloudAccounts, instances, sshKeys, auditLog } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { sshExec } from "@/lib/ssh-exec";
import { decryptJSON } from "@/lib/crypto";
import type { ProbeKey } from "@/lib/probe";
import { requireRole } from "@/lib/auth";

const rotateSchema = z.object({
  newKeyId: z.string().min(1),
  instanceIds: z.array(z.string()).min(1),
  user: z.string().default("root"),
});

export interface RotateResult {
  ok: boolean;
  rotated: string[];
  failed: { instanceId: string; error: string }[];
}

/**
 * Append a new authorized public key to each selected VM, then remove all
 * other keys whose comment starts with `# vmui-managed`. Old key copy is
 * archived to `~/.ssh/authorized_keys.vmui.bak` first.
 */
export async function rotateSshKeyAction(input: z.input<typeof rotateSchema>): Promise<RotateResult> {
  await requireRole("admin");
  const d = rotateSchema.parse(input);

  const newKey = (await db.select().from(sshKeys).where(eq(sshKeys.id, d.newKeyId)).limit(1))[0];
  if (!newKey) throw new Error("Key not found");

  const targets = await db.select().from(instances).where(inArray(instances.id, d.instanceIds));
  const rotated: string[] = [];
  const failed: { instanceId: string; error: string }[] = [];

  for (const inst of targets) {
    try {
      const acc = (await db.select().from(cloudAccounts).where(eq(cloudAccounts.id, inst.accountId)).limit(1))[0];
      if (!acc?.probeKeyEnc) throw new Error("No probe key configured for this account");
      if (!inst.publicIp) throw new Error("VM has no public IP");
      const probeKey = decryptJSON<ProbeKey>(acc.probeKeyEnc);
      const user = d.user || probeKey.defaultUser || "root";
      const tagged = `${newKey.publicKey.trim()} # vmui-managed ${newKey.id}`;
      const script = `set -e
mkdir -p ~/.ssh && chmod 700 ~/.ssh
touch ~/.ssh/authorized_keys
cp ~/.ssh/authorized_keys ~/.ssh/authorized_keys.vmui.bak.$(date +%s)
grep -v '# vmui-managed' ~/.ssh/authorized_keys > ~/.ssh/authorized_keys.tmp || true
echo '${tagged.replace(/'/g, "'\\''")}' >> ~/.ssh/authorized_keys.tmp
mv ~/.ssh/authorized_keys.tmp ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys`;
      const result = await sshExec({
        host: inst.publicIp,
        port: 22,
        user,
        key: probeKey,
        command: script,
        timeoutMs: 30_000,
      });
      if (result.code !== 0) throw new Error(`exit ${result.code}: ${result.stderr.slice(0, 200)}`);
      rotated.push(inst.id);
      await db.insert(auditLog).values({
        accountId: inst.accountId,
        action: "ssh.key.rotate",
        target: inst.providerInstanceId,
        status: "ok",
        message: `Rotated to ${newKey.name}`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message.slice(0, 300) : "rotate failed";
      failed.push({ instanceId: inst.id, error: msg });
      await db.insert(auditLog).values({
        accountId: inst.accountId,
        action: "ssh.key.rotate",
        target: inst.providerInstanceId,
        status: "error",
        message: msg,
      });
    }
  }

  revalidatePath("/key-rotation");
  return { ok: failed.length === 0, rotated, failed };
}
