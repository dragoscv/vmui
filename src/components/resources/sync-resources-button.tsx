"use client";

import { useTransition } from "react";
import { RefreshCw, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { syncAllResources } from "@/server/actions/resources";
import { useRouter } from "next/navigation";

export function SyncResourcesButton() {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button
      onClick={() =>
        start(async () => {
          const r = await syncAllResources();
          if (r.ok) {
            toast.success(`Synced ${r.total} resources`);
            router.refresh();
          } else {
            toast.error("Resource sync failed");
          }
        })
      }
      disabled={pending}
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
      Sync resources
    </Button>
  );
}
