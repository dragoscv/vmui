import "server-only";
import { db } from "@/lib/db";
import { cisCheckResults, cloudAccounts, instances, auditLog } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { sshExec } from "@/lib/ssh-exec";
import { decryptJSON } from "@/lib/crypto";
import type { ProbeKey } from "@/lib/probe";
import { nanoid } from "nanoid";

export interface CisCheckDef {
  id: string;
  title: string;
  /** Shell command. Exit 0 = pass, non-zero = fail. */
  command: string;
}

export const CIS_LINUX_CHECKS: CisCheckDef[] = [
  { id: "1.1.1.1", title: "Disable cramfs filesystem", command: "lsmod | grep -q cramfs && exit 1; exit 0" },
  { id: "1.1.21",  title: "/tmp on separate partition or tmpfs", command: "mount | awk '$3==\"/tmp\"{found=1} END{exit !found}'" },
  { id: "1.4.1",   title: "Bootloader config owned by root", command: "stat -c '%u %g' /boot/grub/grub.cfg 2>/dev/null | grep -q '^0 0$'" },
  { id: "1.5.1",   title: "Core dumps restricted (fs.suid_dumpable=0)", command: "[ \"$(sysctl -n fs.suid_dumpable 2>/dev/null)\" = \"0\" ]" },
  { id: "1.6.1",   title: "AppArmor or SELinux enforcing", command: "( aa-status --enabled 2>/dev/null && exit 0 ) || ( getenforce 2>/dev/null | grep -qi enforcing )" },
  { id: "3.1.1",   title: "IPv4 forwarding disabled", command: "[ \"$(sysctl -n net.ipv4.ip_forward 2>/dev/null)\" = \"0\" ]" },
  { id: "3.3.2",   title: "ICMP redirects ignored", command: "[ \"$(sysctl -n net.ipv4.conf.all.accept_redirects 2>/dev/null)\" = \"0\" ]" },
  { id: "4.2.1.1", title: "rsyslog or systemd-journald active", command: "systemctl is-active --quiet rsyslog || systemctl is-active --quiet systemd-journald" },
  { id: "5.2.2",   title: "SSH Protocol 2 only", command: "grep -E '^Protocol' /etc/ssh/sshd_config 2>/dev/null | grep -q '2' || ! grep -E '^Protocol' /etc/ssh/sshd_config 2>/dev/null" },
  { id: "5.2.5",   title: "SSH PermitRootLogin no", command: "grep -E '^PermitRootLogin\\s+no' /etc/ssh/sshd_config" },
  { id: "5.2.8",   title: "SSH PermitEmptyPasswords no", command: "! grep -E '^PermitEmptyPasswords\\s+yes' /etc/ssh/sshd_config" },
  { id: "5.4.1.1", title: "Password expiration <=365 days", command: "grep -E '^PASS_MAX_DAYS\\s+(3[0-6][0-5]|[12]?[0-9]?[0-9])$' /etc/login.defs" },
  { id: "6.2.1",   title: "/etc/passwd permissions 644", command: "stat -c '%a' /etc/passwd | grep -q '^644$'" },
  { id: "6.2.2",   title: "/etc/shadow permissions <=640", command: "stat -c '%a' /etc/shadow | grep -E '^(0|400|600|640)$'" },
];

export interface RunCisInput {
  accountId: string;
  providerInstanceId: string;
  user?: string;
}

export async function runCisChecks(input: RunCisInput): Promise<{ ok: number; fail: number; error: number; skip: number }> {
  const acc = await db.select().from(cloudAccounts).where(eq(cloudAccounts.id, input.accountId)).get();
  if (!acc?.probeKeyEnc) throw new Error("No probe key for account");
  const inst = await db.query.instances.findFirst({
    where: and(eq(instances.accountId, input.accountId), eq(instances.providerInstanceId, input.providerInstanceId)),
  });
  if (!inst) throw new Error("instance not found");
  if (inst.platform !== "linux") {
    return { ok: 0, fail: 0, error: 0, skip: CIS_LINUX_CHECKS.length };
  }
  const host = inst.publicIp ?? inst.privateIp;
  if (!host) throw new Error("instance has no IP");
  const key = decryptJSON<ProbeKey>(acc.probeKeyEnc);
  const user = input.user ?? key.defaultUser ?? "ubuntu";

  const stats = { ok: 0, fail: 0, error: 0, skip: 0 };
  for (const c of CIS_LINUX_CHECKS) {
    let result: "pass" | "fail" | "error" | "skip" = "error";
    let evidence: string | null = null;
    try {
      const r = await sshExec({ host, port: 22, user, key, command: c.command, timeoutMs: 8000 });
      result = r.code === 0 ? "pass" : "fail";
      const out = (r.stdout || r.stderr).slice(0, 300).trim();
      evidence = out || `exit ${r.code}`;
    } catch (e) {
      result = "error";
      evidence = e instanceof Error ? e.message.slice(0, 300) : "ssh error";
    }
    stats[result === "pass" ? "ok" : result === "fail" ? "fail" : result === "error" ? "error" : "skip"] += 1;
    await db.insert(cisCheckResults).values({
      id: nanoid(), accountId: input.accountId, providerInstanceId: input.providerInstanceId,
      checkId: c.id, title: c.title, result, evidence,
    });
  }
  await db.insert(auditLog).values({
    accountId: input.accountId, action: "cis.scan", target: input.providerInstanceId,
    status: "ok", message: `pass=${stats.ok} fail=${stats.fail} err=${stats.error}`,
  });
  return stats;
}
