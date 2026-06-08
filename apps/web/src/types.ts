import type { HealthResponse, HistoryResponse, StateSnapshot } from "@pi-postbox/protocol";

export type ConnectionState =
  | { status: "checking" }
  | { status: "connected"; health: HealthResponse }
  | { status: "unavailable"; message: string };

export type SnapshotState =
  | { status: "loading" }
  | { status: "ready"; snapshot: StateSnapshot }
  | { status: "error"; message: string };

export type HistoryState =
  | { status: "loading" }
  | { status: "ready"; response: HistoryResponse }
  | { status: "error"; message: string };
