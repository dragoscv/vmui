"use client";

import { PageSection } from "@/components/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { SnapshotEvent } from "@/server/queries/snapshots";
import { Calendar, CalendarDays, LineChart } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { SnapshotHeatmap } from "./snapshot-heatmap";
import { SnapshotMonth } from "./snapshot-month";
import { SnapshotTimeline } from "./snapshot-timeline";

export function SnapshotCalendar({ events }: { events: SnapshotEvent[] }) {
  const t = useTranslations("ops.backups.calendar");
  const tc = useTranslations("common");
  const sorted = useMemo(() => [...events].sort((a, b) => b.capturedAt - a.capturedAt), [events]);
  const [providerFilter, setProviderFilter] = useState<string>("all");
  const filtered = useMemo(
    () => (providerFilter === "all" ? sorted : sorted.filter((e) => e.provider === providerFilter)),
    [sorted, providerFilter],
  );
  const providers = useMemo(() => Array.from(new Set(events.map((e) => e.provider))), [events]);
  const accounts = useMemo(() => new Set(filtered.map((e) => e.accountId)).size, [filtered]);

  return (
    <PageSection
      title={t("title")}
      description={t("summary", { count: filtered.length, accounts })}
      action={
        <Select value={providerFilter} onValueChange={setProviderFilter}>
          <SelectTrigger className="h-8 w-40 text-xs" aria-label={t("providerFilter")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{tc("all")}</SelectItem>
            {providers.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    >
      <Tabs defaultValue="heatmap" className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-3">
          <TabsTrigger value="heatmap">
            <CalendarDays className="mr-1.5 size-3.5" aria-hidden /> {t("tabs.heatmap")}
          </TabsTrigger>
          <TabsTrigger value="month">
            <Calendar className="mr-1.5 size-3.5" aria-hidden /> {t("tabs.month")}
          </TabsTrigger>
          <TabsTrigger value="timeline">
            <LineChart className="mr-1.5 size-3.5" aria-hidden /> {t("tabs.timeline")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="heatmap" className="pt-4">
          <SnapshotHeatmap events={filtered} />
        </TabsContent>
        <TabsContent value="month" className="pt-4">
          <SnapshotMonth events={filtered} />
        </TabsContent>
        <TabsContent value="timeline" className="pt-4">
          <SnapshotTimeline events={filtered} />
        </TabsContent>
      </Tabs>
    </PageSection>
  );
}
