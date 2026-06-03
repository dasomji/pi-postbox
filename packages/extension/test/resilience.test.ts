import type { AskCreatePayload, AskResult, ExtensionServerMessage, SessionRegisterPayload } from "@pi-postbox/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PostboxClient } from "../src/client/PostboxClient.js";

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
  options: [{ value: "yes", label: "Yes" }]
};

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

describe("PostboxClient pending ask resilience", () => {
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
