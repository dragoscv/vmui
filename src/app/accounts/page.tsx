import Link from "next/link";
import { Plus, KeyRound, TrendingUp } from "lucide-react";
import { listAccounts } from "@/server/queries";
import { listAccountHistory } from "@/server/queries/history";
import { summarizeAccountHealth } from "@/server/queries/account-health";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkline } from "@/components/ui/sparkline";
import { DeleteAccountButton } from "@/components/accounts/delete-account-button";
import { AccountRegionsEditor } from "@/components/accounts/account-regions-editor";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const accounts = await listAccounts();
  const healthMap = await summarizeAccountHealth();
  const histories = await Promise.all(
    accounts.map(async (a) => {
      const rows = await listAccountHistory(a.id);
      // listAccountHistory returns desc; reverse to oldest-first for the sparkline.
      const ordered = rows.slice().reverse();
      return {
        accountId: a.id,
        runningSeries: ordered.map((r) => r.runningInstances),
        hourlySeries: ordered.map((r) => r.hourlyUsd),
      };
    }),
  );
  const histMap = new Map(histories.map((h) => [h.accountId, h]));
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Cloud accounts</h1>
          <p className="text-sm text-muted">Add accounts to manage their resources from vmui.</p>
        </div>
        <Button asChild>
          <Link href="/accounts/new">
            <Plus className="h-4 w-4" /> Add account
          </Link>
        </Button>
      </div>

      {accounts.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <KeyRound className="mx-auto mb-3 h-8 w-8 text-muted" />
            <p className="text-muted">No accounts connected yet.</p>
            <Button asChild className="mt-4">
              <Link href="/accounts/new">Connect your first account</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {accounts.map((a) => (
            <Card key={a.id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle>
                      <Link href={`/accounts/${encodeURIComponent(a.id)}`} className="hover:underline">
                        {a.name}
                      </Link>
                    </CardTitle>
                    <CardDescription className="mt-1">
                      {a.meta?.label ?? a.meta?.accountId ?? "—"}
                    </CardDescription>
                  </div>
                  <Badge variant="info">{a.provider.toUpperCase()}</Badge>
                </div>
              </CardHeader>
              <CardContent className="flex items-center justify-between">
                <div className="text-xs text-muted">
                  <div>region: {a.defaultRegion ?? "—"}</div>
                  {a.meta?.accountId && <div>account: {a.meta.accountId}</div>}
                </div>
                <DeleteAccountButton id={a.id} name={a.name} />
              </CardContent>
              {(() => {
                const h = healthMap.get(a.id);
                if (!h) return null;
                const variant = h.health === "ok" ? "success" : h.health === "warn" ? "warning" : "danger";
                const label =
                  h.health === "ok" ? "healthy" : h.health === "warn" ? "needs attention" : "unhealthy";
                return (
                  <CardContent className="pt-0">
                    <div className="flex items-center justify-between rounded border border-[var(--color-border)] bg-[var(--color-bg)]/40 px-3 py-2 text-xs">
                      <Badge variant={variant}>{label}</Badge>
                      <span className="text-muted truncate ml-2" title={h.reasons.join(" · ")}>
                        {h.reasons.length === 0 ? "all signals green" : h.reasons.join(" · ")}
                      </span>
                    </div>
                  </CardContent>
                );
              })()}
              {(() => {
                const h = histMap.get(a.id);
                if (!h || h.runningSeries.length < 2) return null;
                return (
                  <CardContent className="pt-0">
                    <div className="flex items-center justify-between rounded border border-[var(--color-border)] bg-[var(--color-bg)]/40 px-3 py-2">
                      <div className="flex items-center gap-1.5 text-[11px] text-muted">
                        <TrendingUp className="h-3 w-3" /> 7-day running VMs
                      </div>
                      <Sparkline
                        values={h.runningSeries}
                        ariaLabel={`Running VMs over time for ${a.name}`}
                        className="text-[var(--color-success)]"
                      />
                    </div>
                  </CardContent>
                );
              })()}
              <CardContent className="pt-0">
                <AccountRegionsEditor
                  accountId={a.id}
                  provider={a.provider}
                  defaultRegion={a.defaultRegion}
                  initialRegions={a.regions}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
