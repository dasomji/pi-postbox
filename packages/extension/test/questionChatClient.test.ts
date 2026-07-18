import type { AskCreatePayload, ExtensionServerMessage, SessionRegisterPayload } from "@pi-postbox/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PostboxClient } from "../src/client/PostboxClient.js";
import { QuestionChatRuntimeRegistry } from "../src/questionChatRuntime.js";

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
  it("shares one SDK runtime across concurrent browser activations with different relay command IDs", async () => {
    let finishCreate!: (runtime: any) => void;
    const runtime = {
      snapshot: {
        requestId: "ask-shared-runtime",
        state: "ready" as const,
        forkKind: "exact" as const,
        model: { id: "test/model", source: "originating" as const },
        sequence: 0,
        messages: []
      },
      send: vi.fn(),
      stop: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
      terminate: vi.fn(async () => undefined),
      suspend: vi.fn(async () => undefined)
    };
    const create = vi.fn(() => new Promise<any>((resolve) => {
      finishCreate = resolve;
    }));
    const registry = new QuestionChatRuntimeRegistry({ create, createContext: vi.fn() } as any);
    const client = new PostboxClient({
      serverUrl: "http://postbox.local",
      registration,
      reconnect: false,
      heartbeatMs: 60_000,
      WebSocketImpl: FakeSocket as never,
      questionChats: registry
    });
    client.start();
    const socket = FakeSocket.instances[0]!;
    socket.open();

    const payload = {
      requestId: "ask-shared-runtime",
      ownerSessionId: "session-chat",
      source: { agentSessionPath: "/source.jsonl", leafId: "leaf", cwd: "/repo" }
    };
    socket.serverMessage({ type: "chat.activate", requestId: "browser-activation-a", payload });
    socket.serverMessage({ type: "chat.activate", requestId: "browser-activation-b", payload });

    await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
    finishCreate(runtime);
    await vi.waitFor(() => {
      expect(socket.sent.filter((message: any) => message.type === "chat.ready")).toEqual(expect.arrayContaining([
        expect.objectContaining({ requestId: "browser-activation-a" }),
        expect.objectContaining({ requestId: "browser-activation-b" })
      ]));
    });
    client.stop();
  });

  it("correlates proposal replies by command and Question while ignoring mismatched and late replies", async () => {
    const client = new PostboxClient({
      serverUrl: "http://postbox.local",
      registration,
      reconnect: false,
      heartbeatMs: 60_000,
      proposalTimeoutMs: 5_000,
      WebSocketImpl: FakeSocket as never
    });
    client.start();
    const socket = FakeSocket.instances[0]!;
    socket.open();

    let settled = false;
    const pending = client.proposeAnswer("ask-proposal", { label: "Stage first" }).then((result) => {
      settled = true;
      return result;
    });
    const command = socket.sent.find((message: any) => message.type === "chat.propose-answer") as any;
    expect(command).toMatchObject({
      type: "chat.propose-answer",
      requestId: expect.any(String),
      payload: { requestId: "ask-proposal", proposal: { label: "Stage first" } }
    });

    socket.serverMessage({
      type: "chat.propose-answer.result",
      requestId: command.requestId,
      payload: {
        requestId: "another-question",
        result: { status: "appended", option: { value: "chat_wrong", label: "Wrong", provenance: "chat" } }
      }
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    socket.serverMessage({
      type: "chat.propose-answer.result",
      requestId: command.requestId,
      payload: {
        requestId: "ask-proposal",
        result: { status: "appended", option: { value: "chat_right", label: "Stage first", provenance: "chat" } }
      }
    });
    await expect(pending).resolves.toEqual({
      status: "appended",
      option: { value: "chat_right", label: "Stage first", provenance: "chat" }
    });

    socket.serverMessage({
      type: "chat.propose-answer.result",
      requestId: command.requestId,
      payload: {
        requestId: "ask-proposal",
        result: { status: "error", error: { code: "request_terminal", message: "Late." } }
      }
    });
    client.stop();
  });

  it("bounds proposal waits and clears them on timeout, abort, socket close, and stop", async () => {
    vi.useFakeTimers();
    const client = new PostboxClient({
      serverUrl: "http://postbox.local",
      registration,
      reconnect: false,
      heartbeatMs: 60_000,
      proposalTimeoutMs: 25,
      WebSocketImpl: FakeSocket as never
    });
    client.start();
    const socket = FakeSocket.instances[0]!;
    socket.open();

    const timedOut = client.proposeAnswer("ask-timeout", { label: "Stage first" });
    await vi.advanceTimersByTimeAsync(25);
    await expect(timedOut).resolves.toMatchObject({
      status: "error",
      error: { code: "internal_error", message: expect.stringContaining("timed out") }
    });

    const controller = new AbortController();
    const aborted = client.proposeAnswer("ask-abort", { label: "Stage first" }, controller.signal);
    controller.abort();
    await expect(aborted).resolves.toMatchObject({ status: "error", error: { code: "internal_error" } });

    const disconnected = client.proposeAnswer("ask-close", { label: "Stage first" });
    socket.close();
    await expect(disconnected).resolves.toMatchObject({
      status: "error",
      error: { code: "internal_error", message: expect.stringContaining("disconnected") }
    });
    client.stop();
  });

  it("makes terminal cleanup invalidate live ownership, pending commands, proposals, and late results", async () => {
    let finishSend!: (response: { status: "accepted"; clientCommandId: string; mode: "prompt" }) => void;
    const snapshot = {
      requestId: "ask-terminal-client",
      state: "ready" as const,
      forkKind: "exact" as const,
      model: { id: "test/model", source: "originating" as const },
      sequence: 0,
      messages: []
    };
    const questionChats = {
      activate: vi.fn(async () => snapshot),
      activateContext: vi.fn(),
      getSnapshot: vi.fn(async () => snapshot),
      send: vi.fn(() => new Promise<{ status: "accepted"; clientCommandId: string; mode: "prompt" }>((resolve) => {
        finishSend = resolve;
      })),
      stop: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
      cleanup: vi.fn(async () => undefined)
    };
    const client = new PostboxClient({
      serverUrl: "http://postbox.local",
      registration,
      reconnect: false,
      heartbeatMs: 60_000,
      proposalTimeoutMs: 25,
      WebSocketImpl: FakeSocket as never,
      questionChats
    });
    client.start();
    const socket = FakeSocket.instances[0]!;
    socket.open();
    socket.serverMessage({
      type: "chat.activate",
      requestId: "activate-terminal-client",
      payload: {
        requestId: snapshot.requestId,
        ownerSessionId: "session-chat",
        source: { agentSessionPath: "/source.jsonl", leafId: "leaf", cwd: "/repo" }
      }
    });
    await vi.waitFor(() => expect(socket.sent).toContainEqual({
      type: "chat.ready",
      requestId: "activate-terminal-client",
      payload: snapshot
    }));

    const proposal = client.proposeAnswer(snapshot.requestId, { label: "Too late" });
    socket.serverMessage({
      type: "chat.send",
      requestId: "send-terminal-client",
      payload: {
        requestId: snapshot.requestId,
        ownerSessionId: "session-chat",
        command: { clientCommandId: "browser-terminal", message: "Explain" }
      }
    });
    await vi.waitFor(() => expect(questionChats.send).toHaveBeenCalledOnce());

    socket.serverMessage({
      type: "chat.cleanup",
      payload: { requestId: snapshot.requestId, reason: "answered" }
    });
    await vi.waitFor(() => expect(questionChats.cleanup).toHaveBeenCalledWith(snapshot.requestId));
    await expect(proposal).resolves.toMatchObject({
      status: "error",
      error: { code: "request_terminal" }
    });

    finishSend({ status: "accepted", clientCommandId: "browser-terminal", mode: "prompt" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(socket.sent).not.toContainEqual(expect.objectContaining({
      type: "chat.send.accepted",
      requestId: "send-terminal-client"
    }));

    socket.serverMessage({
      type: "chat.send",
      requestId: "send-after-terminal",
      payload: {
        requestId: snapshot.requestId,
        ownerSessionId: "session-chat",
        command: { clientCommandId: "browser-after-terminal", message: "Must not run" }
      }
    });
    await vi.waitFor(() => expect(socket.sent).toContainEqual({
      type: "chat.error",
      requestId: "send-after-terminal",
      payload: {
        requestId: snapshot.requestId,
        error: { code: "request_not_pending", message: "The Postbox Question is already terminal." }
      }
    }));
    expect(questionChats.send).toHaveBeenCalledOnce();
    client.stop();
  });

  it("does not publish a late activation after terminal cleanup wins", async () => {
    let finishActivation!: (snapshot: any) => void;
    const questionChats = {
      activate: vi.fn(() => new Promise<any>((resolve) => {
        finishActivation = resolve;
      })),
      activateContext: vi.fn(),
      getSnapshot: vi.fn(),
      send: vi.fn(),
      stop: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
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
    socket.serverMessage({
      type: "chat.activate",
      requestId: "activation-race",
      payload: {
        requestId: "ask-activation-race",
        ownerSessionId: "session-chat",
        source: { agentSessionPath: "/source.jsonl", leafId: "leaf", cwd: "/repo" }
      }
    });
    await vi.waitFor(() => expect(questionChats.activate).toHaveBeenCalledOnce());
    socket.serverMessage({
      type: "chat.cleanup",
      payload: { requestId: "ask-activation-race", reason: "cancelled" }
    });
    finishActivation({
      requestId: "ask-activation-race",
      state: "ready",
      forkKind: "exact",
      model: { id: "test/model", source: "originating" },
      sequence: 0,
      messages: []
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(socket.sent).not.toContainEqual(expect.objectContaining({ type: "chat.ready", requestId: "activation-race" }));
    expect(questionChats.subscribe).not.toHaveBeenCalled();
    client.stop();
  });

  it("offers each private manifest after registration and returns recovered snapshots from reconciliation", async () => {
    const snapshot = {
      requestId: "ask-recover",
      state: "ready" as const,
      forkKind: "exact" as const,
      model: { id: "test/model", source: "originating" as const },
      sequence: 12,
      messages: [{ id: "prior", role: "assistant" as const, text: "Before reload", status: "final" as const }]
    };
    const questionChats = {
      activate: vi.fn(),
      activateContext: vi.fn(),
      getSnapshot: vi.fn(),
      send: vi.fn(),
      stop: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
      cleanup: vi.fn(),
      listRecoveryOffers: vi.fn(() => [
        { requestId: "ask-recover", ownerSessionId: "session-chat", forkKind: "exact" as const },
        { requestId: "ask-stale", ownerSessionId: "old-session", forkKind: "context-only" as const }
      ]),
      reconcile: vi.fn(async (_owner: string, decisions: Array<{ requestId: string; action: string }>) =>
        decisions.map((decision) => decision.action === "recover"
          ? { status: "recovered" as const, snapshot }
          : { status: "deleted" as const, requestId: decision.requestId }))
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
      type: "registered",
      requestId: "register",
      payload: { sessionId: "session-chat", presence: "live" }
    });
    await vi.waitFor(() => expect(socket.sent.filter((message: any) => message.type === "chat.recover.offer")).toEqual([
      {
        type: "chat.recover.offer",
        requestId: expect.any(String),
        payload: { requestId: "ask-recover", ownerSessionId: "session-chat", forkKind: "exact" }
      }
    ]));
    let offers = socket.sent.filter((message: any) => message.type === "chat.recover.offer") as any[];
    socket.serverMessage({
      type: "chat.reconcile",
      requestId: offers[0]!.requestId,
      payload: { requestId: "ask-recover", forkKind: "exact", action: "recover", reason: "pending" }
    });
    await vi.waitFor(() => expect(socket.sent.filter((message: any) => message.type === "chat.recover.offer")).toHaveLength(2));
    offers = socket.sent.filter((message: any) => message.type === "chat.recover.offer") as any[];
    expect(offers[1]).toMatchObject({
      payload: { requestId: "ask-stale", ownerSessionId: "old-session", forkKind: "context-only" }
    });
    socket.serverMessage({
      type: "chat.reconcile",
      requestId: offers[1]!.requestId,
      payload: { requestId: "ask-stale", forkKind: "context-only", action: "delete", reason: "wrong_owner" }
    });
    await vi.waitFor(() => expect(questionChats.reconcile).toHaveBeenCalledTimes(2));
    expect(questionChats.reconcile).toHaveBeenCalledWith("session-chat", [
      { requestId: "ask-recover", forkKind: "exact", action: "recover" }
    ]);
    expect(socket.sent).toContainEqual({
      type: "chat.reconciled",
      requestId: offers[0]!.requestId,
      payload: { requestId: "ask-recover", forkKind: "exact", result: { status: "recovered", snapshot } }
    });
    expect(questionChats.subscribe).toHaveBeenCalledWith("ask-recover", expect.any(Function));
    client.stop();
  });

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
      send: vi.fn(async (_requestId: string, _ownerSessionId: string, command: { clientCommandId: string }) => ({
        status: "accepted" as const,
        clientCommandId: command.clientCommandId,
        mode: "prompt" as const
      })),
      stop: vi.fn(async (_requestId: string, _ownerSessionId: string, command: { clientCommandId: string }) => ({
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
      ownerSessionId: "session-chat",
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
    await vi.waitFor(() => expect(questionChats.send).toHaveBeenCalledWith("ask-chat", "session-chat", { clientCommandId: "browser-1", message: "Explain it" }));
    await vi.waitFor(() => expect(questionChats.stop).toHaveBeenCalledWith("ask-chat", "session-chat", { clientCommandId: "browser-stop-1" }));
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
