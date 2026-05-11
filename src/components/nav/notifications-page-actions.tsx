"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { dismissAllNotificationsAction } from "@/server/actions/notifications";

export function DismissAllButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await dismissAllNotificationsAction();
          router.refresh();
        })
      }
    >
      Dismiss all
    </Button>
  );
}
