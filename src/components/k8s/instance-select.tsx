"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface InstanceLite {
  id: string;
  name: string | null;
  providerInstanceId: string;
  provider: string;
}

export function InstanceSelect({
  instances,
  value,
  onChange,
  label,
  showProvider = true,
}: {
  instances: InstanceLite[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  showProvider?: boolean;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {instances.map((i) => (
          <SelectItem key={i.id} value={i.id}>
            {i.name ?? i.providerInstanceId}
            {showProvider ? ` · ${i.provider}` : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
