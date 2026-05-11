"use client";

import { useActionState, useState } from "react";
import { toast } from "sonner";
import { Loader2, Sparkles, Upload, Copy, Check } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  importSshKeyAction,
  generateSshKeyAction,
  type GenerateSshKeyState,
  type ImportSshKeyState,
} from "@/server/actions/ssh-keys";

const initImport: ImportSshKeyState = {};
const initGen: GenerateSshKeyState = {};

export function SshKeyComposer({ onChanged }: { onChanged?: () => void }) {
  const [imp, importAct, importPending] = useActionState(importSshKeyAction, initImport);
  const [gen, generateAct, genPending] = useActionState(generateSshKeyAction, initGen);
  const [copied, setCopied] = useState(false);

  if (imp.ok && onChanged) onChanged();
  if (gen.ok && onChanged) onChanged();
  if (imp.error && imp.error !== "") toast.error(imp.error);
  if (gen.error && gen.error !== "") toast.error(gen.error);

  const copyKey = async () => {
    if (!gen.publicKey) return;
    await navigator.clipboard.writeText(gen.publicKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add SSH key</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="import">
          <TabsList>
            <TabsTrigger value="import">
              <Upload className="h-4 w-4" /> Import existing
            </TabsTrigger>
            <TabsTrigger value="generate">
              <Sparkles className="h-4 w-4" /> Generate new
            </TabsTrigger>
          </TabsList>

          <TabsContent value="import" className="pt-4">
            <form action={importAct} className="grid gap-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <Label htmlFor="name">Name</Label>
                  <Input id="name" name="name" required placeholder="laptop-personal" />
                </div>
                <div>
                  <Label htmlFor="passphrase">Passphrase (optional)</Label>
                  <Input id="passphrase" name="passphrase" type="password" autoComplete="off" />
                </div>
              </div>
              <div>
                <Label htmlFor="publicKey">Public key (OpenSSH)</Label>
                <textarea
                  id="publicKey"
                  name="publicKey"
                  rows={2}
                  required
                  placeholder="ssh-ed25519 AAAA… you@host"
                  className="flex w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-xs"
                />
              </div>
              <div>
                <Label htmlFor="privateKey">Private key PEM (optional, encrypted at rest)</Label>
                <textarea
                  id="privateKey"
                  name="privateKey"
                  rows={4}
                  placeholder="-----BEGIN OPENSSH PRIVATE KEY-----…"
                  className="flex w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-[10px]"
                />
              </div>
              <Button type="submit" disabled={importPending}>
                {importPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save key
              </Button>
            </form>
          </TabsContent>

          <TabsContent value="generate" className="pt-4">
            <form action={generateAct} className="grid gap-3">
              <div className="grid gap-2 sm:grid-cols-3">
                <div>
                  <Label htmlFor="gname">Name</Label>
                  <Input id="gname" name="name" required placeholder="vmui-default" />
                </div>
                <div>
                  <Label htmlFor="algo">Algorithm</Label>
                  <select
                    id="algo"
                    name="algo"
                    defaultValue="ed25519"
                    className="flex h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
                  >
                    <option value="ed25519">ed25519 (recommended)</option>
                    <option value="rsa">rsa 4096</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor="gpass">Passphrase (optional)</Label>
                  <Input id="gpass" name="passphrase" type="password" autoComplete="off" />
                </div>
              </div>
              <Button type="submit" disabled={genPending}>
                {genPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Generate
              </Button>
              {gen.publicKey && (
                <div className="rounded border border-[var(--color-border)] bg-[var(--color-bg)]/40 p-3">
                  <div className="mb-1 flex items-center justify-between text-xs text-muted">
                    <span>New public key — share this with the cloud provider</span>
                    <Button type="button" size="sm" variant="ghost" onClick={copyKey}>
                      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      {copied ? "Copied" : "Copy"}
                    </Button>
                  </div>
                  <code className="block break-all font-mono text-[10px]">{gen.publicKey}</code>
                </div>
              )}
            </form>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
