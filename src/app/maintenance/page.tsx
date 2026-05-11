import "server-only";
import { db } from "@/lib/db";
import { cloudAccounts, maintenanceWindows } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { createMaintenanceWindowAction, deleteMaintenanceWindowAction } from "@/server/actions/maintenance";

export const dynamic = "force-dynamic";

export default async function MaintenancePage() {
  const [windows, accounts] = await Promise.all([
    db.select().from(maintenanceWindows).orderBy(desc(maintenanceWindows.startsAt)).limit(200),
    db.select({ id: cloudAccounts.id, name: cloudAccounts.name }).from(cloudAccounts),
  ]);
  const now = Date.now();

  async function create(formData: FormData) {
    "use server";
    await createMaintenanceWindowAction({
      name: String(formData.get("name") ?? ""),
      startsAt: String(formData.get("startsAt") ?? ""),
      endsAt: String(formData.get("endsAt") ?? ""),
      mode: (String(formData.get("mode") ?? "warn") as "warn" | "block"),
      accountId: (String(formData.get("accountId") ?? "")) || null,
      reason: String(formData.get("reason") ?? "") || null,
    });
  }
  async function remove(formData: FormData) {
    "use server";
    await deleteMaintenanceWindowAction(String(formData.get("id") ?? ""));
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Maintenance windows</h1>
        <p className="text-sm text-zinc-400">Block or warn for instance actions during a scheduled window.</p>
      </header>

      <form action={create} className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 grid grid-cols-1 md:grid-cols-3 gap-2 text-sm">
        <input name="name" placeholder="Name (e.g. Q4 patch night)" required className="rounded-md bg-zinc-900 border border-zinc-800 px-2 py-1 md:col-span-3" />
        <label className="text-xs text-zinc-400 flex flex-col gap-1">Starts at<input name="startsAt" type="datetime-local" required className="rounded-md bg-zinc-900 border border-zinc-800 px-2 py-1" /></label>
        <label className="text-xs text-zinc-400 flex flex-col gap-1">Ends at<input name="endsAt" type="datetime-local" required className="rounded-md bg-zinc-900 border border-zinc-800 px-2 py-1" /></label>
        <label className="text-xs text-zinc-400 flex flex-col gap-1">Mode
          <select name="mode" defaultValue="warn" className="rounded-md bg-zinc-900 border border-zinc-800 px-2 py-1">
            <option value="warn">Warn (log only)</option>
            <option value="block">Block (refuse mutations)</option>
          </select>
        </label>
        <label className="text-xs text-zinc-400 flex flex-col gap-1 md:col-span-2">Scope (optional)
          <select name="accountId" defaultValue="" className="rounded-md bg-zinc-900 border border-zinc-800 px-2 py-1">
            <option value="">Global (all accounts)</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <input name="reason" placeholder="Reason / notes" className="rounded-md bg-zinc-900 border border-zinc-800 px-2 py-1 md:col-span-1" />
        <div className="md:col-span-3 flex justify-end"><button className="rounded-md bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1 text-xs">Create window</button></div>
      </form>

      <section className="rounded-lg border border-zinc-800 bg-zinc-950 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-zinc-500"><tr>
            <th className="px-3 py-2 text-left">Name</th><th className="px-3 py-2 text-left">When</th><th className="px-3 py-2 text-left">Mode</th><th className="px-3 py-2 text-left">Scope</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2"></th>
          </tr></thead>
          <tbody>
            {windows.map((w) => {
              const active = w.startsAt.getTime() <= now && w.endsAt.getTime() >= now;
              const upcoming = w.startsAt.getTime() > now;
              const status = active ? "active" : upcoming ? "upcoming" : "past";
              const color = active ? "text-amber-400" : upcoming ? "text-blue-300" : "text-zinc-500";
              return (
                <tr key={w.id} className="border-t border-zinc-900">
                  <td className="px-3 py-2">{w.name}{w.reason && <div className="text-xs text-zinc-500">{w.reason}</div>}</td>
                  <td className="px-3 py-2 text-xs font-mono">{w.startsAt.toLocaleString()} → {w.endsAt.toLocaleString()}</td>
                  <td className="px-3 py-2"><span className={w.mode === "block" ? "text-rose-300" : "text-zinc-400"}>{w.mode}</span></td>
                  <td className="px-3 py-2 text-xs">{w.accountId ? accounts.find((a) => a.id === w.accountId)?.name ?? w.accountId : "global"}</td>
                  <td className={`px-3 py-2 text-xs ${color}`}>{status}</td>
                  <td className="px-3 py-2 text-right">
                    <form action={remove}><input type="hidden" name="id" value={w.id} /><button className="text-xs text-rose-300 hover:text-rose-200">Delete</button></form>
                  </td>
                </tr>
              );
            })}
            {windows.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-zinc-500 text-sm">No windows defined.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
