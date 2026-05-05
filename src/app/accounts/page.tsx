import Link from "next/link";
import { Plus, KeyRound } from "lucide-react";
import { listAccounts } from "@/server/queries";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DeleteAccountButton } from "@/components/accounts/delete-account-button";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const accounts = await listAccounts();
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
                    <CardTitle>{a.name}</CardTitle>
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
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
