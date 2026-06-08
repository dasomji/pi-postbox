import {
  HealthResponseSchema,
  HistoryResponseSchema,
  StateSnapshotSchema,
  type HealthResponse,
  type HistoryResponse,
  type StateSnapshot
} from "@pi-postbox/protocol";

export async function fetchHealth(): Promise<HealthResponse> {
  const response = await fetch("/healthz");
  if (!response.ok) throw new Error(`Health check failed with ${response.status}`);
  return HealthResponseSchema.parse(await response.json());
}

export async function fetchSnapshot(): Promise<StateSnapshot> {
  const response = await fetch("/api/state");
  if (!response.ok) throw new Error(`State snapshot failed with ${response.status}`);
  return StateSnapshotSchema.parse(await response.json());
}

export async function fetchHistory(): Promise<HistoryResponse> {
  const response = await fetch("/api/history");
  if (!response.ok) throw new Error(`History failed with ${response.status}`);
  return HistoryResponseSchema.parse(await response.json());
}

export async function postJson(path: string, payload: unknown): Promise<void> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const fallback = response.status === 409 ? "This request was already resolved on another device." : `Action failed with ${response.status}`;
    const body = (await response.json().catch(() => undefined)) as { message?: string } | undefined;
    throw new Error(body?.message ?? fallback);
  }
}
