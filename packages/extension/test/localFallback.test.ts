import type { AskCreatePayload, AskResult, ExtensionServerMessage, SessionRegisterPayload } from "@pi-postbox/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PostboxClient } from "../src/client/PostboxClient.js";
import { registerPostboxFallbackCommands } from "../src/commands/localFallback.js";

const registration: SessionRegisterPayload = {
  machine: { machineId: "machine-1", hostname: "workstation" },
  project: { projectId: "project-1", name: "pi-postbox", cwd: "/repo" },
  session: { sessionId: "session-1", cwd: "/repo", semanticState: "blocked" }
};

const askPayload: AskCreatePayload = {
  requestId: "ask-local",
  sessionId: "session-1",
  mode: "single",
  question: { prompt: "Choose locally?" },
  options: [
    { value: "yes", label: "Yes" },
    { value: "no", label: "No" }
  ]
};

class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 0;
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
    this.readyState = 3;
    this.emit("close");
  }

  open(): void {
    this.readyState = 1;
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
    askUnavailableAfterMs: 10_000,
    WebSocketImpl: FakeSocket as never,
    ...options
  });
}

function selectedTarget(url: string, role: "dev" | "production" = "dev", instanceId = `${role}-instance`) {
  return {
    status: "selected" as const,
    target: {
      source: "active-local" as const,
      url,
      role,
      instanceId,
      activeLocalPollingEnabled: true
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

function messagesOfType(socket: FakeSocket, type: string): unknown[] {
  return socket.sent.filter((message) => (message as { type?: string }).type === type);
}

class FakePi {
  commands = new Map<string, { description?: string; handler: (args: string, ctx: FakeCommandContext) => unknown }>();

  registerCommand(name: string, command: { description?: string; handler: (args: string, ctx: FakeCommandContext) => unknown }): void {
    this.commands.set(name, command);
  }
}

interface FakeCommandContext {
  ui: { notify: (message: string, level?: string) => void };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("local Postbox fallback", () => {
  it("shows compact local status and lets a local answer resolve the waiting ask while connected", async () => {
    FakeSocket.instances = [];
    const statuses: string[] = [];
    const client = createClient({ onLocalFallbackStatus: (status) => statuses.push(status?.message ?? "cleared") });
    client.start();
    const socket = FakeSocket.instances[0];
    socket.open();

    const wait = client.ask(askPayload);
    expect(statuses.at(-1)).toContain("/postbox-answer ask-local");
    expect(client.listPendingAsks()).toEqual([expect.objectContaining({ requestId: "ask-local", prompt: "Choose locally?" })]);

    const result = client.answerPendingAsk({ requestId: "ask-local", selectedValues: ["yes"], note: "Answered in terminal" });

    await expect(wait).resolves.toEqual(result);
    expect(result).toMatchObject({ status: "answered", requestId: "ask-local", selectedValues: ["yes"], note: "Answered in terminal" });
    expect(statuses.at(-1)).toBe("cleared");
    expect(socket.sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "ask.create", payload: expect.objectContaining({ requestId: "ask-local" }) }),
        expect.objectContaining({
          type: "ask.answer",
          payload: { requestId: "ask-local", answer: { selectedValues: ["yes"], note: "Answered in terminal" } }
        })
      ])
    );
    client.stop();
  });

  it("registers local answer and cancel commands that resolve the active ask with concise results", async () => {
    const fakePi = new FakePi();
    const notifications: string[] = [];
    const results: AskResult[] = [];
    const fakeClient = {
      listPendingAsks: () => [
        {
          requestId: "ask-command",
          prompt: "Command fallback?",
          mode: "single" as const,
          options: [{ value: "yes", label: "Yes" }],
          sentAtLeastOnce: true,
          expiresAt: undefined
        }
      ],
      answerPendingAsk: (input: { requestId?: string; selectedValues: string[]; note?: string; rationale?: string }) => {
        const result: AskResult = {
          status: "answered",
          requestId: input.requestId ?? "ask-command",
          selectedValues: input.selectedValues,
          note: input.note,
          rationale: input.rationale,
          resolvedAt: "2026-06-03T00:00:00.000Z"
        };
        results.push(result);
        return result;
      },
      cancelPendingAsk: (input: { requestId?: string; note?: string; rationale?: string }) => {
        const result: AskResult = {
          status: "cancelled",
          requestId: input.requestId ?? "ask-command",
          note: input.note,
          rationale: input.rationale,
          resolvedAt: "2026-06-03T00:00:01.000Z"
        };
        results.push(result);
        return result;
      }
    };
    registerPostboxFallbackCommands(fakePi, () => fakeClient);
    const ctx: FakeCommandContext = { ui: { notify: (message) => notifications.push(message) } };

    await fakePi.commands.get("postbox-answer")?.handler("yes --note terminal choice --rationale fastest", ctx);
    await fakePi.commands.get("postbox-cancel")?.handler("ask-command --note stop here", ctx);

    expect(results).toEqual([
      expect.objectContaining({ status: "answered", selectedValues: ["yes"], note: "terminal choice", rationale: "fastest" }),
      expect.objectContaining({ status: "cancelled", requestId: "ask-command", note: "stop here" })
    ]);
    expect(notifications).toEqual([expect.stringContaining("Postbox answered ask-command"), expect.stringContaining("Postbox cancelled ask-command")]);
  });

  it("resolves locally while offline and reconciles the answer after reconnect", async () => {
    vi.useFakeTimers();
    FakeSocket.instances = [];
    const client = createClient({ askUnavailableAfterMs: 10_000 });
    client.start();
    const firstSocket = FakeSocket.instances[0];

    const wait = client.ask({ ...askPayload, requestId: "ask-offline" });
    const result = client.answerPendingAsk({ requestId: "ask-offline", selectedValues: ["yes"], note: "offline" });
    await expect(wait).resolves.toEqual(result);

    firstSocket.close();
    await vi.advanceTimersByTimeAsync(100);
    const reconnectSocket = FakeSocket.instances[1];
    reconnectSocket.open();

    expect(reconnectSocket.sent).toEqual([
      expect.objectContaining({ type: "session.register" }),
      expect.objectContaining({ type: "ask.create", payload: expect.objectContaining({ requestId: "ask-offline" }) }),
      expect.objectContaining({
        type: "ask.answer",
        payload: { requestId: "ask-offline", answer: { selectedValues: ["yes"], note: "offline" } }
      })
    ]);
    client.stop();
  });

  it("defers active-local switching while a sent ask is unresolved and never duplicates it to the new target", async () => {
    vi.useFakeTimers();
    FakeSocket.instances = [];
    const productionUrl = "http://127.0.0.1:32187/";
    const devUrl = "http://127.0.0.1:3500/";
    let currentTarget = selectedTarget(productionUrl, "production", "prod-instance");
    const resolveTarget = vi.fn(async () => currentTarget);
    const statuses: string[] = [];
    const localStatuses: string[] = [];
    const client = createClient({
      serverUrl: productionUrl,
      resolveTarget,
      activeLocalPollMs: 25,
      targetAffinityTimeoutMs: 5_000,
      onStatus: (status) => statuses.push(status),
      onLocalFallbackStatus: (status) => localStatuses.push(status?.message ?? "cleared")
    } as never);
    client.start();
    const productionSocket = FakeSocket.instances[0];
    productionSocket.open();

    const wait = client.ask({ ...askPayload, requestId: "ask-pinned" });
    expect(messagesOfType(productionSocket, "ask.create")).toHaveLength(1);

    currentTarget = selectedTarget(devUrl, "dev", "dev-instance");
    await vi.advanceTimersByTimeAsync(25);

    expect(FakeSocket.instances).toHaveLength(1);
    expect(statuses.some((status) => status.includes("deferred") && status.includes("3500"))).toBe(true);
    expect(localStatuses.at(-1)).toContain("ask-pinned");
    expect(messagesOfType(productionSocket, "ask.create")).toHaveLength(1);

    const result: AskResult = {
      status: "answered",
      requestId: "ask-pinned",
      selectedValues: ["yes"],
      resolvedAt: "2026-06-03T00:00:01.000Z"
    };
    productionSocket.serverMessage({ type: "ask.resolved", requestId: "ask-pinned", payload: result });
    await expect(wait).resolves.toEqual(result);

    await vi.advanceTimersByTimeAsync(25);
    expect(FakeSocket.instances).toHaveLength(2);
    const devSocket = FakeSocket.instances[1];
    expect(devSocket.url).toBe(socketUrl(devUrl));
    devSocket.open();
    expect(messagesOfType(devSocket, "session.register")).toHaveLength(1);
    expect(messagesOfType(devSocket, "ask.create")).toHaveLength(0);
    client.stop();
  });

  it("lets an unsent queued ask follow a target switch and sends it only to the new target", async () => {
    vi.useFakeTimers();
    FakeSocket.instances = [];
    const productionUrl = "http://127.0.0.1:32187/";
    const devUrl = "http://127.0.0.1:3500/";
    let currentTarget = selectedTarget(productionUrl, "production", "prod-instance");
    const resolveTarget = vi.fn(async () => currentTarget);
    const client = createClient({ serverUrl: productionUrl, resolveTarget, reconnectMs: 100 } as never);
    client.start();
    const productionSocket = FakeSocket.instances[0];

    const wait = client.ask({ ...askPayload, requestId: "ask-unsent" });
    wait.catch(() => undefined);
    expect(messagesOfType(productionSocket, "ask.create")).toHaveLength(0);

    currentTarget = selectedTarget(devUrl, "dev", "dev-instance");
    productionSocket.close();
    await vi.advanceTimersByTimeAsync(100);

    expect(FakeSocket.instances).toHaveLength(2);
    const devSocket = FakeSocket.instances[1];
    expect(devSocket.url).toBe(socketUrl(devUrl));
    devSocket.open();

    expect(messagesOfType(productionSocket, "ask.create")).toHaveLength(0);
    expect(messagesOfType(devSocket, "session.register")).toHaveLength(1);
    expect(messagesOfType(devSocket, "ask.create")).toHaveLength(1);
    expect(messagesOfType(devSocket, "ask.create")[0]).toMatchObject({ payload: { requestId: "ask-unsent" } });
    client.stop();
  });

  it("pins offline local fallback answers to their origin target before switching away", async () => {
    vi.useFakeTimers();
    FakeSocket.instances = [];
    const productionUrl = "http://127.0.0.1:32187/";
    const devUrl = "http://127.0.0.1:3500/";
    let currentTarget = selectedTarget(productionUrl, "production", "prod-instance");
    const resolveTarget = vi.fn(async () => currentTarget);
    const statuses: string[] = [];
    const client = createClient({
      serverUrl: productionUrl,
      resolveTarget,
      activeLocalPollMs: 25,
      reconnectMs: 100,
      onStatus: (status) => statuses.push(status)
    } as never);
    client.start();
    const productionSocket = FakeSocket.instances[0];
    productionSocket.open();

    const wait = client.ask({ ...askPayload, requestId: "ask-local-origin" });
    productionSocket.close();
    const result = client.answerPendingAsk({ requestId: "ask-local-origin", selectedValues: ["yes"], note: "origin only" });
    await expect(wait).resolves.toEqual(result);

    currentTarget = selectedTarget(devUrl, "dev", "dev-instance");
    await vi.advanceTimersByTimeAsync(100);
    expect(FakeSocket.instances).toHaveLength(2);
    const originReconnectSocket = FakeSocket.instances[1];
    expect(originReconnectSocket.url).toBe(socketUrl(productionUrl));
    expect(statuses.some((status) => status.includes("deferred") && status.includes("3500"))).toBe(true);

    originReconnectSocket.open();
    expect(messagesOfType(originReconnectSocket, "ask.create")).toHaveLength(1);
    expect(messagesOfType(originReconnectSocket, "ask.answer")).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(25);
    expect(FakeSocket.instances).toHaveLength(3);
    expect(FakeSocket.instances[2].url).toBe(socketUrl(devUrl));
    client.stop();
  });

  it("releases a permanently dead pinned origin after a client-owned deadline and then may retarget", async () => {
    vi.useFakeTimers();
    FakeSocket.instances = [];
    const productionUrl = "http://127.0.0.1:32187/";
    const devUrl = "http://127.0.0.1:3500/";
    let currentTarget = selectedTarget(productionUrl, "production", "prod-instance");
    const resolveTarget = vi.fn(async () => currentTarget);
    const client = createClient({
      serverUrl: productionUrl,
      resolveTarget,
      activeLocalPollMs: 25,
      reconnectMs: 100,
      targetAffinityTimeoutMs: 250
    } as never);
    client.start();
    const productionSocket = FakeSocket.instances[0];
    productionSocket.open();

    const wait = client.ask({ ...askPayload, requestId: "ask-dead-origin", expiresAt: undefined });
    let settled: AskResult | undefined;
    wait.then((result) => {
      settled = result;
    });
    currentTarget = selectedTarget(devUrl, "dev", "dev-instance");
    productionSocket.close();

    await vi.advanceTimersByTimeAsync(250);

    expect(settled).toMatchObject({
      status: "unavailable",
      requestId: "ask-dead-origin",
      rationale: expect.stringMatching(/undeliverable|unavailable|dead origin/i)
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(FakeSocket.instances.at(-1)?.url).toBe(socketUrl(devUrl));
    client.stop();
  });

  it("releases an undeliverable offline local fallback resolution after the affinity deadline so retargeting can proceed", async () => {
    vi.useFakeTimers();
    FakeSocket.instances = [];
    const productionUrl = "http://127.0.0.1:32187/";
    const devUrl = "http://127.0.0.1:3500/";
    let currentTarget = selectedTarget(productionUrl, "production", "prod-instance");
    const resolveTarget = vi.fn(async () => currentTarget);
    const statuses: string[] = [];
    const client = createClient({
      serverUrl: productionUrl,
      resolveTarget,
      activeLocalPollMs: 25,
      reconnectMs: 100,
      targetAffinityTimeoutMs: 250,
      onStatus: (status) => statuses.push(status)
    } as never);
    client.start();
    const productionSocket = FakeSocket.instances[0];
    productionSocket.open();

    const wait = client.ask({ ...askPayload, requestId: "ask-local-dead-origin" });
    expect(messagesOfType(productionSocket, "ask.create")).toHaveLength(1);
    productionSocket.close();
    const localResult = client.answerPendingAsk({ requestId: "ask-local-dead-origin", selectedValues: ["yes"], note: "answered offline" });
    await expect(wait).resolves.toEqual(localResult);

    currentTarget = selectedTarget(devUrl, "dev", "dev-instance");
    await vi.advanceTimersByTimeAsync(100);

    expect(FakeSocket.instances).toHaveLength(2);
    expect(FakeSocket.instances[1].url).toBe(socketUrl(productionUrl));
    expect(messagesOfType(FakeSocket.instances[1], "ask.answer")).toHaveLength(0);
    expect(statuses.some((status) => status.includes("deferred") && status.includes("3500"))).toBe(true);

    await vi.advanceTimersByTimeAsync(150);

    expect(statuses.some((status) => status.includes("undeliverable") && status.includes("ask-local-dead-origin"))).toBe(true);
    expect(FakeSocket.instances.at(-1)?.url).toBe(socketUrl(devUrl));
    expect(FakeSocket.instances.at(-1)).not.toBe(FakeSocket.instances[1]);
    const devSocket = FakeSocket.instances.at(-1)!;
    devSocket.open();
    expect(messagesOfType(devSocket, "session.register")).toHaveLength(1);
    expect(messagesOfType(devSocket, "ask.create")).toHaveLength(0);
    expect(messagesOfType(devSocket, "ask.answer")).toHaveLength(0);
    client.stop();
  });
});
