import type { ExtensionClientMessage, ExtensionServerMessage, QuestionChatSnapshot } from "@pi-postbox/protocol";
import type { FastifyInstance } from "fastify";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
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

function nextMessage(socket: WebSocket): Promise<ExtensionServerMessage> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for extension message")), 2_000);
    socket.once("message", (raw) => {
      clearTimeout(timeout);
      resolve(JSON.parse(raw.toString()) as ExtensionServerMessage);
    });
  });
}

async function setup(options: { sessionPath?: string | null; leafId?: string | null; expiresAt?: string; now?: () => number } = {}) {
  const root = mkdtempSync(join(tmpdir(), "postbox-chat-server-"));
  const app = await createPostboxApp({
    databasePath: join(root, "postbox.sqlite"),
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
  return { app, socket };
}

function readySnapshot(): QuestionChatSnapshot {
  return {
    requestId: "ask-chat",
    state: "ready",
    forkKind: "exact",
    model: { id: "anthropic/claude-sonnet-4", source: "originating" },
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
    socket.send(JSON.stringify({ type: "chat.ready", requestId: command.requestId!, payload: readySnapshot() } satisfies ExtensionClientMessage));
    await activation;

    const state = (await app.inject({ method: "GET", url: "/api/state" })).json();
    expect(state.requests[0]).not.toHaveProperty("chat");
    expect(JSON.stringify(state)).not.toContain("messages");
  });
});
