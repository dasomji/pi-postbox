// @vitest-environment jsdom
import { createHealthResponse, type StateSnapshot } from "@pi-postbox/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PostboxStore } from "./store.svelte";

let store: PostboxStore;

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
    revision: 1,
    ownerRevision: 1,
    creator: { harness: "pi", ownerId: "owner" },
    owner: { harness: "pi", ownerId: "owner" },
    images: [],
      mode: "single",
    question: { prompt: "Choose the rollout?" },
    options: [{ value: "ship", label: "Ship" }],
    status: "pending",
    createdAt: "2026-07-29T11:59:00.000Z"
  }]
};

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readyState = 0;
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
    this.readyState = 1;
    const event = new MessageEvent("state", { data: JSON.stringify(snapshot) });
    for (const listener of this.listeners.get("state") ?? []) listener(event);
  }

  close(): void { this.readyState = 2; }
}

beforeEach(() => {
  store = new PostboxStore();
  FakeEventSource.instances = [];
  store.snapshot = { status: "loading" };
  store.history = { status: "loading" };
  store.connection = { status: "checking" };
  store.selection = { kind: "none" };
  store.syncing = true;
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("dashboard live-state bootstrap", () => {
  it("recovers from a failed startup health check without reloading", async () => {
    vi.useFakeTimers();
    let offline = true;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (offline) throw new TypeError("Failed to fetch");
      return Response.json(String(input) === "/healthz"
        ? createHealthResponse({ startedAtMs: 1_000, nowMs: 2_000 }) : SNAPSHOT);
    }));
    const stop = store.start();
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(store.connection.status).toBe("unavailable");
      offline = false;
      // A visibility refresh alone must not strand the form without health.
      await store.loadSnapshot();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(store.connection.status).toBe("connected");
      expect(store.syncing).toBe(false);
      expect(FakeEventSource.instances).toHaveLength(1);
    } finally { stop(); }
  });

  it("retries a failed state refresh while the stream is otherwise healthy", async () => {
    vi.useFakeTimers();
    let offline = false;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (offline) throw new TypeError("Failed to fetch");
      return Response.json(String(input) === "/healthz"
        ? createHealthResponse({ startedAtMs: 1_000, nowMs: 2_000 }) : SNAPSHOT);
    }));
    const stop = store.start();
    try {
      await vi.advanceTimersByTimeAsync(0);
      FakeEventSource.instances[0]!.emitState(SNAPSHOT);
      offline = true;
      await store.refresh();
      expect(store.connection.status).toBe("unavailable");
      offline = false;
      await vi.advanceTimersByTimeAsync(5_000);
      expect(store.connection.status).toBe("connected");
      expect(store.syncing).toBe(false);
      expect(store.pendingRequests).toHaveLength(1);
    } finally { stop(); }
  });

  it.each(["compatible", "incompatible"])("requires fresh %s health after SSE reconnects before a poll", async (compatibility) => {
    vi.useFakeTimers();
    const before = createHealthResponse({ startedAtMs: 1_000, nowMs: 2_000 });
    const after = { ...before, version: "9.9.9", buildId: "9.9.9+restarted",
      profile: { kind: "development" as const, id: "development:0123456789abcdef" },
      protocolVersion: compatibility === "compatible" ? before.protocolVersion : "99.0.0" };
    const healthResponse = before;
    let releaseHealth!: (response: Response) => void;
    let delayHealth = false;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) !== "/healthz") return Response.json(SNAPSHOT);
      if (delayHealth) return new Promise<Response>((resolve) => { releaseHealth = resolve; });
      return Response.json(healthResponse);
    });
    vi.stubGlobal("fetch", fetcher);
    const stop = store.start();
    try {
      await vi.advanceTimersByTimeAsync(0);
      const events = FakeEventSource.instances[0]!;
      events.emitState(SNAPSHOT);
      delayHealth = true;
      events.onerror?.(new Event("error"));
      // Native EventSource reconnects before the outstanding health probe settles.
      events.emitState(SNAPSHOT);
      expect(store.connection.status).toBe("unavailable");
      expect(store.syncing).toBe(true);
      releaseHealth(Response.json(after));
      await vi.advanceTimersByTimeAsync(0);
      if (compatibility === "compatible") {
        expect(store.connection).toEqual({ status: "connected", health: after });
        expect(store.syncing).toBe(false);
        const recoveredCalls = fetcher.mock.calls.length;
        await vi.advanceTimersByTimeAsync(5_000);
        expect(fetcher).toHaveBeenCalledTimes(recoveredCalls);
      } else {
        expect(store.connection.status).toBe("unavailable");
        expect(store.connection).toHaveProperty("message", expect.stringContaining("Incompatible"));
        events.emitState(SNAPSHOT);
        expect(store.connection.status).toBe("unavailable");
      }
    } finally { stop(); }
  });

  it("does not overlap slow recovery polls", async () => {
    vi.useFakeTimers();
    let stateReads = 0;
    let releaseState!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/healthz") return Response.json(createHealthResponse({ startedAtMs: 1_000 }));
      stateReads++;
      return new Promise<Response>((resolve) => { releaseState = resolve; });
    }));
    const stop = store.start();
    try {
      await vi.advanceTimersByTimeAsync(0);
      FakeEventSource.instances[0]!.emitState(SNAPSHOT);
      FakeEventSource.instances[0]!.onerror?.(new Event("error"));
      await vi.advanceTimersByTimeAsync(15_000);
      expect(stateReads).toBe(1);
      releaseState(Response.json(SNAPSHOT));
      await vi.advanceTimersByTimeAsync(0);
    } finally { stop(); }
  });

  it("drops an older recovery snapshot that arrives after a newer live resolution", async () => {
    vi.useFakeTimers();
    let releaseState!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/healthz") return Response.json(createHealthResponse({ startedAtMs: 1_000 }));
      return new Promise<Response>((resolve) => { releaseState = resolve; });
    }));
    const stop = store.start();
    try {
      await vi.advanceTimersByTimeAsync(0);
      const events = FakeEventSource.instances[0]!;
      events.emitState(SNAPSHOT);
      events.onerror?.(new Event("error"));
      await vi.advanceTimersByTimeAsync(0);
      events.emitState({ ...SNAPSHOT, requests: [] });
      expect(store.pendingRequests).toEqual([]);
      releaseState(Response.json(SNAPSHOT));
      await vi.advanceTimersByTimeAsync(0);
      expect(store.pendingRequests).toEqual([]);
    } finally { stop(); }
  });

  it("reopens a CLOSED stream on recovery and stops polling after a healthy live event", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async (input: RequestInfo | URL) => Response.json(String(input) === "/healthz"
      ? createHealthResponse({ startedAtMs: 1_000 }) : SNAPSHOT));
    vi.stubGlobal("fetch", fetcher);
    const stop = store.start();
    try {
      await vi.advanceTimersByTimeAsync(0);
      const events = FakeEventSource.instances[0]!;
      events.emitState(SNAPSHOT);
      events.close(); // A proxy can make native EventSource give up permanently.
      events.onerror?.(new Event("error"));
      await vi.advanceTimersByTimeAsync(0);
      expect(FakeEventSource.instances).toHaveLength(2);
      FakeEventSource.instances[1]!.emitState(SNAPSHOT);
      const recoveredCalls = fetcher.mock.calls.length;
      await vi.advanceTimersByTimeAsync(15_000);
      expect(fetcher).toHaveBeenCalledTimes(recoveredCalls);
      expect(store.connection.status).toBe("connected");
    } finally { stop(); }
  });

  it("marks a lost stream unavailable, retains pending Questions through failed polls, and recovers automatically", async () => {
    vi.useFakeTimers();
    let offline = false;
    let currentSnapshot = SNAPSHOT;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (offline) throw new TypeError("Failed to fetch");
      if (String(input) === "/healthz") {
        return Response.json(createHealthResponse({ startedAtMs: 1_000, nowMs: 2_000 }));
      }
      return Response.json(currentSnapshot);
    }));
    const stop = store.start();
    try {
      await vi.advanceTimersByTimeAsync(0);
      const events = FakeEventSource.instances[0]!;
      events.emitState(SNAPSHOT);
      store.selectRequest("ask-notification");
      expect(store.connection.status).toBe("connected");

      offline = true;
      events.onerror?.(new Event("error"));
      // Losing the stream is enough to stop claiming connectivity, even before a poll settles.
      expect(store.connection.status).toBe("unavailable");
      await vi.advanceTimersByTimeAsync(5_000);
      expect(store.selectedRequest?.status).toBe("pending");
      expect(store.pendingRequests.map((request) => request.requestId)).toEqual(["ask-notification"]);
      expect(store.syncing).toBe(true);

      offline = false;
      await vi.advanceTimersByTimeAsync(5_000);
      expect(store.connection.status).toBe("connected");
      expect(store.syncing).toBe(false);
      expect(store.selectedRequest?.status).toBe("pending");

      // A Question resolved elsewhere while this tab is offline disappears on recovery.
      offline = true;
      events.onerror?.(new Event("error"));
      await vi.advanceTimersByTimeAsync(5_000);
      currentSnapshot = { ...SNAPSHOT, requests: [] };
      offline = false;
      await vi.advanceTimersByTimeAsync(5_000);
      expect(store.connection.status).toBe("connected");
      expect(store.pendingRequests).toEqual([]);
      expect(store.selectedRequest).toBeUndefined();
      expect(store.selection).toEqual({ kind: "none" });
    } finally {
      stop();
    }
  });

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
    await vi.waitFor(() => expect(FakeEventSource.instances.map((source) => source.url)).toEqual(["/api/state/events"]));
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
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
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
