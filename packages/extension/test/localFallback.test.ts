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
});
