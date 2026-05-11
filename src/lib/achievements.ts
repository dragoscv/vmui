import "server-only";
import { db } from "@/lib/db";
import { auditLog, instances, backupJobs, snapshotHistory } from "@/lib/db/schema";
import { sql, eq, gte } from "drizzle-orm";

export interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  progress: number;
  goal: number;
  unlocked: boolean;
}

export interface Streak {
  current: number;
  longest: number;
  lastActiveDay: string | null;
}

export async function computeAchievements(): Promise<{ achievements: Achievement[]; streak: Streak; totalActions: number }> {
  const totalActions = db.select({ c: sql<number>`count(*)` }).from(auditLog).get()?.c ?? 0;
  const totalSnaps = db.select({ c: sql<number>`count(*)` }).from(snapshotHistory).get()?.c ?? 0;
  const totalBackups = db.select({ c: sql<number>`count(*)` }).from(backupJobs).where(eq(backupJobs.status, "ok")).get()?.c ?? 0;
  const totalVms = db.select({ c: sql<number>`count(*)` }).from(instances).get()?.c ?? 0;
  const providers = db
    .selectDistinct({ p: instances.provider })
    .from(instances)
    .all()
    .map((r) => r.p);

  const restoreCount = db
    .select({ c: sql<number>`count(*)` })
    .from(auditLog)
    .where(eq(auditLog.action, "restore.from_snapshot"))
    .get()?.c ?? 0;

  const aiCount = db.select({ c: sql<number>`count(*)` }).from(auditLog).where(eq(auditLog.action, "ai.chat")).get()?.c ?? 0;

  const recent = db
    .select({ d: sql<string>`strftime('%Y-%m-%d', created_at, 'unixepoch')` })
    .from(auditLog)
    .where(gte(auditLog.createdAt, new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)))
    .all();
  const days = Array.from(new Set(recent.map((r) => r.d))).sort();

  let current = 0;
  let longest = 0;
  let prev: string | null = null;
  for (const d of days) {
    if (prev) {
      const diff = (Date.parse(d) - Date.parse(prev)) / 86_400_000;
      if (diff === 1) current += 1;
      else current = 1;
    } else current = 1;
    if (current > longest) longest = current;
    prev = d;
  }
  const today = new Date().toISOString().slice(0, 10);
  const lastActive = days[days.length - 1] ?? null;
  if (lastActive && lastActive !== today) {
    const gap = (Date.parse(today) - Date.parse(lastActive)) / 86_400_000;
    if (gap > 1) current = 0;
  }

  const achievements: Achievement[] = [
    { id: "first-vm", title: "First Light", description: "Provision your first VM", icon: "Rocket", progress: Math.min(totalVms, 1), goal: 1, unlocked: totalVms >= 1 },
    { id: "fleet-builder", title: "Fleet Builder", description: "Run 10 VMs", icon: "Boxes", progress: Math.min(totalVms, 10), goal: 10, unlocked: totalVms >= 10 },
    { id: "snap-happy", title: "Snap Happy", description: "Take 25 snapshots", icon: "Camera", progress: Math.min(totalSnaps, 25), goal: 25, unlocked: totalSnaps >= 25 },
    { id: "backup-believer", title: "Backup Believer", description: "Complete 5 successful backup jobs", icon: "Archive", progress: Math.min(totalBackups, 5), goal: 5, unlocked: totalBackups >= 5 },
    { id: "restore-hero", title: "Restore Hero", description: "Restore a VM from a snapshot", icon: "RotateCcw", progress: Math.min(restoreCount, 1), goal: 1, unlocked: restoreCount >= 1 },
    { id: "polyglot", title: "Polyglot", description: "Run VMs on 3 different clouds", icon: "Globe", progress: Math.min(providers.length, 3), goal: 3, unlocked: providers.length >= 3 },
    { id: "ai-curious", title: "AI Curious", description: "Have a chat with the AI agent", icon: "Bot", progress: Math.min(aiCount, 1), goal: 1, unlocked: aiCount >= 1 },
    { id: "centurion", title: "Centurion", description: "Reach 100 audited actions", icon: "Award", progress: Math.min(totalActions, 100), goal: 100, unlocked: totalActions >= 100 },
    { id: "streak-7", title: "On a Roll", description: "7-day activity streak", icon: "Flame", progress: Math.min(longest, 7), goal: 7, unlocked: longest >= 7 },
    { id: "streak-30", title: "Daily Driver", description: "30-day activity streak", icon: "Flame", progress: Math.min(longest, 30), goal: 30, unlocked: longest >= 30 },
  ];

  return {
    achievements,
    streak: { current, longest, lastActiveDay: lastActive },
    totalActions,
  };
}
