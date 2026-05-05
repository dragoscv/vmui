"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Server, Apple, MonitorSmartphone, AlertTriangle } from "lucide-react";
import { motion } from "motion/react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { InstanceTemplate, ProviderId } from "@/lib/providers/types";
import { createInstanceAction, type CreateInstanceState } from "@/server/actions/instances";

const initial: CreateInstanceState = {};

export function CreateInstanceForm({
  accounts,
  templatesByProvider,
  regionsByProvider,
}: {
  accounts: { id: string; name: string; provider: string; defaultRegion: string | null }[];
  templatesByProvider: Record<ProviderId, InstanceTemplate[]>;
  regionsByProvider: Record<ProviderId, string[]>;
}) {
  const [state, action, pending] = useActionState(createInstanceAction, initial);
  const router = useRouter();

  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const account = accounts.find((a) => a.id === accountId);
  const providerId = (account?.provider ?? "aws") as ProviderId;

  const templates = templatesByProvider[providerId] ?? [];
  const regions = regionsByProvider[providerId] ?? [];

  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const template = useMemo(() => templates.find((t) => t.id === templateId), [templates, templateId]);
  const [instanceType, setInstanceType] = useState(template?.recommendedTypes[0] ?? "");
  const [region, setRegion] = useState(account?.defaultRegion ?? regions[0] ?? "");

  // When the user switches account → provider may change → reset template/region/type
  useEffect(() => {
    const newTpl = templatesByProvider[providerId]?.[0];
    if (newTpl && newTpl.id !== templateId) setTemplateId(newTpl.id);
    const newRegions = regionsByProvider[providerId] ?? [];
    if (account?.defaultRegion && newRegions.includes(account.defaultRegion)) {
      setRegion(account.defaultRegion);
    } else if (newRegions.length > 0 && !newRegions.includes(region)) {
      setRegion(newRegions[0] ?? "");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  useEffect(() => {
    if (template && !template.recommendedTypes.includes(instanceType)) {
      setInstanceType(template.recommendedTypes[0] ?? "");
    }
  }, [template, instanceType]);

  useEffect(() => {
    if (state.ok && state.instanceId) {
      toast.success("Instance launched");
      router.push("/");
      router.refresh();
    } else if (state.error) {
      toast.error(state.error);
    }
  }, [state, router]);

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="accountId" value={accountId} />
      <input type="hidden" name="region" value={region} />
      <input type="hidden" name="template" value={templateId} />
      <input type="hidden" name="instanceType" value={instanceType} />

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted">Account &amp; region</h2>
        <Card>
          <CardContent className="grid gap-4 p-5 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Account</Label>
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="flex h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name} ({a.provider})</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>{providerId === "scaleway" ? "Zone" : "Region"}</Label>
              <select
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                className="flex h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
              >
                {regions.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted">Template</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {templates.map((t) => {
            const Icon = t.platform === "macos" ? Apple : t.platform === "windows" ? MonitorSmartphone : Server;
            const active = t.id === templateId;
            return (
              <motion.button
                type="button"
                key={t.id}
                onClick={() => setTemplateId(t.id)}
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.99 }}
                className={cn(
                  "surface relative flex flex-col items-start gap-2 p-4 text-left transition-all",
                  active && "border-[color-mix(in_oklch,var(--color-primary)_60%,var(--color-border))] shadow-[var(--shadow-glow)]",
                )}
              >
                <div className="flex w-full items-start justify-between">
                  <div className="grid h-9 w-9 place-items-center rounded-[var(--radius-md)] bg-[var(--color-bg-muted)]">
                    <Icon className="h-4 w-4" />
                  </div>
                  {active && <span className="text-xs font-medium text-[var(--color-primary)]">Selected</span>}
                </div>
                <div>
                  <div className="font-semibold">{t.label}</div>
                  <div className="mt-1 text-xs text-muted">{t.description}</div>
                </div>
              </motion.button>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted">Size</h2>
        <Card>
          <CardContent className="space-y-4 p-5">
            <div className="flex flex-wrap gap-2">
              {(template?.recommendedTypes ?? []).map((it) => (
                <button
                  type="button"
                  key={it}
                  onClick={() => setInstanceType(it)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-mono transition-all",
                    it === instanceType
                      ? "border-[var(--color-primary)] bg-[color-mix(in_oklch,var(--color-primary)_18%,transparent)] text-[var(--color-primary)]"
                      : "border-[var(--color-border)] hover:border-[color-mix(in_oklch,var(--color-primary)_50%,var(--color-border))]",
                  )}
                >
                  {it}
                </button>
              ))}
            </div>
            {template?.notes && template.notes.length > 0 && (
              <div className="flex gap-2 rounded-md bg-[color-mix(in_oklch,var(--color-warning)_15%,transparent)] p-3 text-xs text-[oklch(0.5_0.16_75)] dark:text-[var(--color-warning)]">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <ul className="space-y-1">
                  {template.notes.map((n, i) => <li key={i}>{n}</li>)}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted">Details</h2>
        <Card>
          <CardContent className="grid gap-4 p-5 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" placeholder="my-mac-builder" required />
              <p className="text-xs text-muted">Becomes the instance's <code>Name</code> tag in AWS.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="keyName">SSH key pair name (existing)</Label>
              <Input id="keyName" name="keyName" placeholder="my-key" />
              <p className="text-xs text-muted">
                Name of an EC2 key pair you already created in this region (EC2 → Key Pairs). Required for SSH/Windows
                password retrieval. Leave empty if you only need the AWS console.
              </p>
            </div>
          </CardContent>
        </Card>
      </section>

      <div className="flex items-start gap-2 rounded-md bg-[var(--color-bg-muted)] p-3 text-xs text-muted">
        <AlertTriangle className="h-4 w-4 shrink-0 text-[var(--color-warning)]" />
        <div>
          <strong className="text-[var(--color-fg)]">What happens next:</strong> vmui calls{" "}
          <code>RunInstances</code> on AWS, tags the resource <code>vmui:managed=true</code>, and starts polling. For
          macOS, a Dedicated Host is allocated first if none is available (24-hour minimum billing).
        </div>
      </div>

      <Button type="submit" disabled={pending} size="lg" className="w-full">
        {pending ? <><Loader2 className="h-4 w-4 animate-spin" /> Launching…</> : "Launch instance"}
      </Button>
    </form>
  );
}
