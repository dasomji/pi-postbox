// @vitest-environment jsdom
import { createHealthResponse, type StateSnapshot } from "@pi-postbox/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { store } from "./store.svelte";

const SNAPSHOT: StateSnapshot = {
  timestamp: "2026-07-29T12:00:00.000Z",
  sessions: [{
    sessionId: "session-notification",
    machineId: "machine-1",
    machineName: "Workstation",
    hostname: "workstation.local",
    projectId: "project-notification",
    projectName: "Notification project",
    cwd: "/workspace/project-notification",
    branch: "main",
    semanticState: "blocked",
    presence: "live",
    updatedAt: "2026-07-29T12:00:00.000Z"
  }],
  requests: [{
    requestId: "ask-notification",
    sessionId: "session-notification",
    mode: "single",
    question: { prompt: "Choose the rollout?" },
    options: [{ value: "ship", label: "Ship" }],
    status: "pending",
    createdAt: "2026-07-29T11:59:00.000Z"
  }]
};

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onerror: ((event: Event) => unknown) | null = null;
  private readonly listeners = new Map<string, Array<(event: Event) => unknown>>();

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emitState(snapshot: StateSnapshot): void {
    const event = new MessageEvent("state", { data: JSON.stringify(snapshot) });
    for (const listener of this.listeners.get("state") ?? []) listener(event);
  }

  close(): void {}
}

beforeEach(() => {
  FakeEventSource.instances = [];
  store.snapshot = { status: "loading" };
  store.history = { status: "loading" };
  store.connection = { status: "checking" };
  store.selection = { kind: "none" };
  store.syncing = true;
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("dashboard live-state bootstrap", () => {
  it("uses the initial event-stream snapshot for startup and notification routing without state or History fetches", async () => {
    const requestedUrls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url === "/healthz") {
        return Response.json(createHealthResponse({ startedAtMs: 1_000, nowMs: 2_000 }));
      }
      throw new Error(`Unexpected startup fetch: ${url}`);
    }));

    const stop = store.start();
    const navigation = store.openRequestFromNotification("ask-notification");

    await vi.waitFor(() => expect(requestedUrls).toEqual(["/healthz"]));
    expect(FakeEventSource.instances.map((source) => source.url)).toEqual(["/api/state/events"]);
    expect(store.selection).toEqual({ kind: "none" });

    FakeEventSource.instances[0]?.emitState(SNAPSHOT);
    await navigation;

    expect(store.selection).toEqual({ kind: "request", requestId: "ask-notification" });
    expect(store.selectedRequest?.question.prompt).toBe("Choose the rollout?");
    expect(requestedUrls).toEqual(["/healthz"]);
    expect(store.history).toEqual({ status: "loading" });

    stop();
  });

  it("leaves a failed fallback bootstrap recoverable and permits a notification retry", async () => {
    let stateAttempts = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/healthz") {
        return Response.json(createHealthResponse({ startedAtMs: 1_000, nowMs: 2_000 }));
      }
      if (url === "/api/state") {
        stateAttempts += 1;
        if (stateAttempts === 1) throw new Error("state temporarily unavailable");
        return Response.json(SNAPSHOT);
      }
      throw new Error(`Unexpected startup fetch: ${url}`);
    }));

    const stop = store.start();
    const failedNavigation = store.openRequestFromNotification("ask-notification");
    FakeEventSource.instances[0]?.onerror?.(new Event("error"));
    await failedNavigation;

    expect(store.snapshot).toEqual({ status: "error", message: "state temporarily unavailable" });
    expect(store.selection).toEqual({ kind: "none" });

    await store.openRequestFromNotification("ask-notification");

    expect(stateAttempts).toBe(2);
    expect(store.selection).toEqual({ kind: "request", requestId: "ask-notification" });
    stop();
  });
});
