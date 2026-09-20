"use client";

import { Button, Field, Input, Subsection, Textarea, ToggleGroup } from "@/components/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAction } from "@/hooks/use-action";
import { err, ok, type ActionResult } from "@/lib/action-result";
import { kickoffBuildAction } from "@/server/actions/builds";
import { Hammer } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { InstanceLite, RegistryLite } from "./types";

export function NewBuildForm({
  registries,
  instances,
  onStarted,
  onCancel,
}: {
  registries: RegistryLite[];
  instances: InstanceLite[];
  onStarted: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("ops.builds");
  const tc = useTranslations("common");
  const [registryId, setRegistryId] = useState(registries[0]?.id ?? "");
  const [imageRef, setImageRef] = useState("");
  const [buildLocation, setBuildLocation] = useState<"local" | "remote">("local");
  const [instanceId, setInstanceId] = useState(instances[0]?.id ?? "");
  const [dockerfile, setDockerfile] = useState("FROM alpine:3\nRUN echo hello > /hello.txt\n");

  const start = useAction(
    async (): Promise<ActionResult> => {
      if (!registryId || !imageRef || !dockerfile) return err(t("newBuild.fillAll"));
      try {
        const res = await kickoffBuildAction({
          registryId,
          imageRef,
          dockerfile,
          buildLocation,
          instanceId: buildLocation === "remote" ? instanceId : undefined,
        });
        if (!res.ok) return err(res.error);
        onStarted();
        return ok();
      } catch (e) {
        return err(e instanceof Error ? e.message : "common.error");
      }
    },
    { success: t("newBuild.started"), refresh: false },
  );

  return (
    <Subsection title={t("newBuild.title")} hint={t("newBuild.hint")}>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Field label={t("newBuild.fields.registry")}>
          <Select value={registryId} onValueChange={setRegistryId}>
            <SelectTrigger aria-label={t("newBuild.fields.registry")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {registries.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name} ({r.type})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label={t("newBuild.fields.imageRef")} className="sm:col-span-2 xl:col-span-1">
          <Input value={imageRef} onChange={(e) => setImageRef(e.target.value)} placeholder="ghcr.io/owner/img:tag" className="font-mono" autoComplete="off" />
        </Field>
        <Field label={t("newBuild.fields.buildLocation")}>
          <ToggleGroup
            value={buildLocation}
            onValueChange={setBuildLocation}
            aria-label={t("newBuild.fields.buildLocation")}
            options={[
              { value: "local", label: t("location.local") },
              { value: "remote", label: t("location.remote"), disabled: instances.length === 0 },
            ]}
          />
        </Field>
        {buildLocation === "remote" && (
          <Field label={t("newBuild.fields.instance")}>
            <Select value={instanceId} onValueChange={setInstanceId}>
              <SelectTrigger aria-label={t("newBuild.fields.instance")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {instances.map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.name ?? i.providerInstanceId} · {i.provider}/{i.region}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
      </div>
      <Field label={t("newBuild.fields.dockerfile")}>
        <Textarea value={dockerfile} onChange={(e) => setDockerfile(e.target.value)} rows={8} spellCheck={false} className="font-mono text-xs" />
      </Field>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {tc("cancel")}
        </Button>
        <Button size="sm" loading={start.pending} onClick={() => void start.run()}>
          <Hammer className="size-4" aria-hidden /> {t("newBuild.start")}
        </Button>
      </div>
    </Subsection>
  );
}
