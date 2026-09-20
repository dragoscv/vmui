"use client";

import * as React from "react";

/** True below the given CSS width. Returns `null` until mounted so callers can
 *  avoid rendering both variants — each instance card opens its own SSE stream
 *  and a browser only allows six HTTP/1.1 connections per origin. */
export function useIsNarrow(query = "(max-width: 767px)"): boolean | null {
  const [narrow, setNarrow] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    const mq = window.matchMedia(query);
    const apply = () => setNarrow(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [query]);
  return narrow;
}
