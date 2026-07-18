import { AskResultSchema, StateSnapshotSchema, type ExtensionClientMessage } from "@pi-postbox/protocol";
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { createPostboxApp } from "../src/app.js";

const apps: Array<{ close: () => Promise<void> }> = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
  }
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function listenerPort(app: FastifyInstance): number {
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP listener");
  return address.port;
}

function registrationMessage(): ExtensionClientMessage {
  return {
    type: "session.register",
    requestId: "register-1",
    payload: {
      machine: { machineId: "machine-1", hostname: "workstation" },
      project: { projectId: "project-1", name: "pi-postbox", cwd: "/repo", branch: "main" },
      session: { sessionId: "session-1", title: "Resilient ask", cwd: "/repo", branch: "main", semanticState: "blocked" }
    }
  };
}

async function listen(app: FastifyInstance): Promise<number> {
  await app.listen({ host: "127.0.0.1", port: 0 });
  return listenerPort(app);
}

async function connectAndRegister(port: number): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/api/extension/ws`);
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const registered = nextMessage(socket);
  socket.send(JSON.stringify(registrationMessage()));
  await expect(registered).resolves.toMatchObject({ type: "registered" });
  return socket;
}

function nextMessage(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    socket.once("message", (raw) => resolve(JSON.parse(raw.toString())));
    socket.once("error", reject);
  });
}

function askCreateMessage(requestId: string, expiresAt?: string): ExtensionClientMessage {
  return {
    type: "ask.create",
    requestId: `wire-${requestId}`,
    payload: {
      requestId,
      sessionId: "session-1",
      mode: "single",
      question: { prompt: "Continue after reconnect?" },
      options: [{ value: "yes", label: "Yes" }],
      context: {
        codebaseContext: "WebSocket extension client and Fastify server.",
        problemContext: "Keep a pending decision stable across reconnects."
      },
      expiresAt
    }
  };
}

describe("pending ask resilience", () => {
  it("treats replayed ask.create messages with the same request id as one pending card across reconnects", async () => {
    const app = await createPostboxApp({ databasePath: ":memory:", now: () => 10_000, askTimeoutMs: 60_000, expirySweepMs: 0 });
    apps.push(app);
    const port = await listen(app);

    const firstSocket = await connectAndRegister(port);
    const firstCreated = nextMessage(firstSocket);
    firstSocket.send(JSON.stringify(askCreateMessage("ask-replay")));
    await expect(firstCreated).resolves.toMatchObject({ type: "ask.created", payload: { requestId: "ask-replay", status: "pending" } });

    firstSocket.close();
    await new Promise((resolve) => firstSocket.once("close", resolve));

    const secondSocket = await connectAndRegister(port);
    const replayCreated = nextMessage(secondSocket);
    secondSocket.send(JSON.stringify(askCreateMessage("ask-replay")));
    await expect(replayCreated).resolves.toMatchObject({ type: "ask.created", payload: { requestId: "ask-replay", status: "pending" } });

    const state = StateSnapshotSchema.parse((await app.inject({ method: "GET", url: "/api/state" })).json());
    expect(state.requests.filter((request) => request.requestId === "ask-replay")).toHaveLength(1);
    expect(state.requests[0]).toMatchObject({ requestId: "ask-replay", status: "pending" });

    const resolved = nextMessage(secondSocket);
    const answerResponse = await app.inject({
      method: "POST",
      url: "/api/requests/ask-replay/answer",
      payload: { selectedValues: ["yes"] }
    });
    expect(answerResponse.statusCode).toBe(200);
    await expect(resolved).resolves.toMatchObject({ type: "ask.resolved", payload: { status: "answered", requestId: "ask-replay" } });
  });

  it("replaying an already terminal request returns the existing terminal result instead of a duplicate card", async () => {
    const app = await createPostboxApp({ databasePath: ":memory:", now: () => 20_000, askTimeoutMs: 60_000, expirySweepMs: 0 });
    apps.push(app);
    const port = await listen(app);
    const socket = await connectAndRegister(port);

    const created = nextMessage(socket);
    socket.send(JSON.stringify(askCreateMessage("ask-terminal")));
    await created;

    const firstResolved = nextMessage(socket);
    const answerResponse = await app.inject({
      method: "POST",
      url: "/api/requests/ask-terminal/answer",
      payload: { selectedValues: ["yes"], rationale: "Already decided" }
    });
    expect(answerResponse.statusCode).toBe(200);
    await firstResolved;

    const replayResolved = nextMessage(socket);
    socket.send(JSON.stringify(askCreateMessage("ask-terminal")));
    await expect(replayResolved).resolves.toMatchObject({
      type: "ask.resolved",
      payload: { status: "answered", requestId: "ask-terminal", selectedValues: ["yes"], rationale: "Already decided" }
    });

    const state = StateSnapshotSchema.parse((await app.inject({ method: "GET", url: "/api/state" })).json());
    expect(state.requests.filter((request) => request.requestId === "ask-terminal")).toHaveLength(1);
  });

  it("marks expired requests in API state and resolves waiting extension callers with an expired result", async () => {
    let now = 30_000;
    const app = await createPostboxApp({ databasePath: ":memory:", now: () => now, askTimeoutMs: 1_000, expirySweepMs: 0 });
    apps.push(app);
    const port = await listen(app);
    const socket = await connectAndRegister(port);

    const created = nextMessage(socket);
    socket.send(JSON.stringify(askCreateMessage("ask-expire")));
    await created;

    const expiredMessage = nextMessage(socket);
    now = 31_001;
    const state = StateSnapshotSchema.parse((await app.inject({ method: "GET", url: "/api/state" })).json());
    expect(state.requests).toHaveLength(1);
    expect(state.requests[0]).toMatchObject({ status: "expired", result: { status: "expired", requestId: "ask-expire" } });
    expect(AskResultSchema.parse(state.requests[0].result)).toMatchObject({ status: "expired", requestId: "ask-expire" });
    await expect(expiredMessage).resolves.toMatchObject({ type: "ask.resolved", payload: { status: "expired", requestId: "ask-expire" } });
  });
});
