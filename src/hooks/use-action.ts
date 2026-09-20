"use client";

import type { ActionResult } from "@/lib/action-result";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

const I18N_KEY = /^[a-z]+(\.[a-zA-Z0-9]+)+$/;

/** The root-namespace key union is too large for tsc to represent; dynamic
 *  keys from the server are checked at runtime with `has()` instead. */
type LooseTranslator = { (key: string): string; has(key: string): boolean };

export interface UseActionOptions<T> {
  success?: string | ((data: T) => string);
  error?: string;
  onSuccess?: (data: T) => void;
  /** `router.refresh()` after a successful run. Default true. */
  refresh?: boolean;
  invalidate?: QueryKey[];
}

export interface UseActionReturn<TArgs extends unknown[], T> {
  run: (...args: TArgs) => Promise<ActionResult<T>>;
  pending: boolean;
  lastError: string | null;
}

/** Wraps a server action: pending via useTransition, sonner toasts, router
 *  refresh and TanStack Query invalidation. Error strings that look like
 *  i18n keys are translated when the key exists. */
export function useAction<TArgs extends unknown[], T = void>(
  fn: (...args: TArgs) => Promise<ActionResult<T>>,
  opts: UseActionOptions<T> = {},
): UseActionReturn<TArgs, T> {
  const t = useTranslations() as unknown as LooseTranslator;
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pending, startTransition] = React.useTransition();
  const [lastError, setLastError] = React.useState<string | null>(null);
  const optsRef = React.useRef(opts);
  optsRef.current = opts;

  const describe = React.useCallback(
    (error: string | undefined): string => {
      if (error && I18N_KEY.test(error) && t.has(error)) return t(error);
      if (error) return error;
      return optsRef.current.error ?? t("common.error");
    },
    [t],
  );

  const run = React.useCallback(
    (...args: TArgs): Promise<ActionResult<T>> =>
      new Promise<ActionResult<T>>((resolve) => {
        startTransition(async () => {
          let r: ActionResult<T>;
          try {
            r = await fn(...args);
          } catch (e) {
            r = { ok: false, error: e instanceof Error ? e.message : String(e) };
          }
          const o = optsRef.current;
          if (r.ok) {
            setLastError(null);
            const data = ("data" in r ? r.data : undefined) as T;
            const msg = typeof o.success === "function" ? o.success(data) : o.success;
            if (msg) toast.success(msg);
            o.onSuccess?.(data);
            for (const key of o.invalidate ?? []) void queryClient.invalidateQueries({ queryKey: key });
            if (o.refresh !== false) router.refresh();
          } else {
            const msg = describe(r.error);
            setLastError(msg);
            toast.error(msg);
          }
          resolve(r);
        });
      }),
    [fn, describe, queryClient, router],
  );

  return { run, pending, lastError };
}
