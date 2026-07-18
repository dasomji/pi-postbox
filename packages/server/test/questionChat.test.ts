import type { ExtensionClientMessage, ExtensionServerMessage, QuestionChatSnapshot } from "@pi-postbox/protocol";
import type { FastifyInstance } from "fastify";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { openPostboxDatabase } from "../src/db/database.js";
import { afterEach, describe, expect, it } from "vitest";
import { createPostboxApp } from "../src/app.js";

const apps: FastifyInstance[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  for (const app of apps.splice(0)) await app.close();
});

function listenerPort(app: FastifyInstance): number {
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP listener");
  return address.port;
}

function nextMessage(socket: WebSocket, label = "extension message"): Promise<ExtensionServerMessage> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), 2_000);
    socket.once("message", (raw) => {
      clearTimeout(timeout);
      resolve(JSON.parse(raw.toString()) as ExtensionServerMessage);
    });
  });
}

async function setup(options: {
  sessionPath?: string | null;
  leafId?: string | null;
  expiresAt?: string;
  now?: () => number;
  legacyContext?: Record<string, unknown> | null;
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "postbox-chat-server-"));
  const databasePath = join(root, "postbox.sqlite");
  const app = await createPostboxApp({
    databasePath,
    expirySweepMs: 0,
    chatCommandTimeoutMs: 250,
    now: options.now
  });
  apps.push(app);
  await app.listen({ host: "127.0.0.1", port: 0 });

  const socket = new WebSocket(`ws://127.0.0.1:${listenerPort(app)}/api/extension/ws`);
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  socket.send(
    JSON.stringify({
      type: "session.register",
      requestId: "register-chat-owner",
      payload: {
        machine: { machineId: "machine-chat", hostname: "chat-host" },
        project: { projectId: "project-chat", name: "Chat project", cwd: "/repo" },
        session: {
          sessionId: "session-chat-owner",
          cwd: "/repo",
          semanticState: "blocked",
          agentSessionPath: options.sessionPath === null ? undefined : "/private/session-start.jsonl",
          leafId: options.leafId === null ? undefined : "leaf-at-session-start"
        }
      }
    } satisfies ExtensionClientMessage)
  );
  await nextMessage(socket);

  if (options.sessionPath !== null || options.leafId !== null) {
    socket.send(
      JSON.stringify({
        type: "session.update",
        requestId: "question-time-source",
        payload: {
          sessionId: "session-chat-owner",
          cwd: "/repo",
          agentSessionPath: options.sessionPath === null ? undefined : (options.sessionPath ?? "/private/question-time.jsonl"),
          leafId: options.leafId === null ? undefined : (options.leafId ?? "leaf-at-question")
        }
      } satisfies ExtensionClientMessage)
    );
    await nextMessage(socket);
  }

  socket.send(
    JSON.stringify({
      type: "ask.create",
      requestId: "wire-chat-ask",
      payload: {
        requestId: "ask-chat",
        sessionId: "session-chat-owner",
        mode: "single",
        question: { prompt: "Which design?" },
        options: [{ value: "a", label: "A" }],
        context: { codebaseContext: "A real Fastify server.", problemContext: "Choose the design." },
        forkReference: {
          agentSessionPath: "/browser-must-not-control/source.jsonl",
          leafId: "untrusted-leaf",
          cwd: "/untrusted",
          model: "anthropic/claude-sonnet-4"
        },
        expiresAt: options.expiresAt
      }
    } satisfies ExtensionClientMessage)
  );
  await nextMessage(socket);
  if ("legacyContext" in options) {
    const db = openPostboxDatabase(databasePath);
    db.prepare("UPDATE ask_requests SET context_json = ? WHERE request_id = 'ask-chat'").run(
      options.legacyContext === null ? null : JSON.stringify(options.legacyContext)
    );
    db.close();
  }
  return { app, socket, databasePath };
}

function readySnapshot(): QuestionChatSnapshot {
  return {
    requestId: "ask-chat",
    state: "ready",
    forkKind: "exact",
    model: { id: "anthropic/claude-sonnet-4", source: "originating" },
    sequence: 0,
    messages: []
  };
}

async function activateChat(app: FastifyInstance, socket: WebSocket): Promise<void> {
  const activation = app.inject({ method: "POST", url: "/api/requests/ask-chat/chat" });
  const command = await nextMessage(socket);
  if (command.type !== "chat.activate") throw new Error("Expected Chat activation command");
  socket.send(JSON.stringify({ type: "chat.ready", requestId: command.requestId, payload: readySnapshot() } satisfies ExtensionClientMessage));
  expect((await activation).statusCode).toBe(200);
}

describe("Question Chat activation relay", () => {
  it("restores a pending Chat after server restart and lets a terminal race delete instead of resurrecting it", async () => {
    const first = await setup();
    await activateChat(first.app, first.socket);
    first.socket.close();
    await first.app.close();
    apps.splice(apps.indexOf(first.app), 1);

    const app = await createPostboxApp({
      databasePath: first.databasePath,
      expirySweepMs: 0,
      chatCommandTimeoutMs: 250
    });
    apps.push(app);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const socket = new WebSocket(`ws://127.0.0.1:${listenerPort(app)}/api/extension/ws`);
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    socket.send(JSON.stringify({
      type: "session.register",
      requestId: "restart-register",
      payload: {
        machine: { machineId: "machine-chat", hostname: "chat-host" },
        project: { projectId: "project-chat", name: "Chat project", cwd: "/repo" },
        session: { sessionId: "session-chat-owner", cwd: "/repo", semanticState: "blocked" }
      }
    } satisfies ExtensionClientMessage));
    await expect(nextMessage(socket, "restart registration")).resolves.toMatchObject({ type: "registered" });

    const offlineProbe = await app.inject({ method: "GET", url: "/api/requests/ask-chat/chat" });
    expect(offlineProbe.statusCode).toBe(503);
    expect(offlineProbe.json()).toMatchObject({ status: "unavailable", error: { code: "extension_offline" } });

    socket.send(JSON.stringify({
      type: "chat.recover.offer",
      requestId: "recover-after-restart",
      payload: { requestId: "ask-chat", ownerSessionId: "session-chat-owner", forkKind: "exact" }
    } satisfies ExtensionClientMessage));
    await expect(nextMessage(socket, "restart reconciliation")).resolves.toEqual({
      type: "chat.reconcile",
      requestId: "recover-after-restart",
      payload: { requestId: "ask-chat", forkKind: "exact", action: "recover", reason: "pending" }
    });
    const recovered = { ...readySnapshot(), sequence: 12, messages: [
      { id: "prior", role: "assistant" as const, text: "Before restart", status: "final" as const }
    ] };
    const recoveryAcceptance = nextMessage(socket, "recovery acceptance");
    socket.send(JSON.stringify({
      type: "chat.reconciled",
      requestId: "recover-after-restart",
      payload: { requestId: "ask-chat", forkKind: "exact", result: { status: "recovered", snapshot: recovered } }
    } satisfies ExtensionClientMessage));
    await expect(recoveryAcceptance).resolves.toMatchObject({
      type: "ack",
      requestId: "recover-after-restart",
      payload: { type: "chat.reconciled" }
    });

    const snapshotRequest = app.inject({ method: "GET", url: "/api/requests/ask-chat/chat" });
    const snapshotCommand = await nextMessage(socket, "recovered snapshot command");
    expect(snapshotCommand).toMatchObject({ type: "chat.snapshot", payload: { requestId: "ask-chat" } });
    if (snapshotCommand.type !== "chat.snapshot") throw new Error("Expected recovered snapshot command");
    socket.send(JSON.stringify({ type: "chat.snapshot", requestId: snapshotCommand.requestId, payload: recovered } satisfies ExtensionClientMessage));
    expect((await snapshotRequest).json()).toEqual({ status: "ready", snapshot: recovered });

    socket.send(JSON.stringify({
      type: "chat.recover.offer",
      requestId: "terminal-race",
      payload: { requestId: "ask-chat", ownerSessionId: "session-chat-owner", forkKind: "exact" }
    } satisfies ExtensionClientMessage));
    await expect(nextMessage(socket, "terminal race reconciliation")).resolves.toMatchObject({ type: "chat.reconcile", payload: { action: "recover" } });
    const terminalCleanup = nextMessage(socket, "terminal cleanup");
    const answer = await app.inject({
      method: "POST",
      url: "/api/requests/ask-chat/answer",
      payload: { selectedValues: ["a"] }
    });
    expect(answer.statusCode).toBe(200);
    await expect(terminalCleanup).resolves.toMatchObject({ type: "chat.cleanup", payload: { requestId: "ask-chat" } });
    const lateCleanup = nextMessage(socket, "late recovery cleanup");
    socket.send(JSON.stringify({
      type: "chat.reconciled",
      requestId: "terminal-race",
      payload: { requestId: "ask-chat", forkKind: "exact", result: { status: "recovered", snapshot: recovered } }
    } satisfies ExtensionClientMessage));
    await expect(lateCleanup).resolves.toMatchObject({ type: "chat.cleanup", payload: { requestId: "ask-chat" } });
  });

  it("offers but never auto-starts an eligible context-only fallback, then relays only the explicit confirmed command", async () => {
    const { app, socket } = await setup({ sessionPath: null });
    let unexpectedCommand = false;
    const observeUnexpected = () => {
      unexpectedCommand = true;
    };
    socket.once("message", observeUnexpected);

    const exact = await app.inject({ method: "POST", url: "/api/requests/ask-chat/chat" });
    expect(exact.statusCode).toBe(409);
    expect(exact.json()).toMatchObject({
      status: "unavailable",
      error: { code: "source_path_missing", contextFallback: { status: "available" } }
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(unexpectedCommand).toBe(false);
    socket.off("message", observeUnexpected);

    const activation = app.inject({
      method: "POST",
      url: "/api/requests/ask-chat/chat/context",
      payload: { confirmed: true }
    });
    const command = await nextMessage(socket);
    expect(command).toMatchObject({
      type: "chat.activate-context",
      payload: {
        requestId: "ask-chat",
        ownerSessionId: "session-chat-owner",
        source: {
          cwd: "/repo",
          model: "anthropic/claude-sonnet-4",
          mode: "single",
          question: { prompt: "Which design?" },
          options: [{ value: "a", label: "A" }],
          context: { codebaseContext: "A real Fastify server.", problemContext: "Choose the design." }
        }
      }
    });
    if (command.type !== "chat.activate-context") throw new Error("Expected explicit context-only activation command");
    const snapshot: QuestionChatSnapshot = { ...readySnapshot(), forkKind: "context-only" };
    socket.send(JSON.stringify({ type: "chat.ready", requestId: command.requestId, payload: snapshot } satisfies ExtensionClientMessage));
    expect((await activation).json()).toEqual({ status: "ready", snapshot });

    const eventResponse = await fetch(`http://127.0.0.1:${listenerPort(app)}/api/requests/ask-chat/chat/events`);
    const events = createSseReader(eventResponse);
    const send = app.inject({
      method: "POST",
      url: "/api/requests/ask-chat/chat/messages",
      payload: { clientCommandId: "context-message-1", message: "Explain the persisted context." }
    });
    const sendCommand = await nextMessage(socket);
    expect(sendCommand).toMatchObject({ type: "chat.send", payload: { command: { clientCommandId: "context-message-1" } } });
    if (sendCommand.type !== "chat.send") throw new Error("Expected context Chat send command");
    socket.send(JSON.stringify({
      type: "chat.send.accepted",
      requestId: sendCommand.requestId,
      payload: {
        requestId: "ask-chat",
        response: { status: "accepted", clientCommandId: "context-message-1", mode: "prompt" }
      }
    } satisfies ExtensionClientMessage));
    expect((await send).statusCode).toBe(200);
    socket.send(JSON.stringify({
      type: "chat.event",
      payload: { requestId: "ask-chat", sequence: 1, type: "lifecycle", state: "generating" }
    } satisfies ExtensionClientMessage));
    await expect(events.next()).resolves.toMatchObject({ sequence: 1, state: "generating" });
    await events.close();

    const cancel = app.inject({ method: "POST", url: "/api/requests/ask-chat/cancel", payload: {} });
    await expect(nextMessage(socket)).resolves.toMatchObject({
      type: "chat.cleanup",
      payload: { requestId: "ask-chat", reason: "cancelled" }
    });
    expect((await cancel).statusCode).toBe(200);
  });

  it("rejects unconfirmed and legacy-ineligible context-only starts with a precise typed reason", async () => {
    const { app } = await setup({
      sessionPath: null,
      legacyContext: { codebaseContext: "Still readable, but missing problem context." }
    });
    const exact = await app.inject({ method: "POST", url: "/api/requests/ask-chat/chat" });
    expect(exact.json()).toMatchObject({
      error: {
        code: "source_path_missing",
        contextFallback: { status: "unavailable", reason: "missing_problem_context" }
      }
    });

    const unconfirmed = await app.inject({
      method: "POST",
      url: "/api/requests/ask-chat/chat/context",
      payload: { confirmed: false }
    });
    expect(unconfirmed.statusCode).toBe(400);
    expect(unconfirmed.json()).toMatchObject({ status: "unavailable", error: { code: "invalid_command" } });

    const ineligible = await app.inject({
      method: "POST",
      url: "/api/requests/ask-chat/chat/context",
      payload: { confirmed: true }
    });
    expect(ineligible.statusCode).toBe(409);
    expect(ineligible.json()).toMatchObject({
      status: "unavailable",
      error: {
        code: "context_fallback_unavailable",
        contextFallback: { status: "unavailable", reason: "missing_problem_context" }
      }
    });
  });

  it("keeps a legacy context-ineligible Question exact-fork-capable while its source exists", async () => {
    const { app, socket } = await setup({ legacyContext: null });
    const activation = app.inject({ method: "POST", url: "/api/requests/ask-chat/chat" });
    const command = await nextMessage(socket);
    expect(command.type).toBe("chat.activate");
    if (command.type !== "chat.activate") throw new Error("Expected legacy exact activation");
    socket.send(JSON.stringify({ type: "chat.ready", requestId: command.requestId, payload: readySnapshot() } satisfies ExtensionClientMessage));
    expect((await activation).statusCode).toBe(200);

    const context = await app.inject({
      method: "POST",
      url: "/api/requests/ask-chat/chat/context",
      payload: { confirmed: true }
    });
    expect(context.json()).toMatchObject({
      status: "unavailable",
      error: {
        code: "context_fallback_unavailable",
        contextFallback: { status: "unavailable", reason: "missing_codebase_and_problem_context" }
      }
    });
  });

  it("does not let context-only activation replace an already-running exact fork", async () => {
    const { app, socket } = await setup();
    await activateChat(app, socket);
    let unexpectedCommand = false;
    socket.once("message", () => {
      unexpectedCommand = true;
    });
    const conflict = await app.inject({
      method: "POST",
      url: "/api/requests/ask-chat/chat/context",
      payload: { confirmed: true }
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ status: "unavailable", error: { code: "runtime_busy" } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(unexpectedCommand).toBe(false);
  });

  it("rejects an activation snapshot whose fork kind does not match the requested command", async () => {
    const { app, socket } = await setup({ sessionPath: null });
    const activation = app.inject({
      method: "POST",
      url: "/api/requests/ask-chat/chat/context",
      payload: { confirmed: true }
    });
    const command = await nextMessage(socket);
    if (command.type !== "chat.activate-context") throw new Error("Expected context activation");
    socket.send(JSON.stringify({ type: "chat.ready", requestId: command.requestId, payload: readySnapshot() } satisfies ExtensionClientMessage));
    expect((await activation).json()).toMatchObject({
      status: "unavailable",
      error: { code: "runtime_failure" }
    });
  });

  it("keeps a newer same-kind activation authoritative when an earlier concurrent attempt fails", async () => {
    const { app, socket } = await setup();
    const baseUrl = `http://127.0.0.1:${listenerPort(app)}`;
    const earlier = fetch(`${baseUrl}/api/requests/ask-chat/chat`, { method: "POST" });
    const earlierCommand = await nextMessage(socket);
    const newer = fetch(`${baseUrl}/api/requests/ask-chat/chat`, { method: "POST" });
    const newerCommand = await nextMessage(socket);
    if (earlierCommand.type !== "chat.activate" || newerCommand.type !== "chat.activate") {
      throw new Error("Expected exact activation commands");
    }
    socket.send(JSON.stringify({
      type: "chat.error",
      requestId: earlierCommand.requestId,
      payload: {
        requestId: "ask-chat",
        error: { code: "runtime_failure", message: "Earlier concurrent attempt failed." }
      }
    } satisfies ExtensionClientMessage));
    socket.send(JSON.stringify({
      type: "chat.ready",
      requestId: newerCommand.requestId,
      payload: readySnapshot()
    } satisfies ExtensionClientMessage));
    expect(await (await earlier).json()).toMatchObject({ status: "unavailable", error: { code: "runtime_failure" } });
    expect((await newer).status).toBe(200);

    const snapshot = app.inject({ method: "GET", url: "/api/requests/ask-chat/chat" });
    const snapshotCommand = await nextMessage(socket);
    expect(snapshotCommand.type).toBe("chat.snapshot");
    if (snapshotCommand.type !== "chat.snapshot") throw new Error("Expected retained active snapshot command");
    socket.send(JSON.stringify({ type: "chat.snapshot", requestId: snapshotCommand.requestId, payload: readySnapshot() } satisfies ExtensionClientMessage));
    expect((await snapshot).statusCode).toBe(200);
  });

  it("fetches the extension-fork snapshot before streaming later normalized events over question SSE", async () => {
    const { app, socket } = await setup();
    await activateChat(app, socket);
    const baseUrl = `http://127.0.0.1:${listenerPort(app)}`;

    const snapshotResponse = fetch(`${baseUrl}/api/requests/ask-chat/chat`);
    const snapshotCommand = await nextMessage(socket);
    expect(snapshotCommand).toMatchObject({
      type: "chat.snapshot",
      payload: { requestId: "ask-chat", ownerSessionId: "session-chat-owner" }
    });
    if (snapshotCommand.type !== "chat.snapshot") throw new Error("Expected snapshot command");
    let snapshotSettled = false;
    void snapshotResponse.then(() => {
      snapshotSettled = true;
    });
    socket.send(
      JSON.stringify({
        type: "chat.snapshot",
        requestId: snapshotCommand.requestId,
        payload: { ...readySnapshot(), requestId: "different-question" }
      } satisfies ExtensionClientMessage)
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(snapshotSettled).toBe(false);
    socket.send(
      JSON.stringify({
        type: "chat.snapshot",
        requestId: snapshotCommand.requestId,
        payload: {
          ...readySnapshot(),
          sequence: 4,
          messages: [
            { id: "fork-user", role: "user", text: "Earlier question", status: "final" },
            { id: "fork-assistant", role: "assistant", text: "Earlier answer", status: "final" }
          ]
        }
      } satisfies ExtensionClientMessage)
    );
    expect(await (await snapshotResponse).json()).toMatchObject({
      status: "ready",
      snapshot: { sequence: 4, messages: [{ text: "Earlier question" }, { text: "Earlier answer" }] }
    });

    const eventResponse = await fetch(`${baseUrl}/api/requests/ask-chat/chat/events`);
    expect(eventResponse.status).toBe(200);
    const events = createSseReader(eventResponse);
    const sendResponse = fetch(`${baseUrl}/api/requests/ask-chat/chat/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientCommandId: "browser-command-1", message: "Please elaborate" })
    });
    const sendCommand = await nextMessage(socket);
    expect(sendCommand).toMatchObject({
      type: "chat.send",
      payload: {
        requestId: "ask-chat",
        command: { clientCommandId: "browser-command-1", message: "Please elaborate" }
      }
    });
    if (sendCommand.type !== "chat.send") throw new Error("Expected send command");
    socket.send(
      JSON.stringify({
        type: "chat.send.accepted",
        requestId: sendCommand.requestId,
        payload: { requestId: "ask-chat", response: { status: "accepted", clientCommandId: "browser-command-1", mode: "prompt" } }
      } satisfies ExtensionClientMessage)
    );
    expect(await (await sendResponse).json()).toEqual({ status: "accepted", clientCommandId: "browser-command-1", mode: "prompt" });

    socket.send(JSON.stringify({ type: "chat.event", payload: { requestId: "ask-chat", sequence: 5, type: "lifecycle", state: "generating" } } satisfies ExtensionClientMessage));
    await expect(events.next()).resolves.toMatchObject({ requestId: "ask-chat", sequence: 5, type: "lifecycle" });

    const steerResponse = app.inject({
      method: "POST",
      url: "/api/requests/ask-chat/chat/messages",
      payload: { clientCommandId: "browser-command-2", message: "Correct one detail" }
    });
    const steerCommand = await nextMessage(socket);
    expect(steerCommand).toMatchObject({
      type: "chat.send",
      payload: { command: { clientCommandId: "browser-command-2", message: "Correct one detail" } }
    });
    if (steerCommand.type !== "chat.send") throw new Error("Expected steering send command");
    socket.send(JSON.stringify({
      type: "chat.send.accepted",
      requestId: steerCommand.requestId,
      payload: { requestId: "ask-chat", response: { status: "accepted", clientCommandId: "browser-command-2", mode: "steer" } }
    } satisfies ExtensionClientMessage));
    expect((await steerResponse).json()).toEqual({ status: "accepted", clientCommandId: "browser-command-2", mode: "steer" });

    socket.send(JSON.stringify({
      type: "chat.event",
      payload: {
        requestId: "ask-chat",
        sequence: 6,
        type: "message.started",
        message: { id: "assistant-1", role: "assistant", text: "", status: "streaming" }
      }
    } satisfies ExtensionClientMessage));
    socket.send(JSON.stringify({ type: "chat.event", payload: { requestId: "ask-chat", sequence: 7, type: "assistant.text.delta", messageId: "assistant-1", text: "Partial answer" } } satisfies ExtensionClientMessage));
    await expect(events.next()).resolves.toMatchObject({ requestId: "ask-chat", sequence: 6, type: "message.started" });
    await expect(events.next()).resolves.toMatchObject({ requestId: "ask-chat", sequence: 7, type: "assistant.text.delta", text: "Partial answer" });

    const stopResponse = app.inject({
      method: "POST",
      url: "/api/requests/ask-chat/chat/stop",
      payload: { clientCommandId: "browser-stop-1" }
    });
    const stopCommand = await nextMessage(socket);
    expect(stopCommand).toMatchObject({
      type: "chat.stop",
      payload: { requestId: "ask-chat", command: { clientCommandId: "browser-stop-1" } }
    });
    if (stopCommand.type !== "chat.stop") throw new Error("Expected stop command");
    socket.send(JSON.stringify({ type: "chat.event", payload: { requestId: "ask-chat", sequence: 8, type: "lifecycle", state: "stopping" } } satisfies ExtensionClientMessage));
    socket.send(JSON.stringify({ type: "chat.event", payload: { requestId: "ask-chat", sequence: 9, type: "message.finished", messageId: "assistant-1", text: "Partial answer", status: "stopped" } } satisfies ExtensionClientMessage));
    socket.send(JSON.stringify({ type: "chat.event", payload: { requestId: "ask-chat", sequence: 10, type: "lifecycle", state: "stopped" } } satisfies ExtensionClientMessage));
    socket.send(JSON.stringify({ type: "chat.event", payload: { requestId: "ask-chat", sequence: 11, type: "lifecycle", state: "ready" } } satisfies ExtensionClientMessage));
    await expect(events.next()).resolves.toMatchObject({ sequence: 8, state: "stopping" });
    await expect(events.next()).resolves.toMatchObject({ sequence: 9, type: "message.finished", status: "stopped", text: "Partial answer" });
    await expect(events.next()).resolves.toMatchObject({ sequence: 10, state: "stopped" });
    await expect(events.next()).resolves.toMatchObject({ sequence: 11, state: "ready" });
    socket.send(JSON.stringify({
      type: "chat.stop.accepted",
      requestId: stopCommand.requestId,
      payload: { requestId: "ask-chat", response: { status: "accepted", clientCommandId: "browser-stop-1" } }
    } satisfies ExtensionClientMessage));
    expect(await (await stopResponse).json()).toEqual({ status: "accepted", clientCommandId: "browser-stop-1" });

    const continueResponse = app.inject({
      method: "POST",
      url: "/api/requests/ask-chat/chat/messages",
      payload: { clientCommandId: "browser-command-3", message: "Continue" }
    });
    const continueCommand = await nextMessage(socket);
    if (continueCommand.type !== "chat.send") throw new Error("Expected continued send command");
    socket.send(JSON.stringify({
      type: "chat.send.accepted",
      requestId: continueCommand.requestId,
      payload: { requestId: "ask-chat", response: { status: "accepted", clientCommandId: "browser-command-3", mode: "prompt" } }
    } satisfies ExtensionClientMessage));
    expect((await continueResponse).json()).toEqual({ status: "accepted", clientCommandId: "browser-command-3", mode: "prompt" });
    await events.close();
  });

  it("streams extension offline without discarding the active Chat and rejects commands instead of queueing them", async () => {
    const { app, socket } = await setup();
    await activateChat(app, socket);
    const eventResponse = await fetch(`http://127.0.0.1:${listenerPort(app)}/api/requests/ask-chat/chat/events`);
    const events = createSseReader(eventResponse);
    await new Promise<void>((resolve) => {
      socket.once("close", resolve);
      socket.close();
    });
    await expect(events.next()).resolves.toEqual({ requestId: "ask-chat", type: "transport", state: "offline" });
    const send = await app.inject({
      method: "POST",
      url: "/api/requests/ask-chat/chat/messages",
      payload: { clientCommandId: "offline-command", message: "Do not queue this" }
    });
    expect(send.statusCode).toBe(503);
    expect(send.json()).toMatchObject({ status: "unavailable", error: { code: "extension_offline" } });
    await events.close();
  });

  it("routes activation to the owning extension and returns its ready empty snapshot", async () => {
    const { app, socket } = await setup();
    const activation = app.inject({ method: "POST", url: "/api/requests/ask-chat/chat" });
    const command = await nextMessage(socket);

    expect(command).toMatchObject({
      type: "chat.activate",
      payload: {
        requestId: "ask-chat",
        ownerSessionId: "session-chat-owner",
        source: { agentSessionPath: "/private/question-time.jsonl", leafId: "leaf-at-question", cwd: "/repo" }
      }
    });
    socket.send(JSON.stringify({ type: "chat.ready", requestId: command.requestId!, payload: readySnapshot() } satisfies ExtensionClientMessage));

    expect((await activation).json()).toEqual({ status: "ready", snapshot: readySnapshot() });
  });

  it("lets retries and alternate browsers attach to the same extension-owned runtime", async () => {
    const { app, socket } = await setup();
    let runtimeStarts = 0;
    const extensionRuntimes = new Set<string>();
    const respond = async () => {
      const command = await nextMessage(socket);
      if (command.type !== "chat.activate") throw new Error("Expected Chat activation command");
      if (!extensionRuntimes.has(command.payload.requestId)) {
        extensionRuntimes.add(command.payload.requestId);
        runtimeStarts += 1;
      }
      socket.send(JSON.stringify({ type: "chat.ready", requestId: command.requestId!, payload: readySnapshot() } satisfies ExtensionClientMessage));
    };

    const first = app.inject({ method: "POST", url: "/api/requests/ask-chat/chat" });
    await respond();
    const second = app.inject({ method: "POST", url: "/api/requests/ask-chat/chat" });
    await respond();

    expect((await first).statusCode).toBe(200);
    expect((await second).json()).toEqual({ status: "ready", snapshot: readySnapshot() });
    expect(runtimeStarts).toBe(1);
  });

  it("returns typed errors for missing, terminal, offline, and incomplete source questions", async () => {
    const { app, socket } = await setup();

    const missing = await app.inject({ method: "POST", url: "/api/requests/no-such/chat" });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ status: "unavailable", error: { code: "request_missing" } });

    const unstartedTerminalMessage = nextMessage(socket);
    await app.inject({ method: "POST", url: "/api/requests/ask-chat/cancel", payload: {} });
    await expect(unstartedTerminalMessage).resolves.toMatchObject({ type: "ask.resolved", payload: { requestId: "ask-chat" } });
    const terminal = await app.inject({ method: "POST", url: "/api/requests/ask-chat/chat" });
    expect(terminal.statusCode).toBe(409);
    expect(terminal.json()).toMatchObject({ status: "unavailable", error: { code: "request_not_pending" } });

    const offlineSetup = await setup();
    await new Promise<void>((resolve) => {
      offlineSetup.socket.once("close", () => resolve());
      offlineSetup.socket.close();
    });
    const offline = await offlineSetup.app.inject({ method: "POST", url: "/api/requests/ask-chat/chat" });
    expect(offline.statusCode).toBe(503);
    expect(offline.json()).toMatchObject({ status: "unavailable", error: { code: "extension_offline" } });

    const missingPathSetup = await setup({ sessionPath: null });
    const missingPath = await missingPathSetup.app.inject({ method: "POST", url: "/api/requests/ask-chat/chat" });
    expect(missingPath.json()).toMatchObject({ status: "unavailable", error: { code: "source_path_missing" } });

    const missingLeafSetup = await setup({ leafId: null });
    const missingLeaf = await missingLeafSetup.app.inject({ method: "POST", url: "/api/requests/ask-chat/chat" });
    expect(missingLeaf.json()).toMatchObject({ status: "unavailable", error: { code: "source_leaf_missing" } });
  });

  it.each(["answer", "cancel"] as const)("sends terminal cleanup when the question transitions by %s", async (transition) => {
    const { app, socket } = await setup();
    await activateChat(app, socket);
    const response = app.inject({
      method: "POST",
      url: `/api/requests/ask-chat/${transition}`,
      payload: transition === "answer" ? { selectedValues: ["a"] } : {}
    });
    await expect(nextMessage(socket)).resolves.toMatchObject({
      type: "chat.cleanup",
      payload: { requestId: "ask-chat", reason: transition === "answer" ? "answered" : "cancelled" }
    });
    expect((await response).statusCode).toBe(200);
  });

  it("makes a terminal transition authoritative while activation is still starting", async () => {
    const { app, socket } = await setup();
    const activation = app.inject({ method: "POST", url: "/api/requests/ask-chat/chat" });
    const command = await nextMessage(socket);
    if (command.type !== "chat.activate") throw new Error("Expected Chat activation command");

    const answer = app.inject({
      method: "POST",
      url: "/api/requests/ask-chat/answer",
      payload: { selectedValues: ["a"] }
    });
    await expect(nextMessage(socket)).resolves.toMatchObject({
      type: "chat.cleanup",
      payload: { requestId: "ask-chat", reason: "answered" }
    });

    expect((await answer).statusCode).toBe(200);
    expect((await activation).json()).toMatchObject({
      status: "unavailable",
      error: { code: "request_not_pending" }
    });

    // A late completion from the extension cannot resurrect the terminal Chat.
    socket.send(
      JSON.stringify({ type: "chat.ready", requestId: command.requestId, payload: readySnapshot() } satisfies ExtensionClientMessage)
    );
    const state = (await app.inject({ method: "GET", url: "/api/state" })).json();
    expect(state.requests[0]).toMatchObject({ status: "answered" });
    expect(state.requests[0]).not.toHaveProperty("chat");
  });

  it("retains cleanup authority when activation times out after reaching the extension", async () => {
    const { app, socket } = await setup();
    const activation = app.inject({ method: "POST", url: "/api/requests/ask-chat/chat" });
    await expect(nextMessage(socket)).resolves.toMatchObject({ type: "chat.activate" });
    expect((await activation).json()).toMatchObject({ status: "unavailable", error: { code: "command_timeout" } });

    const cancel = app.inject({ method: "POST", url: "/api/requests/ask-chat/cancel", payload: {} });
    await expect(nextMessage(socket)).resolves.toMatchObject({
      type: "chat.cleanup",
      payload: { requestId: "ask-chat", reason: "cancelled" }
    });
    expect((await cancel).statusCode).toBe(200);
  });

  it("preserves an active fork's deferred cleanup across an offline activation retry", async () => {
    const { app, socket } = await setup();
    await activateChat(app, socket);
    await new Promise<void>((resolve) => {
      socket.once("close", resolve);
      socket.close();
    });

    const offlineRetry = await app.inject({ method: "POST", url: "/api/requests/ask-chat/chat" });
    expect(offlineRetry.statusCode).toBe(503);
    expect(offlineRetry.json()).toMatchObject({ status: "unavailable", error: { code: "extension_offline" } });
    expect((await app.inject({ method: "POST", url: "/api/requests/ask-chat/cancel", payload: {} })).statusCode).toBe(200);

    const reconnected = new WebSocket(`ws://127.0.0.1:${listenerPort(app)}/api/extension/ws`);
    sockets.push(reconnected);
    await new Promise<void>((resolve, reject) => {
      reconnected.once("open", resolve);
      reconnected.once("error", reject);
    });
    reconnected.send(JSON.stringify({
      type: "session.register",
      payload: {
        machine: { machineId: "machine-chat", hostname: "chat-host" },
        project: { projectId: "project-chat", name: "Chat project", cwd: "/repo" },
        session: {
          sessionId: "session-chat-owner",
          cwd: "/repo",
          semanticState: "blocked",
          agentSessionPath: "/private/question-time.jsonl",
          leafId: "leaf-at-question"
        }
      }
    } satisfies ExtensionClientMessage));
    await expect(nextMessage(reconnected)).resolves.toMatchObject({
      type: "chat.cleanup",
      payload: { requestId: "ask-chat", reason: "cancelled" }
    });
  });

  it("sends cleanup on expiry and owning Pi session shutdown", async () => {
    let nowMs = Date.parse("2026-07-17T12:00:00.000Z");
    const expiredSetup = await setup({
      expiresAt: "2026-07-17T12:00:01.000Z",
      now: () => nowMs
    });
    await activateChat(expiredSetup.app, expiredSetup.socket);
    nowMs += 2_000;
    const expiry = expiredSetup.app.inject({ method: "GET", url: "/api/state" });
    await expect(nextMessage(expiredSetup.socket)).resolves.toMatchObject({
      type: "chat.cleanup",
      payload: { requestId: "ask-chat", reason: "expired" }
    });
    expect((await expiry).json().requests[0]).toMatchObject({ status: "expired" });

    const shutdownSetup = await setup();
    await activateChat(shutdownSetup.app, shutdownSetup.socket);
    shutdownSetup.socket.send(
      JSON.stringify({
        type: "session.shutdown",
        payload: { sessionId: "session-chat-owner", reason: "quit" }
      } satisfies ExtensionClientMessage)
    );
    await expect(nextMessage(shutdownSetup.socket)).resolves.toMatchObject({
      type: "chat.cleanup",
      payload: { requestId: "ask-chat", reason: "cancelled" }
    });
  });

  it("does not add Chat transcript data to durable request state", async () => {
    const { app, socket } = await setup();
    const activation = app.inject({ method: "POST", url: "/api/requests/ask-chat/chat" });
    const command = await nextMessage(socket);
    socket.send(JSON.stringify({
      type: "chat.ready",
      requestId: command.requestId!,
      payload: {
        ...readySnapshot(),
        sequence: 2,
        messages: [
          { id: "private-user", role: "user", text: "server-must-not-store-this-user", status: "final" },
          { id: "private-assistant", role: "assistant", text: "server-must-not-store-this-assistant", status: "final" }
        ]
      }
    } satisfies ExtensionClientMessage));
    await activation;

    const state = (await app.inject({ method: "GET", url: "/api/state" })).json();
    expect(state.requests[0]).not.toHaveProperty("chat");
    expect(JSON.stringify(state)).not.toContain("messages");

    const answer = app.inject({ method: "POST", url: "/api/requests/ask-chat/answer", payload: { selectedValues: ["a"] } });
    await expect(nextMessage(socket)).resolves.toMatchObject({ type: "chat.cleanup", payload: { requestId: "ask-chat" } });
    expect((await answer).statusCode).toBe(200);
    const history = (await app.inject({ method: "GET", url: "/api/history" })).json();
    expect(JSON.stringify(history)).not.toContain("server-must-not-store-this");
    expect(JSON.stringify(history)).not.toContain('"messages"');
    expect(JSON.stringify(history)).not.toContain('"chat"');
  });
});

function createSseReader(response: Response): { next(): Promise<any>; close(): Promise<void> } {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Expected SSE body");
  let buffer = "";
  return {
    async next(): Promise<any> {
      while (true) {
        const boundary = buffer.indexOf("\n\n");
        if (boundary >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = frame.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
          if (data) return JSON.parse(data);
          continue;
        }
        const next = await reader.read();
        if (next.done) throw new Error("SSE ended before an event arrived");
        buffer += new TextDecoder().decode(next.value, { stream: true });
      }
    },
    async close(): Promise<void> {
      await reader.cancel();
      reader.releaseLock();
    }
  };
}
