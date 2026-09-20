export type RegistryType = "ecr" | "gcr" | "acr" | "dockerhub" | "ghcr";

export interface RegistryLite {
  id: string;
  name: string;
  type: string;
  registryUrl: string;
  createdAt: Date;
}

export interface BuildRow {
  id: string;
  registryId: string;
  imageRef: string;
  buildLocation: "local" | "remote";
  instanceId: string | null;
  status: "pending" | "running" | "success" | "failed";
  logOutput: string | null;
  createdAt: Date;
  finishedAt: Date | null;
}

export interface InstanceLite {
  id: string;
  name: string | null;
  providerInstanceId: string;
  provider: string;
  region: string;
}
