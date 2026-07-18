import type { AskCreatePayload, ExtensionServerMessage, SessionRegisterPayload } from "@pi-postbox/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PostboxClient } from "../src/client/PostboxClient.js";

const registration: SessionRegisterPayload = {
  machine: { machineId: "machine-chat", hostname: "workstation" },
  project: { projectId: "project-chat", name: "pi-postbox", cwd: "/repo" },
  session: { sessionId: "session-chat", cwd: "/repo", semanticState: "blocked" }
};

class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: unknown[] = [];
  private readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>();

  constructor() {
    FakeSocket.instances.push(this);
  }

  on(event: "open" | "close" | "error" | "message", listener: (...args: unknown[]) => void): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
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

beforeEach(() => {
  FakeSocket.instances = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("extension Question Chat commands", () => {
  it("activates the exact fork for its owning Postbox Session and returns ready", async () => {
    const questionChats = {
      activate: vi.fn(async ({ requestId }: { requestId: string }) => ({
        requestId,
        state: "ready" as const,
        forkKind: "exact" as const,
        model: { id: "test/source", source: "originating" as const },
        messages: [] as []
      })),
      activateContext: vi.fn(async ({ requestId }: { requestId: string }) => ({
        requestId,
        state: "ready" as const,
        forkKind: "context-only" as const,
        model: { id: "test/source", source: "originating" as const },
        messages: [] as []
      })),
      getSnapshot: vi.fn(async (requestId: string) => ({
        requestId,
        state: "ready" as const,
        forkKind: "exact" as const,
        model: { id: "test/source", source: "originating" as const },
        sequence: 7,
        messages: [{ id: "fork-user", role: "user" as const, text: "Earlier", status: "final" as const }]
      })),
      send: vi.fn(async (_requestId: string, command: { clientCommandId: string }) => ({
        status: "accepted" as const,
        clientCommandId: command.clientCommandId,
        mode: "prompt" as const
      })),
      stop: vi.fn(async (_requestId: string, command: { clientCommandId: string }) => ({
        status: "accepted" as const,
        clientCommandId: command.clientCommandId
      })),
      subscribe: vi.fn((_requestId: string, listener: (event: any) => void) => {
        listener({ requestId: "ask-chat", sequence: 8, type: "lifecycle", state: "generating" });
        return vi.fn();
      }),
      cleanup: vi.fn(async () => undefined)
    };
    const client = new PostboxClient({
      serverUrl: "http://postbox.local",
      registration,
      reconnect: false,
      heartbeatMs: 60_000,
      WebSocketImpl: FakeSocket as never,
      questionChats
    });
    client.start();
    const socket = FakeSocket.instances[0]!;
    socket.open();
    client.updateQuestionSource({ cwd: "/repo", agentSessionPath: "/source-at-question.jsonl", leafId: "leaf-at-question" });
    expect(socket.sent).toContainEqual({
      type: "session.update",
      payload: {
        sessionId: "session-chat",
        cwd: "/repo",
        agentSessionPath: "/source-at-question.jsonl",
        leafId: "leaf-at-question"
      }
    });

    socket.serverMessage({
      type: "chat.activate-context",
      requestId: "command-context-1",
      payload: {
        requestId: "ask-context",
        ownerSessionId: "session-chat",
        source: {
          cwd: "/repo",
          model: "anthropic/claude-sonnet-4",
          mode: "single",
          question: { prompt: "Which design?" },
          options: [{ value: "a", label: "A" }],
          context: { codebaseContext: "The extension client.", problemContext: "Explain the choice." }
        }
      }
    });
    await vi.waitFor(() => expect(questionChats.activateContext).toHaveBeenCalledWith({
      requestId: "ask-context",
      source: expect.objectContaining({
        cwd: "/repo",
        model: "anthropic/claude-sonnet-4",
        question: { prompt: "Which design?" }
      })
    }));
    expect(socket.sent).toContainEqual({
      type: "chat.ready",
      requestId: "command-context-1",
      payload: expect.objectContaining({ requestId: "ask-context", forkKind: "context-only" })
    });

    socket.serverMessage({
      type: "chat.activate",
      requestId: "command-1",
      payload: {
        requestId: "ask-chat",
        ownerSessionId: "session-chat",
        source: { agentSessionPath: "/source.jsonl", leafId: "leaf", cwd: "/repo" }
      }
    });

    await vi.waitFor(() => expect(questionChats.activate).toHaveBeenCalledOnce());
    expect(socket.sent).toContainEqual({
      type: "chat.ready",
      requestId: "command-1",
      payload: {
        requestId: "ask-chat",
        state: "ready",
        forkKind: "exact",
        model: { id: "test/source", source: "originating" },
        messages: []
      }
    });

    socket.serverMessage({
      type: "chat.snapshot",
      requestId: "snapshot-1",
      payload: { requestId: "ask-chat", ownerSessionId: "session-chat" }
    });
    socket.serverMessage({
      type: "chat.send",
      requestId: "send-1",
      payload: {
        requestId: "ask-chat",
        ownerSessionId: "session-chat",
        command: { clientCommandId: "browser-1", message: "Explain it" }
      }
    });
    socket.serverMessage({
      type: "chat.stop",
      requestId: "stop-1",
      payload: {
        requestId: "ask-chat",
        ownerSessionId: "session-chat",
        command: { clientCommandId: "browser-stop-1" }
      }
    });
    await vi.waitFor(() => expect(questionChats.send).toHaveBeenCalledWith("ask-chat", { clientCommandId: "browser-1", message: "Explain it" }));
    await vi.waitFor(() => expect(questionChats.stop).toHaveBeenCalledWith("ask-chat", { clientCommandId: "browser-stop-1" }));
    expect(socket.sent).toContainEqual({
      type: "chat.snapshot",
      requestId: "snapshot-1",
      payload: expect.objectContaining({ requestId: "ask-chat", sequence: 7, messages: [expect.objectContaining({ text: "Earlier" })] })
    });
    expect(socket.sent).toContainEqual({
      type: "chat.send.accepted",
      requestId: "send-1",
      payload: { requestId: "ask-chat", response: { status: "accepted", clientCommandId: "browser-1", mode: "prompt" } }
    });
    expect(socket.sent).toContainEqual({
      type: "chat.stop.accepted",
      requestId: "stop-1",
      payload: { requestId: "ask-chat", response: { status: "accepted", clientCommandId: "browser-stop-1" } }
    });
    expect(socket.sent).toContainEqual({
      type: "chat.event",
      payload: { requestId: "ask-chat", sequence: 8, type: "lifecycle", state: "generating" }
    });

    socket.serverMessage({ type: "chat.cleanup", payload: { requestId: "ask-chat", reason: "answered" } });
    await vi.waitFor(() => expect(questionChats.cleanup).toHaveBeenCalledWith("ask-chat"));
    client.stop();
  });

  it("rejects a command routed to a different Postbox Session", async () => {
    const questionChats = {
      activate: vi.fn(),
      activateContext: vi.fn(),
      getSnapshot: vi.fn(),
      send: vi.fn(),
      stop: vi.fn(),
      subscribe: vi.fn(),
      cleanup: vi.fn()
    };
    const client = new PostboxClient({
      serverUrl: "http://postbox.local",
      registration,
      reconnect: false,
      heartbeatMs: 60_000,
      WebSocketImpl: FakeSocket as never,
      questionChats
    });
    client.start();
    const socket = FakeSocket.instances[0]!;
    socket.open();
    socket.serverMessage({
      type: "chat.activate",
      requestId: "command-wrong-owner",
      payload: {
        requestId: "ask-chat",
        ownerSessionId: "another-session",
        source: { agentSessionPath: "/source.jsonl", leafId: "leaf", cwd: "/repo" }
      }
    });

    await vi.waitFor(() =>
      expect(socket.sent).toContainEqual({
        type: "chat.error",
        requestId: "command-wrong-owner",
        payload: {
          requestId: "ask-chat",
          error: { code: "wrong_owner", message: "Question Chat activation was routed to the wrong Pi Session." }
        }
      })
    );
    expect(questionChats.activate).not.toHaveBeenCalled();
    client.stop();
  });

  it("registers the latest question-time source before replaying an ask after reconnect", async () => {
    vi.useFakeTimers();
    const client = new PostboxClient({
      serverUrl: "http://postbox.local",
      registration: structuredClone(registration),
      reconnectMs: 5,
      reconnectMaxMs: 5,
      heartbeatMs: 60_000,
      askUnavailableAfterMs: 60_000,
      WebSocketImpl: FakeSocket as never
    });
    client.start();
    const firstSocket = FakeSocket.instances[0]!;
    firstSocket.open();
    firstSocket.close();

    client.updateQuestionSource({ cwd: "/repo", agentSessionPath: "/question-time.jsonl", leafId: "question-leaf" });
    const ask: AskCreatePayload = {
      requestId: "ask-reconnect-source",
      sessionId: "session-chat",
      mode: "single",
      question: { prompt: "Which source?" },
      options: [{ value: "a", label: "A" }],
      context: { codebaseContext: "Pi extension client.", problemContext: "Preserve the exact question leaf." }
    };
    const pending = client.ask(ask);
    void pending.catch(() => undefined);

    await vi.advanceTimersByTimeAsync(5);
    const secondSocket = FakeSocket.instances.at(-1)!;
    secondSocket.open();
    expect(secondSocket.sent.map((message) => (message as { type: string }).type).slice(0, 2)).toEqual([
      "session.register",
      "ask.create"
    ]);
    expect(secondSocket.sent[0]).toMatchObject({
      type: "session.register",
      payload: {
        session: { agentSessionPath: "/question-time.jsonl", leafId: "question-leaf" }
      }
    });
    client.stop();
  });
});
