export interface InstanceLite {
  id: string;
  name: string | null;
  providerInstanceId: string;
  provider: string;
}

export interface GitSourceLite {
  id: string;
  name: string;
  url: string;
  branch: string;
  authType: "none" | "token" | "ssh";
  composeGlob: string;
  targetInstanceId: string | null;
  pollSeconds: number;
  enabled: boolean;
  lastCommit: string | null;
  lastSyncedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
}

export interface HistoryRow {
  id: string;
  sourceId: string;
  commit: string;
  path: string;
  status: "success" | "failed" | "skipped";
  message: string | null;
  createdAt: Date;
}
