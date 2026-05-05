"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { addAwsAccount, type AwsAccountFormState } from "@/server/actions/accounts";

const REGIONS = [
  "us-east-1", "us-east-2", "us-west-1", "us-west-2",
  "eu-west-1", "eu-west-2", "eu-west-3", "eu-central-1", "eu-north-1",
  "ap-northeast-1", "ap-southeast-1", "ap-southeast-2", "ap-south-1",
];

const initial: AwsAccountFormState = {};

export function AwsAccountForm() {
  const [state, action, pending] = useActionState(addAwsAccount, initial);
  const router = useRouter();

  useEffect(() => {
    if (state.ok && state.accountId) {
      toast.success("AWS account connected · syncing instances");
      router.push("/");
      router.refresh();
    } else if (state.error) {
      toast.error(state.error);
    }
  }, [state, router]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2 text-sm text-[var(--color-success)]">
          <ShieldCheck className="h-4 w-4" />
          Stored encrypted at rest
        </div>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          <Field label="Friendly name" name="name" placeholder="Personal AWS" error={state.fieldErrors?.name} />
          <Field
            label="Access Key ID"
            name="accessKeyId"
            placeholder="AKIA…"
            autoComplete="off"
            error={state.fieldErrors?.accessKeyId}
          />
          <Field
            label="Secret Access Key"
            name="secretAccessKey"
            type="password"
            autoComplete="off"
            error={state.fieldErrors?.secretAccessKey}
          />
          <Field
            label="Session token (optional)"
            name="sessionToken"
            type="password"
            autoComplete="off"
            description="Required when using temporary credentials (AWS SSO / STS)."
          />

          <div className="space-y-1.5">
            <Label htmlFor="defaultRegion">Default region</Label>
            <select
              id="defaultRegion"
              name="defaultRegion"
              defaultValue="us-east-1"
              className="flex h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[color-mix(in_oklch,var(--color-primary)_55%,transparent)]"
            >
              {REGIONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            {state.fieldErrors?.defaultRegion && (
              <p className="text-xs text-[var(--color-danger)]">{state.fieldErrors.defaultRegion}</p>
            )}
          </div>

          <Button type="submit" disabled={pending} className="w-full">
            {pending ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Verifying with AWS…</>
            ) : (
              "Verify & connect"
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  name,
  description,
  error,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; name: string; description?: string; error?: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} {...rest} />
      {description && <p className="text-xs text-muted">{description}</p>}
      {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
    </div>
  );
}
