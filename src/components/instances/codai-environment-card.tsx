"use client";

import { Alert, Badge, Button, Field, Input, PageSection } from "@/components/ui";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAction } from "@/hooks/use-action";
import { ok } from "@/lib/action-result";
import type { CodaiProject } from "@/lib/codai/client";
import { hubProjectUrl } from "@/lib/codai/install-command";
import type { ProvisionEvent } from "@/lib/codai/provision";
import {
  listCodaiProjectsAction,
  mintCodaiInstallCommandAction,
  refreshCodaiStatusAction,
  unlinkCodaiEnvironmentAction,
  type CodaiLinkView,
} from "@/server/actions/codai";
import { Bot, Copy, ExternalLink, Link2Off, RefreshCw, Rocket, Settings } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

interface Props {
  instanceId: string;
  instanceName: string;
  platform: string;
  initialLink: CodaiLinkView | null;
  codaiConfigured: boolean;
}

type Phase = "idle" | "running" | "done" | "error";
const NEW_PROJECT = "__new__";

function tone(state: string | undefined): "success" | "warning" | "danger" | "muted" {
  if (state === "running") return "success";
  if (state === "enrolling" || state === "pending") return "warning";
  if (state === "error" || state === "destroyed") return "danger";
  return "muted";
}

export function CodaiEnvironmentCard({ instanceId, instanceName, platform, initialLink, codaiConfigured }: Props) {
  const t = useTranslations("vm.codai");
  const tc = useTranslations("common");
  const confirm = useConfirm();
  const [link, setLink] = useState<CodaiLinkView | null>(initialLink);
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<CodaiProject[] | null>(null);
  const [projectChoice, setProjectChoice] = useState<string>(NEW_PROJECT);
  const [projectName, setProjectName] = useState(instanceName);
  const [envName, setEnvName] = useState(instanceName);
  const [phase, setPhase] = useState<Phase>("idle");
  const [lines, setLines] = useState<string[]>([]);
  const [step, setStep] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const supported = platform === "linux" || platform === "macos";

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
  }, [lines.length]);

  async function openDialog() {
    setOpen(true);
    setPhase("idle");
    setLines([]);
    setStep(null);
    if (projects === null) {
      const r = await listCodaiProjectsAction();
      if (r.ok) {
        setProjects(r.data);
        if (r.data[0]) setProjectChoice(r.data[0].id);
      } else {
        setProjects([]);
        toast.error(r.error);
      }
    }
  }

  async function start() {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setPhase("running");
    setLines([]);
    const body = {
      environmentName: envName.trim() || instanceName,
      ...(projectChoice === NEW_PROJECT ? { projectName: projectName.trim() || instanceName } : { projectId: projectChoice }),
    };
    try {
      const res = await fetch(`/api/instances/${encodeURIComponent(instanceId)}/codai/provision/stream`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const e = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(e?.error ?? `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const frames = buf.split("\n\n");
        buf = frames.pop() ?? "";
        for (const frame of frames) {
          const dataLine = frame.split("\n").find((l) => l.startsWith("data: "));
          if (!dataLine) continue;
          let ev: ProvisionEvent;
          try {
            ev = JSON.parse(dataLine.slice(6)) as ProvisionEvent;
          } catch {
            continue;
          }
          if (ev.type === "step") {
            setStep(ev.step);
            setLines((p) => p.concat(`▸ ${ev.message}`));
          } else if (ev.type === "line") {
            setLines((p) => (p.length > 2000 ? p.slice(-2000) : p).concat(ev.text));
          } else if (ev.type === "done") {
            setLink({ environmentId: ev.environmentId, projectId: ev.projectId, slug: ev.slug, state: ev.state, lastCheckedAt: new Date() });
            setPhase(ev.state === "running" || ev.state === "enrolling" ? "done" : "error");
          } else if (ev.type === "error") {
            setLines((p) => p.concat(`✖ ${ev.message}`));
            setPhase("error");
          }
        }
      }
      setPhase((p) => (p === "running" ? "error" : p));
    } catch (e) {
      if (!ctrl.signal.aborted) {
        setLines((p) => p.concat(`✖ ${e instanceof Error ? e.message : String(e)}`));
        setPhase("error");
      }
    }
  }

  const refresh = useAction(
    async () => {
      const r = await refreshCodaiStatusAction(instanceId);
      if (!r.ok) return r;
      setLink(r.data);
      return ok();
    },
    { success: t("refreshed"), refresh: false },
  );

  const copyCommand = useAction(
    async () => {
      const r = await mintCodaiInstallCommandAction(instanceId);
      if (!r.ok) return r;
      await navigator.clipboard.writeText(r.data.command);
      return ok();
    },
    { success: t("commandCopied"), refresh: false },
  );

  const unlink = useAction(
    async () => {
      const r = await unlinkCodaiEnvironmentAction(instanceId);
      if (!r.ok) return r;
      setLink(null);
      return ok();
    },
    { success: t("unlinked"), refresh: false },
  );

  async function onUnlink() {
    const yes = await confirm({ title: t("unlinkConfirm"), description: t("unlinkHint"), tone: "danger", confirmText: t("unlink") });
    if (yes) await unlink.run();
  }

  const stateLabel = link ? (["pending", "enrolling", "running", "stopped", "error", "destroyed"].includes(link.state) ? t(`state.${link.state}` as "state.running") : link.state) : t("state.notLinked");

  return (
    <PageSection
      title={t("title")}
      description={t("description")}
      action={
        <>
          <Badge variant={link ? tone(link.state) : "muted"} dot={link?.state === "running"}>
            {stateLabel}
          </Badge>
          {link ? (
            <>
              <Button asChild size="sm" variant="secondary">
                <a href={hubProjectUrl(link.projectId)} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-4" aria-hidden /> {t("openInCodai")}
                </a>
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void refresh.run()} loading={refresh.pending} aria-label={t("refresh")}>
                <RefreshCw className="size-4" aria-hidden />
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={() => void openDialog()} disabled={!supported || !codaiConfigured}>
              <Rocket className="size-4" aria-hidden /> {t("provision")}
            </Button>
          )}
        </>
      }
    >
      {!codaiConfigured ? (
        <Alert
          tone="info"
          icon={<Bot />}
          action={
            <Button asChild size="sm" variant="secondary">
              <Link href="/settings?section=integrations">
                <Settings className="size-4" aria-hidden /> {t("configure")}
              </Link>
            </Button>
          }
        >
          {t("notConfigured")}
        </Alert>
      ) : !supported ? (
        <Alert tone="info">{t("unsupported")}</Alert>
      ) : link ? (
        <div className="space-y-3">
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[minmax(8rem,auto)_1fr]">
            <dt className="text-xs uppercase tracking-wider text-muted">{t("slug")}</dt>
            <dd className="font-mono text-xs">{link.slug}</dd>
            <dt className="text-xs uppercase tracking-wider text-muted">{t("environmentId")}</dt>
            <dd className="break-all font-mono text-xs">{link.environmentId}</dd>
            <dt className="text-xs uppercase tracking-wider text-muted">{t("projectId")}</dt>
            <dd className="break-all font-mono text-xs">{link.projectId}</dd>
          </dl>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => void copyCommand.run()} loading={copyCommand.pending}>
              <Copy className="size-4" aria-hidden /> {t("copyCommand")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void onUnlink()} disabled={unlink.pending}>
              <Link2Off className="size-4 text-danger" aria-hidden /> {t("unlink")}
            </Button>
          </div>
          <p className="text-xs text-muted">{t("copyCommandHint")}</p>
        </div>
      ) : (
        <p className="text-sm text-muted">{t("hint")}</p>
      )}

      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o && phase === "running") return;
          setOpen(o);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("dialogTitle", { name: instanceName })}</DialogTitle>
          </DialogHeader>
          {phase === "idle" ? (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                void start();
              }}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t("project")} hint={t("projectHint")}>
                  <Select value={projectChoice} onValueChange={setProjectChoice} disabled={projects === null}>
                    <SelectTrigger aria-label={t("project")}>
                      <SelectValue placeholder={projects === null ? tc("loading") : undefined} />
                    </SelectTrigger>
                    <SelectContent>
                      {(projects ?? []).map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                      <SelectItem value={NEW_PROJECT}>{t("newProject")}</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                {projectChoice === NEW_PROJECT && (
                  <Field label={t("projectName")}>
                    <Input value={projectName} onChange={(e) => setProjectName(e.target.value)} maxLength={80} required />
                  </Field>
                )}
                <Field label={t("environmentName")} className={projectChoice === NEW_PROJECT ? "sm:col-span-2" : undefined}>
                  <Input value={envName} onChange={(e) => setEnvName(e.target.value)} maxLength={80} required />
                </Field>
              </div>
              <Alert tone="info" className="text-xs">
                {t("whatHappens")}
              </Alert>
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                  {tc("cancel")}
                </Button>
                <Button type="submit" disabled={projects === null}>
                  <Rocket className="size-4" aria-hidden /> {t("provision")}
                </Button>
              </DialogFooter>
            </form>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge variant={phase === "done" ? "success" : phase === "error" ? "danger" : "info"} dot={phase === "running"}>
                  {phase === "running" && step ? t(`step.${step}` as "step.install") : t(`phase.${phase}` as "phase.done")}
                </Badge>
              </div>
              <div
                ref={scrollerRef}
                role="log"
                aria-live="polite"
                className="max-h-[360px] overflow-y-auto rounded-[var(--radius-md)] border border-border bg-surface-muted p-2 font-mono text-[11px] leading-tight"
              >
                {lines.map((l, i) => (
                  <div key={i} className={l.startsWith("✖") ? "text-danger" : l.startsWith("▸") ? "text-fg" : "text-fg-soft"}>
                    {l}
                  </div>
                ))}
              </div>
              <DialogFooter>
                {phase === "running" ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      abortRef.current?.abort();
                      setPhase("error");
                    }}
                  >
                    {tc("cancel")}
                  </Button>
                ) : (
                  <Button type="button" onClick={() => setOpen(false)}>
                    {tc("close")}
                  </Button>
                )}
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </PageSection>
  );
}
