"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTranslations } from "next-intl";
import * as React from "react";

export type InstanceTabId = "overview" | "monitoring" | "operations" | "notes";

/** Groups the detail page's sections; `#snapshots`-style deep links land on the owning tab. */
export function InstanceTabs({ panels }: { panels: Partial<Record<InstanceTabId, React.ReactNode>> }) {
  const t = useTranslations("vm.detail.tabs");
  const ids = (Object.keys(panels) as InstanceTabId[]).filter((k) => panels[k] != null);
  const [value, setValue] = React.useState<InstanceTabId>(ids[0] ?? "overview");

  React.useEffect(() => {
    const hash = window.location.hash.replace("#", "");
    if (!hash) return;
    const owner = ids.find((k) => k === hash) ?? (hash === "snapshots" || hash === "schedules" ? "operations" : undefined);
    if (owner && panels[owner] != null) setValue(owner);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  if (ids.length <= 1) return <>{ids[0] ? panels[ids[0]] : null}</>;

  return (
    <Tabs value={value} onValueChange={(v) => setValue(v as InstanceTabId)}>
      <TabsList className="-mx-4 h-auto w-[calc(100%+2rem)] justify-start overflow-x-auto rounded-none bg-transparent px-4 [scrollbar-width:none] sm:mx-0 sm:w-auto sm:rounded-[var(--radius-md)] sm:bg-bg-muted sm:px-1 [&::-webkit-scrollbar]:hidden">
        {ids.map((id) => (
          <TabsTrigger key={id} value={id} className="h-9 min-w-[2.5rem] focus-visible:ring-2 focus-visible:ring-primary">
            {t(id)}
          </TabsTrigger>
        ))}
      </TabsList>
      {ids.map((id) => (
        <TabsContent key={id} value={id} className="space-y-6">
          {panels[id]}
        </TabsContent>
      ))}
    </Tabs>
  );
}
