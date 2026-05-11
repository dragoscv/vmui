const DEFAULT_IDLE_DAYS = 14;

export interface IdleInfo {
  isIdle: boolean;
  idleDays: number;
  threshold: number;
}

/**
 * Heuristic: a running instance whose normalized state has not changed
 * for at least `thresholdDays` (default 14) is "possibly idle" and likely
 * burning money. We deliberately bias toward false-positives because
 * surfacing the badge is cheap and only suggests action.
 */
export function detectIdle(args: {
  state: string;
  lastStateChangeAt: Date | null | undefined;
  thresholdDays?: number;
}): IdleInfo {
  const threshold = args.thresholdDays ?? DEFAULT_IDLE_DAYS;
  if (args.state !== "running" || !args.lastStateChangeAt) {
    return { isIdle: false, idleDays: 0, threshold };
  }
  const idleDays = Math.floor(
    (Date.now() - args.lastStateChangeAt.getTime()) / (24 * 60 * 60 * 1000),
  );
  return { isIdle: idleDays >= threshold, idleDays, threshold };
}
