import type { AskCreatePayload, AskResult, ExtensionServerMessage, SessionRegisterPayload } from "@pi-postbox/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PostboxClient } from "../src/client/PostboxClient.js";
import { formatPostboxStatusSnapshot } from "../src/status.js";

const registration: SessionRegisterPayload = {
  machine: { machineId: "machine-1", hostname: "workstation" },
  project: { projectId: "project-1", name: "pi-postbox", cwd: "/repo" },
  session: { sessionId: "session-1", cwd: "/repo", semanticState: "blocked" }
};

const askPayload: AskCreatePayload = {
  requestId: "ask-replay",
  sessionId: "session-1",
  mode: "single",
  question: { prompt: "Reconnect?" },
  options: [{ value: "yes", label: "Yes" }],
  context: {
    codebaseContext: "Pi extension WebSocket client with reconnect support.",
    problemContext: "Keep a pending decision stable across reconnects."
  }
};

const LOCAL_POSTBOX_URL = "http://127.0.0.1:32187/";
const TAILNET_POSTBOX_URL = "https://postbox.tailnet.example:32187";

afterEach(() => {
  vi.useRealTimers();
});

class FakeSocket {
  static instances: FakeSocket[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;

  readyState = FakeSocket.CONNECTING;
  sent: unknown[] = [];
  private readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>();

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  on(event: "open" | "close" | "error" | "message", listener: (...args: unknown[]) => void): void {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(): void {
    this.readyState = FakeSocket.CLOSED;
    this.emit("close");
  }

  open(): void {
    this.readyState = FakeSocket.OPEN;
    this.emit("open");
  }

  serverMessage(message: ExtensionServerMessage): void {
    this.emit("message", JSON.stringify(message));
  }

  fail(error: Error): void {
    this.emit("error", error);
  }

  private emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }
}

function createClient(options: Partial<ConstructorParameters<typeof PostboxClient>[0]> = {}): PostboxClient {
  return new PostboxClient({
    serverUrl: "http://postbox.local",
    registration,
    heartbeatMs: 60_000,
    reconnectMs: 100,
    askUnavailableAfterMs: 1_000,
    WebSocketImpl: FakeSocket as never,
    ...options
  });
}

function selectedTarget(url: string, role: "dev" | "production" = "dev", instanceId = `${role}-instance`) {
  const profile = role === "dev"
    ? { kind: "development" as const, id: "development:0123456789abcdef" as const }
    : { kind: "production" as const, id: "production" as const };
  return {
    status: "selected" as const,
    profile: {} as never,
    target: {
      source: "profile-metadata" as const,
      url,
      profile,
      instanceId,
      buildId: "test-build",
      profilePollingEnabled: true
    },
    diagnostics: []
  };
}

function socketUrl(serverUrl: string): string {
  const url = new URL(serverUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/api/extension/ws";
  url.search = "";
  return url.toString();
}

describe("PostboxClient pending ask resilience", () => {
  it("settles discovery queries on correlated error, disconnect, and stop", async () => {
    FakeSocket.instances = [];
    const client = createClient(); client.start();
    const socket = FakeSocket.instances[0]; socket.open();
    const invalid = client.query("question.list", { sessionId: "session-1", pageSize: 0 });
    const invalidCommand = socket.sent.at(-1) as { requestId: string };
    socket.serverMessage({ type: "error", requestId: invalidCommand.requestId, error: { code: "invalid_message", message: "invalid page size" } });
    await expect(invalid).rejects.toThrow("invalid page size");

    const disconnected = client.query("question.list", { sessionId: "session-1" });
    socket.close();
    await expect(disconnected).rejects.toThrow("disconnected");

    const restarted = createClient(); restarted.start(); const second = FakeSocket.instances.at(-1)!; second.open();
    const stopped = restarted.query("question.list", { sessionId: "session-1" });
    restarted.stop();
    await expect(stopped).rejects.toThrow("stopped");
  });
  it("settles create receipts only from persistence evidence and survives lost ack through terminal replay", async () => {
    vi.useFakeTimers();
    FakeSocket.instances = [];
    const client = createClient({ registration: { ...registration, session: { ...registration.session, semanticState: "working" } } });
    client.start();
    const first = FakeSocket.instances[0];
    first.open();
    const receipt = client.createAsk({ ...askPayload, requestId: "ask-receipt" });
    let settled = false;
    void receipt.finally(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    first.close();
    await vi.advanceTimersByTimeAsync(100);
    const second = FakeSocket.instances[1];
    second.open();
    const replay = second.sent.find((value) => (value as { type?: string }).type === "ask.create") as { requestId: string };
    second.serverMessage({ type: "ask.resolved", requestId: replay.requestId, payload: {
      status: "answered", requestId: "ask-receipt", selectedValues: ["yes"], resolvedAt: "2026-06-03T00:00:01.000Z"
    } });
    await expect(receipt).resolves.toEqual({ questionId: "ask-receipt", revision: 1, status: "pending" });
    client.stop();
  });

  it("rejects create receipts on abort, stop, and correlated server rejection", async () => {
    FakeSocket.instances = [];
    const client = createClient({ registration: { ...registration, session: { ...registration.session, semanticState: "working" } } });
    client.start();
    const socket = FakeSocket.instances[0];
    socket.open();
    const alreadyAborted = new AbortController();
    alreadyAborted.abort();
    await expect(client.createAsk({ ...askPayload, requestId: "create-pre-abort" }, alreadyAborted.signal)).rejects.toThrow("aborted");
    const aborter = new AbortController();
    const aborted = client.createAsk({ ...askPayload, requestId: "create-abort" }, aborter.signal);
    aborter.abort();
    await expect(aborted).rejects.toThrow("aborted");

    const rejected = client.createAsk({ ...askPayload, requestId: "create-rejected" });
    const command = socket.sent.find((value) => (value as { payload?: { requestId?: string } }).payload?.requestId === "create-rejected") as { requestId: string };
    socket.serverMessage({ type: "error", requestId: command.requestId, error: { code: "ask_create_failed", message: "rejected" } });
    await expect(rejected).rejects.toThrow("rejected");

    const stopped = client.createAsk({ ...askPayload, requestId: "create-stop" });
    client.stop();
    await expect(stopped).rejects.toThrow("stopped");
  });

  it("correlates cancellation of an owner-wide wait and ignores a late result", async () => {
    FakeSocket.instances = [];
    const client = createClient(); client.start();
    const socket = FakeSocket.instances[0]!; socket.open();
    const controller = new AbortController();
    const waiting = client.waitForPostbox("session-1", controller.signal);
    const command = socket.sent.find((value) => (value as any).type === "postbox.wait") as any;
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    expect(socket.sent).toContainEqual({ type: "postbox.wait.cancel", requestId: expect.any(String), payload: { sessionId: "session-1", waitRequestId: command.requestId } });
    socket.serverMessage({ type: "postbox.wait.result", requestId: command.requestId, payload: { type: "answer" } });
    client.stop();
  });

  it("cancels the correlated server wait before stopping", async () => {
    FakeSocket.instances = [];
    const client = createClient(); client.start();
    const socket = FakeSocket.instances[0]!; socket.open();
    const waiting = client.waitForPostbox("session-1");
    const command = socket.sent.find((value) => (value as any).type === "postbox.wait") as any;
    client.stop();
    await expect(waiting).rejects.toThrow("stopped");
    expect(socket.sent).toContainEqual({ type: "postbox.wait.cancel", requestId: expect.any(String), payload: { sessionId: "session-1", waitRequestId: command.requestId } });
  });

  it("delivers each lightweight answer notification once and acknowledges replays", async () => {
    FakeSocket.instances = [];
    const notifications: unknown[] = [];
    const client = createClient({ onAnswerAvailable: (value) => notifications.push(value) });
    client.start();
    const socket = FakeSocket.instances[0];
    socket.open();
    const message = { type: "answer.available" as const, requestId: "notification-1", payload: {
      questionId: "question-1", question: "Ship?", answerId: "answer-1"
    } };
    socket.serverMessage(message);
    socket.serverMessage(message);
    await vi.waitFor(() => expect(notifications).toHaveLength(1));
    expect(notifications).toEqual([message.payload]);
    expect(socket.sent.filter((value) => (value as { type?: string }).type === "answer.available.ack")).toHaveLength(2);
    client.stop();
  });

  it("acks without re-emitting after a client crash before the server receives the first ack", async () => {
    FakeSocket.instances = [];
    const durable = new Set<string>();
    const inbox = {
      begin: async (answerId: string) => durable.has(answerId) ? "delivered" as const : "new" as const,
      markDelivered: async (answerId: string) => { durable.add(answerId); }
    };
    const firstNotifications: unknown[] = [];
    const first = createClient({ answerNotificationInbox: inbox, onAnswerAvailable: (value) => firstNotifications.push(value) });
    first.start();
    const firstSocket = FakeSocket.instances[0];
    firstSocket.open();
    const replay = { type: "answer.available" as const, requestId: "delivery-answer-crash", payload: {
      questionId: "question-crash", question: "Recover?", answerId: "answer-crash"
    } };
    firstSocket.serverMessage(replay);
    await vi.waitFor(() => expect(firstNotifications).toHaveLength(1));
    // Simulate the process dying after durable inbox write and UI delivery while
    // the server never receives the ack recorded by this fake transport.
    first.stop();

    const restartedNotifications: unknown[] = [];
    const restarted = createClient({ answerNotificationInbox: inbox, onAnswerAvailable: (value) => restartedNotifications.push(value) });
    restarted.start();
    const restartedSocket = FakeSocket.instances[1];
    restartedSocket.open();
    restartedSocket.serverMessage(replay);
    await vi.waitFor(() => expect(restartedSocket.sent.some((value) => (value as { type?: string }).type === "answer.available.ack")).toBe(true));
    expect(restartedNotifications).toEqual([]);
    restarted.stop();
  });

  it("replays pending delivery after crash-before-callback and after a throwing callback", async () => {
    FakeSocket.instances = [];
    const states = new Map<string, "pending" | "delivered">();
    const inbox = {
      begin: async (id: string) => states.get(id) ?? (states.set(id, "pending"), "new" as const),
      markDelivered: async (id: string) => { states.set(id, "delivered"); }
    };
    // Simulate a prior process that persisted receipt then crashed before callback.
    states.set("answer-pending", "pending");
    let calls = 0;
    const client = createClient({ answerNotificationInbox: inbox, onAnswerAvailable: () => {
      calls += 1;
      if (calls === 1) throw new Error("UI unavailable");
    } });
    client.start();
    const socket = FakeSocket.instances[0];
    socket.open();
    const message = { type: "answer.available" as const, requestId: "pending-command", payload: {
      questionId: "question-pending", question: "Retry?", answerId: "answer-pending"
    } };
    socket.serverMessage(message);
    await vi.waitFor(() => expect(calls).toBe(1));
    expect(states.get("answer-pending")).toBe("pending");
    expect(socket.sent.some((value) => (value as { type?: string }).type === "answer.available.ack")).toBe(false);
    socket.serverMessage(message);
    await vi.waitFor(() => expect(states.get("answer-pending")).toBe("delivered"));
    expect(calls).toBe(2);
    expect(socket.sent.some((value) => (value as { type?: string }).type === "answer.available.ack")).toBe(true);
    client.stop();
  });

  it("keeps owner-visible delivery exactly once across crash-after-callback-before-markDelivered", async () => {
    FakeSocket.instances = [];
    let state: "pending" | "delivered" | undefined;
    let failCommit = true;
    const inbox = {
      begin: async () => state ?? (state = "pending", "new" as const),
      markDelivered: async () => {
        if (failCommit) { failCommit = false; throw new Error("simulated crash before delivered commit"); }
        state = "delivered";
      }
    };
    const ownerVisible = new Set<string>();
    const client = createClient({
      answerNotificationInbox: inbox,
      onAnswerAvailable: (_notification, deliveryId) => { ownerVisible.add(deliveryId); }
    });
    client.start();
    const socket = FakeSocket.instances[0];
    socket.open();
    const message = { type: "answer.available" as const, requestId: "crash-seam", payload: {
      questionId: "question-seam", question: "Exactly once?", answerId: "answer-seam"
    } };
    socket.serverMessage(message);
    await vi.waitFor(() => expect(ownerVisible.size).toBe(1));
    expect(state).toBe("pending");
    socket.serverMessage(message);
    await vi.waitFor(() => expect(state).toBe("delivered"));
    expect(ownerVisible).toEqual(new Set(["answer-seam"]));
    expect(socket.sent.some((value) => (value as { type?: string }).type === "answer.available.ack")).toBe(true);
    client.stop();
  });
  it("status snapshot enriches a real connected local client with Tailnet URL, remote export, and Tailscale diagnostics", async () => {
    FakeSocket.instances = [];
    const inspectTailscale = vi.fn(async () => ({
      state: "served",
      httpsPort: 32187,
      tailnetUrl: TAILNET_POSTBOX_URL,
      diagnostic: "Tailscale Serve points at this Postbox instance."
    }));
    const client = createClient({
      serverUrl: LOCAL_POSTBOX_URL,
      targetSource: "active-local",
      targetProfile: { kind: "production", id: "production" },
      inspectTailscale
    });
    client.start();
    FakeSocket.instances[0].open();

    const snapshot = await client.getStatusSnapshot({ enabled: true, startedByThisSession: true });

    expect(inspectTailscale).toHaveBeenCalledWith({
      localUrl: LOCAL_POSTBOX_URL,
      profile: { kind: "production", id: "production" }
    });
    expect(snapshot).toMatchObject({
      connection: {
        state: "connected",
        activeUrl: LOCAL_POSTBOX_URL,
        localUrl: LOCAL_POSTBOX_URL,
        tailnetUrl: TAILNET_POSTBOX_URL
      },
      remoteConfig: `export PI_POSTBOX_URL=${TAILNET_POSTBOX_URL}`,
      autostart: { enabled: true, startedByThisSession: true },
      tailscale: {
        state: "served",
        diagnostic: "Tailscale Serve points at this Postbox instance.",
        httpsPort: 32187
      }
    });
    expect(snapshot.diagnostics).toContain("tailscale:served:Tailscale Serve points at this Postbox instance.");
    client.stop();
  });

  it("status snapshot preserves socket error and close diagnostics for a disconnected registered client", async () => {
    FakeSocket.instances = [];
    const client = createClient({ reconnect: false });
    client.start();
    const socket = FakeSocket.instances[0];
    socket.open();

    socket.fail(new Error("ECONNRESET while reading Postbox websocket"));
    socket.close();
    const snapshot = await client.getStatusSnapshot();
    const formatted = formatPostboxStatusSnapshot(snapshot);

    expect(snapshot.connection.state).toBe("disconnected");
    expect(snapshot.diagnostics).toEqual(
      expect.arrayContaining(["socket-error:ECONNRESET while reading Postbox websocket", "websocket:disconnected"])
    );
    expect(formatted).toContain("Diagnostics:");
    expect(formatted).not.toContain("Diagnostics: none");
    client.stop();
  });

  it("does not create a pending ask when the abort signal is already aborted", async () => {
    FakeSocket.instances = [];
    const client = createClient();
    client.start();
    const socket = FakeSocket.instances[0];
    socket.open();
    const controller = new AbortController();
    controller.abort();

    await expect(client.ask({ ...askPayload, requestId: "ask-aborted" }, controller.signal)).rejects.toThrow("aborted");

    expect(client.listPendingAsks()).toEqual([]);
    expect(socket.sent).toEqual([expect.objectContaining({ type: "session.register" })]);
    client.stop();
  });

  it("cancels the server-side ask when the agent aborts a sent ask_postbox call", async () => {
    FakeSocket.instances = [];
    const client = createClient();
    client.start();
    const socket = FakeSocket.instances[0];
    socket.open();
    const controller = new AbortController();

    const askPromise = client.ask({ ...askPayload, requestId: "ask-abort-cancel" }, controller.signal);
    expect(socket.sent).toEqual([
      expect.objectContaining({ type: "session.register" }),
      expect.objectContaining({ type: "ask.create", payload: expect.objectContaining({ requestId: "ask-abort-cancel" }) })
    ]);

    controller.abort();
    await expect(askPromise).rejects.toThrow("aborted");

    expect(socket.sent.slice(2)).toEqual([
      expect.objectContaining({ type: "ask.create", payload: expect.objectContaining({ requestId: "ask-abort-cancel" }) }),
      expect.objectContaining({
        type: "ask.cancel",
        payload: expect.objectContaining({
          requestId: "ask-abort-cancel",
          cancel: expect.objectContaining({ note: expect.stringContaining("stopped waiting") })
        })
      })
    ]);
    expect(client.listPendingAsks()).toEqual([]);
    client.stop();
  });

  it("does not send a cancel for an aborted ask that never reached a server", async () => {
    FakeSocket.instances = [];
    const client = createClient();
    client.start();
    const socket = FakeSocket.instances[0];
    const controller = new AbortController();

    const askPromise = client.ask({ ...askPayload, requestId: "ask-abort-unsent" }, controller.signal);
    controller.abort();
    await expect(askPromise).rejects.toThrow("aborted");

    socket.open();

    expect(socket.sent).toEqual([expect.objectContaining({ type: "session.register" })]);
    expect(client.listPendingAsks()).toEqual([]);
    client.stop();
  });

  it("does not publish disconnect status or reconnect after being stopped", async () => {
    vi.useFakeTimers();
    FakeSocket.instances = [];
    const statuses: string[] = [];
    const client = createClient({ onStatus: (status) => statuses.push(status) });
    client.start();
    const socket = FakeSocket.instances[0];
    socket.open();
    expect(statuses).toEqual(["connected"]);

    statuses.length = 0;
    client.stop();
    await vi.advanceTimersByTimeAsync(100);

    expect(statuses).toEqual([]);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("keeps a pending ask through disconnect, reconnects, and replays the same request id", async () => {
    vi.useFakeTimers();
    FakeSocket.instances = [];
    const client = createClient();
    client.start();
    const firstSocket = FakeSocket.instances[0];
    firstSocket.open();

    const askPromise = client.ask(askPayload);
    expect(firstSocket.sent).toEqual([
      expect.objectContaining({ type: "session.register" }),
      expect.objectContaining({ type: "ask.create", payload: expect.objectContaining({ requestId: "ask-replay" }) })
    ]);

    firstSocket.close();
    await vi.advanceTimersByTimeAsync(100);
    const secondSocket = FakeSocket.instances[1];
    secondSocket.open();

    expect(secondSocket.sent).toEqual([
      expect.objectContaining({ type: "session.register" }),
      expect.objectContaining({ type: "ask.create", payload: expect.objectContaining({ requestId: "ask-replay" }) })
    ]);

    const result: AskResult = {
      status: "answered",
      requestId: "ask-replay",
      selectedValues: ["yes"],
      resolvedAt: "2026-06-03T00:00:01.000Z"
    };
    secondSocket.serverMessage({ type: "ask.resolved", requestId: "ask-replay", payload: result });
    await expect(askPromise).resolves.toEqual(result);
    client.stop();
  });

  it("retargets a connected active-local client when the selected target changes and no work is pinned", async () => {
    vi.useFakeTimers();
    FakeSocket.instances = [];
    const productionUrl = "http://127.0.0.1:32187/";
    const devUrl = "http://127.0.0.1:3500/";
    let currentTarget = selectedTarget(productionUrl, "production", "prod-instance");
    const resolveTarget = vi.fn(async () => currentTarget);
    const client = createClient({
      serverUrl: productionUrl,
      resolveTarget,
      profilePollMs: 50
    } as never);
    client.start();
    const productionSocket = FakeSocket.instances[0];
    productionSocket.open();

    currentTarget = selectedTarget(devUrl, "dev", "dev-instance");
    await vi.advanceTimersByTimeAsync(50);

    expect(productionSocket.readyState).toBe(FakeSocket.CLOSED);
    expect(FakeSocket.instances).toHaveLength(2);
    const devSocket = FakeSocket.instances[1];
    expect(devSocket.url).toBe(socketUrl(devUrl));

    devSocket.open();
    const devRegisters = devSocket.sent.filter((message) => (message as { type?: string }).type === "session.register");
    expect(devRegisters).toHaveLength(1);
    expect(devRegisters[0]).toMatchObject({
      payload: { session: { sessionId: "session-1", semanticState: "blocked" } }
    });
    client.stop();
  });

  it("resolves the active-local target before reconnecting instead of redialing a stale local URL", async () => {
    vi.useFakeTimers();
    FakeSocket.instances = [];
    const staleUrl = "http://127.0.0.1:32187/";
    const restartedUrl = "http://127.0.0.1:32188/";
    let currentTarget = selectedTarget(staleUrl, "production", "old-prod");
    const resolveTarget = vi.fn(async () => currentTarget);
    const client = createClient({ serverUrl: staleUrl, resolveTarget, reconnectMs: 100 } as never);
    client.start();
    const staleSocket = FakeSocket.instances[0];
    staleSocket.open();

    currentTarget = selectedTarget(restartedUrl, "production", "new-prod");
    staleSocket.close();
    await vi.advanceTimersByTimeAsync(100);

    expect(FakeSocket.instances).toHaveLength(2);
    expect(FakeSocket.instances[1].url).toBe(socketUrl(restartedUrl));
    client.stop();
  });

  it("does not poll or retarget explicit remote clients toward fresh local targets", async () => {
    vi.useFakeTimers();
    FakeSocket.instances = [];
    const remoteUrl = "https://postbox.example/";
    const resolveTarget = vi.fn(async () => selectedTarget("http://127.0.0.1:3500/", "dev", "dev-instance"));
    const client = createClient({
      serverUrl: remoteUrl,
      resolveTarget,
      profilePollMs: 25,
      profilePollingEnabled: false
    } as never);
    client.start();
    const remoteSocket = FakeSocket.instances[0];
    remoteSocket.open();

    await vi.advanceTimersByTimeAsync(100);

    expect(resolveTarget).not.toHaveBeenCalled();
    expect(FakeSocket.instances).toHaveLength(1);
    expect(remoteSocket.url).toBe(socketUrl(remoteUrl));
    client.stop();
  });

  it("returns a structured unavailable result when an ask cannot be sent before the unavailable timeout", async () => {
    vi.useFakeTimers();
    FakeSocket.instances = [];
    const client = createClient({ reconnect: false, askUnavailableAfterMs: 250 });
    client.start();

    const askPromise = client.ask({ ...askPayload, requestId: "ask-unavailable", expiresAt: undefined });
    await vi.advanceTimersByTimeAsync(250);

    await expect(askPromise).resolves.toMatchObject({
      status: "unavailable",
      requestId: "ask-unavailable",
      rationale: expect.stringContaining("unavailable")
    });
    client.stop();
  });

  it("returns a structured expired result locally if a pending wait passes its expiresAt while disconnected", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-03T00:00:00.000Z"));
    FakeSocket.instances = [];
    const client = createClient({ askUnavailableAfterMs: 10_000 });
    client.start();
    const socket = FakeSocket.instances[0];
    socket.open();

    const askPromise = client.ask({ ...askPayload, requestId: "ask-local-expire", expiresAt: "2026-06-03T00:00:00.500Z" });
    socket.close();
    await vi.advanceTimersByTimeAsync(500);

    await expect(askPromise).resolves.toMatchObject({ status: "expired", requestId: "ask-local-expire" });
    client.stop();
  });
});
