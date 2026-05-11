"use client";

import { useState } from "react";
import { Code2, Copy, Check, Terminal, FileCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cliFor, terraformFor, type Action, type InstanceCodeContext } from "@/lib/iac";

interface Props {
  instance: InstanceCodeContext;
}

const ACTIONS: Action[] = ["start", "stop", "reboot", "terminate"];

export function ShowAsCodeDialog({ instance }: Props) {
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
            <Code2 className="h-4 w-4" />
            Show as code
          </Button>
        </TooltipTrigger>
        <TooltipContent>CLI commands and Terraform stub for this instance</TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Code2 className="h-4 w-4 text-[var(--color-primary)]" />
              Show as code · <span className="font-mono">{instance.providerInstanceId}</span>
            </DialogTitle>
          </DialogHeader>

          <Tabs defaultValue="cli" className="mt-2">
            <TabsList>
              <TabsTrigger value="cli">
                <Terminal className="h-3.5 w-3.5" /> CLI
              </TabsTrigger>
              <TabsTrigger value="tf">
                <FileCode className="h-3.5 w-3.5" /> Terraform
              </TabsTrigger>
            </TabsList>

            <TabsContent value="cli" className="space-y-2">
              {ACTIONS.map((a) => {
                const cmd = cliFor(a, instance);
                const k = `cli:${a}`;
                return (
                  <div key={a} className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-muted)]">
                    <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-1.5">
                      <span className="text-[11px] uppercase tracking-wider text-muted">{a}</span>
                      <button
                        onClick={() => copy(cmd, k)}
                        className="inline-flex items-center gap-1 text-[11px] text-muted hover:text-[var(--color-fg)]"
                      >
                        {copied === k ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                        {copied === k ? "copied" : "copy"}
                      </button>
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
                  <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-muted)]">
                    <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-1.5">
                      <span className="text-[11px] uppercase tracking-wider text-muted">terraform</span>
                      <button
                        onClick={() => copy(tf, "tf")}
                        className="inline-flex items-center gap-1 text-[11px] text-muted hover:text-[var(--color-fg)]"
                      >
                        {copied === "tf" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                        {copied === "tf" ? "copied" : "copy"}
                      </button>
                    </div>
                    <pre className="max-h-96 overflow-auto px-3 py-2 font-mono text-xs leading-relaxed">{tf}</pre>
                  </div>
                );
              })()}
            </TabsContent>
          </Tabs>

          <p className="mt-1 text-[11px] text-muted">
            These snippets are best-effort starting points — vmui does not round-trip them. Always review before
            applying.
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}
