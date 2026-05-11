"use client";

import { useMemo, useState } from "react";
import type { SnapshotEvent } from "@/server/queries/snapshots";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Calendar, CalendarDays, LineChart } from "lucide-react";
import { SnapshotHeatmap } from "./snapshot-heatmap";
import { SnapshotMonth } from "./snapshot-month";
import { SnapshotTimeline } from "./snapshot-timeline";

export function SnapshotCalendar({ events }: { events: SnapshotEvent[] }) {
  const sorted = useMemo(() => [...events].sort((a, b) => b.capturedAt - a.capturedAt), [events]);
  const [providerFilter, setProviderFilter] = useState<string>("all");
  const filtered = useMemo(
    () => (providerFilter === "all" ? sorted : sorted.filter((e) => e.provider === providerFilter)),
    [sorted, providerFilter],
  );
  const providers = useMemo(() => Array.from(new Set(events.map((e) => e.provider))), [events]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Snapshots over time</h2>
          <p className="text-xs text-muted">
            {filtered.length} snapshots across {new Set(filtered.map((e) => e.accountId)).size} accounts.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value)}
            className="h-8 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs"
          >
            <option value="all">All providers</option>
            {providers.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="heatmap" className="w-full">
          <TabsList className="grid w-full grid-cols-3 max-w-md">
            <TabsTrigger value="heatmap">
              <CalendarDays className="mr-1.5 h-3.5 w-3.5" /> Heatmap
            </TabsTrigger>
            <TabsTrigger value="month">
              <Calendar className="mr-1.5 h-3.5 w-3.5" /> Month
            </TabsTrigger>
            <TabsTrigger value="timeline">
              <LineChart className="mr-1.5 h-3.5 w-3.5" /> Timeline
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
      </CardContent>
    </Card>
  );
}
