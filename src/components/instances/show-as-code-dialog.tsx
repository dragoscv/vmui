"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cliFor, terraformFor, type Action, type InstanceCodeContext } from "@/lib/iac";
import { Check, Code2, Copy, FileCode, Terminal } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

interface Props {
  instance: InstanceCodeContext;
}

const ACTIONS: Action[] = ["start", "stop", "reboot", "terminate"];

export function ShowAsCodeDialog({ instance }: Props) {
  const t = useTranslations("vm.actions.code");
  const ta = useTranslations("vm.actions");
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  function copy(s: string, k: string) {
    void navigator.clipboard.writeText(s);
    setCopied(k);
    setTimeout(() => setCopied((c) => (c === k ? null : c)), 1500);
  }

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
            <Code2 className="h-4 w-4" aria-hidden />
            {t("button")}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("tooltip")}</TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Code2 className="h-4 w-4 text-primary" aria-hidden />
              {t("title")} · <span className="font-mono">{instance.providerInstanceId}</span>
            </DialogTitle>
          </DialogHeader>

          <Tabs defaultValue="cli" className="mt-2">
            <TabsList>
              <TabsTrigger value="cli">
                <Terminal className="h-3.5 w-3.5" aria-hidden /> {t("cli")}
              </TabsTrigger>
              <TabsTrigger value="tf">
                <FileCode className="h-3.5 w-3.5" aria-hidden /> {t("terraform")}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="cli" className="space-y-2">
              {ACTIONS.map((a) => {
                const cmd = cliFor(a, instance);
                const k = `cli:${a}`;
                return (
                  <div key={a} className="rounded-[var(--radius-md)] border border-border bg-bg-muted">
                    <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
                      <span className="text-[11px] uppercase tracking-wider text-muted">{ta(a)}</span>
                      <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px] text-muted" onClick={() => copy(cmd, k)}>
                        {copied === k ? <Check className="h-3 w-3" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}
                        {copied === k ? t("copied") : t("copy")}
                      </Button>
                    </div>
                    <pre className="overflow-x-auto px-3 py-2 font-mono text-xs leading-relaxed">{cmd}</pre>
                  </div>
                );
              })}
            </TabsContent>

            <TabsContent value="tf">
              {(() => {
                const tf = terraformFor(instance);
                return (
                  <div className="rounded-[var(--radius-md)] border border-border bg-bg-muted">
                    <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
                      <span className="text-[11px] uppercase tracking-wider text-muted">{t("terraform")}</span>
                      <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px] text-muted" onClick={() => copy(tf, "tf")}>
                        {copied === "tf" ? <Check className="h-3 w-3" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}
                        {copied === "tf" ? t("copied") : t("copy")}
                      </Button>
                    </div>
                    <pre className="max-h-96 overflow-auto px-3 py-2 font-mono text-xs leading-relaxed">{tf}</pre>
                  </div>
                );
              })()}
            </TabsContent>
          </Tabs>

          <p className="mt-1 text-[11px] text-muted">{t("disclaimer")}</p>
        </DialogContent>
      </Dialog>
    </>
  );
}
