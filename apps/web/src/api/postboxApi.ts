import {
  HealthResponseSchema,
  HistoryResponseSchema,
  PushConfigResponseSchema,
  StateSnapshotSchema,
  type HealthResponse,
  type HistoryResponse,
  type PushConfigResponse,
  type PushSubscriptionPayload,
  type StateSnapshot
} from "@pi-postbox/protocol";
import {
  QuestionChatActivationResponseSchema,
  QuestionChatStreamEventSchema,
  QuestionChatSendHttpResponseSchema,
  QuestionChatSnapshotHttpResponseSchema,
  QuestionChatStopHttpResponseSchema,
  type QuestionChatActivationResponse,
  type QuestionChatStreamEvent,
  type QuestionChatSendPayload,
  type QuestionChatSendResponse,
  type QuestionChatSnapshot,
  type QuestionChatStopPayload,
  type QuestionChatStopResponse
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

export async function fetchPushConfig(): Promise<PushConfigResponse> {
  const response = await fetch("/api/push/config");
  if (!response.ok) throw new Error(`Push config failed with ${response.status}`);
  return PushConfigResponseSchema.parse(await response.json());
}

export async function savePushSubscription(subscription: PushSubscriptionPayload): Promise<void> {
  const response = await fetch("/api/push/subscriptions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscription)
  });

  if (!response.ok) throw new Error(`Push subscription save failed with ${response.status}`);
}

export async function deletePushSubscription(endpoint: string): Promise<void> {
  const response = await fetch("/api/push/subscriptions", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint })
  });

  if (!response.ok) throw new Error(`Push subscription delete failed with ${response.status}`);
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

export async function activateQuestionChat(requestId: string): Promise<QuestionChatActivationResponse> {
  const response = await fetch(`/api/requests/${encodeURIComponent(requestId)}/chat`, { method: "POST" });
  const parsed = QuestionChatActivationResponseSchema.parse(await response.json());
  if (!response.ok && parsed.status === "ready") {
    throw new Error(`Chat activation failed with ${response.status}`);
  }
  return parsed;
}

export async function activateContextQuestionChat(requestId: string): Promise<QuestionChatActivationResponse> {
  const response = await fetch(`/api/requests/${encodeURIComponent(requestId)}/chat/context`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirmed: true })
  });
  const parsed = QuestionChatActivationResponseSchema.parse(await response.json());
  if (!response.ok && parsed.status === "ready") {
    throw new Error(`Context-only Chat activation failed with ${response.status}`);
  }
  return parsed;
}

export async function fetchQuestionChatSnapshot(requestId: string): Promise<QuestionChatSnapshot> {
  const response = await fetch(`/api/requests/${encodeURIComponent(requestId)}/chat`);
  const body = QuestionChatSnapshotHttpResponseSchema.parse(await response.json());
  if (!response.ok || body.status === "unavailable") {
    throw new Error(body.status === "unavailable" ? body.error.message : `Chat snapshot failed with ${response.status}`);
  }
  return body.snapshot;
}

export type QuestionChatProbeResult =
  | { status: "ready"; snapshot: QuestionChatSnapshot }
  | { status: "not-started" }
  | { status: "unavailable"; error: import("@pi-postbox/protocol").QuestionChatAvailabilityError };

/** Read-only discovery used to reattach a browser to an already-running Chat. */
export async function probeQuestionChatSnapshot(requestId: string): Promise<QuestionChatProbeResult> {
  const response = await fetch(`/api/requests/${encodeURIComponent(requestId)}/chat`);
  const body = QuestionChatSnapshotHttpResponseSchema.parse(await response.json());
  if (body.status === "ready") {
    if (!response.ok) throw new Error(`Chat snapshot probe failed with ${response.status}`);
    return body;
  }
  if (body.error.code === "chat_not_started") return { status: "not-started" };
  return { status: "unavailable", error: body.error };
}

export async function sendQuestionChatMessage(requestId: string, command: QuestionChatSendPayload): Promise<QuestionChatSendResponse> {
  const response = await fetch(`/api/requests/${encodeURIComponent(requestId)}/chat/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(command)
  });
  const body = QuestionChatSendHttpResponseSchema.parse(await response.json());
  if (!response.ok || body.status === "unavailable") {
    throw new Error(body.status === "unavailable" ? body.error.message : `Chat send failed with ${response.status}`);
  }
  return body;
}

export async function stopQuestionChat(requestId: string, command: QuestionChatStopPayload): Promise<QuestionChatStopResponse> {
  const response = await fetch(`/api/requests/${encodeURIComponent(requestId)}/chat/stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(command)
  });
  const body = QuestionChatStopHttpResponseSchema.parse(await response.json());
  if (!response.ok || body.status === "unavailable") {
    throw new Error(body.status === "unavailable" ? body.error.message : `Chat stop failed with ${response.status}`);
  }
  return body;
}

export interface QuestionChatEventConnection {
  ready: Promise<void>;
  close(): void;
}

export function connectQuestionChatEvents(requestId: string, onEvent: (event: QuestionChatStreamEvent) => void): QuestionChatEventConnection {
  const source = new EventSource(`/api/requests/${encodeURIComponent(requestId)}/chat/events`);
  let opened = false;
  let rejectReady: ((error: Error) => void) | undefined;
  const ready = new Promise<void>((resolve, reject) => {
    rejectReady = reject;
    source.onopen = () => {
      opened = true;
      resolve();
    };
    source.onerror = () => {
      if (!opened) reject(new Error("Question Chat event stream is unavailable."));
      else onEvent({ requestId, type: "transport", state: "offline" });
    };
  });
  source.onmessage = (message) => {
    try {
      const parsed = QuestionChatStreamEventSchema.safeParse(JSON.parse(message.data));
      if (parsed.success) onEvent(parsed.data);
    } catch {
      // Ignore malformed transient frames; the next snapshot can resynchronize.
    }
  };
  return {
    ready,
    close: () => {
      source.close();
      if (!opened) rejectReady?.(new Error("Question Chat event stream closed before connecting."));
    }
  };
}
