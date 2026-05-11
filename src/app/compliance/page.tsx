import "server-only";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { scanCompliance } from "@/server/queries/compliance";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ComplianceFixButton } from "@/components/compliance/compliance-fix-button";

const SEVERITY_VARIANT: Record<string, "danger" | "warning" | "info" | "muted"> = {
  critical: "danger",
  high: "warning",
  medium: "info",
  low: "muted",
};

export const dynamic = "force-dynamic";

export default async function CompliancePage() {
  const findings = await scanCompliance();
  const counts = {
    critical: findings.filter((f) => f.severity === "critical").length,
    high: findings.filter((f) => f.severity === "high").length,
    medium: findings.filter((f) => f.severity === "medium").length,
    low: findings.filter((f) => f.severity === "low").length,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <ShieldAlert className="h-6 w-6 text-[var(--color-primary)]" />
          Compliance
        </h1>
        <p className="text-sm text-muted">
          Static checks over cached resources. Run a sync to refresh. No outbound API calls beyond a normal sync.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        {(["critical", "high", "medium", "low"] as const).map((sev) => (
          <Card key={sev} className="surface">
            <CardContent className="py-4">
              <div className="text-xs uppercase tracking-wide text-muted">{sev}</div>
              <div className="text-2xl font-semibold">{counts[sev]}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="surface">
        <CardHeader>
          <CardTitle className="text-base">Findings</CardTitle>
        </CardHeader>
        <CardContent>
          {findings.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-muted">
              <ShieldCheck className="h-4 w-4 text-[var(--color-success)]" />
              All clean — nothing to flag.
            </div>
          ) : (
            <div className="grid gap-2">
              {findings.map((f) => (
                <div
                  key={f.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded border border-[var(--color-border)] bg-[var(--color-bg)]/40 px-3 py-2"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <Badge variant={SEVERITY_VARIANT[f.severity]}>{f.severity.toUpperCase()}</Badge>
                      <span className="text-sm font-medium">{f.message}</span>
                    </div>
                    <div className="text-xs text-muted">
                      {f.provider.toUpperCase()} · {f.accountName} · {f.region} · {f.resourceKind} · {f.resourceName}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {f.provider === "aws" && (f.kind === "ssh-open-world" || f.kind === "rdp-open-world") && (
                      <ComplianceFixButton
                        accountId={f.accountId}
                        groupId={f.externalId}
                        port={f.kind === "ssh-open-world" ? 22 : 3389}
                        label={f.kind === "ssh-open-world" ? "SSH" : "RDP"}
                      />
                    )}
                    <code className="font-mono text-[11px] text-muted">{f.externalId}</code>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
