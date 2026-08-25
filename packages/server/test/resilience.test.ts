import { AskResultSchema, HistoryResponseSchema, StateSnapshotSchema, type ExtensionClientMessage } from "@pi-postbox/protocol";
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

function registrationMessage(
  sessionId = "session-1",
  ownerId = "11111111-1111-4111-8111-111111111111"
): ExtensionClientMessage {
  return {
    type: "session.register",
    requestId: `register-${sessionId}`,
    payload: {
      machine: { machineId: "machine-1", hostname: "workstation" },
      project: { projectId: "project-1", name: "pi-postbox", cwd: "/repo", branch: "main" },
      session: { sessionId, title: "Resilient ask", cwd: "/repo", branch: "main", semanticState: "blocked", owner: { harness: "pi", ownerId } }
    }
  };
}

async function listen(app: FastifyInstance): Promise<number> {
  await app.listen({ host: "127.0.0.1", port: 0 });
  return listenerPort(app);
}

async function connectAndRegister(
  port: number,
  sessionId = "session-1",
  ownerId = "11111111-1111-4111-8111-111111111111"
): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/api/extension/ws`);
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const registered = nextMessage(socket);
  socket.send(JSON.stringify(registrationMessage(sessionId, ownerId)));
  await expect(registered).resolves.toMatchObject({ type: "registered" });
  return socket;
}

function nextMessage(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    socket.once("message", (raw) => resolve(JSON.parse(raw.toString())));
    socket.once("error", reject);
  });
}

function nextMessages(socket: WebSocket, count: number): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const messages: unknown[] = [];
    const onMessage = (raw: WebSocket.RawData) => {
      messages.push(JSON.parse(raw.toString()));
      if (messages.length === count) {
        socket.off("message", onMessage);
        socket.off("error", onError);
        resolve(messages);
      }
    };
    const onError = (error: Error) => {
      socket.off("message", onMessage);
      reject(error);
    };
    socket.on("message", onMessage);
    socket.once("error", onError);
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
      question: { prompt: "Continue after reconnect?", ambiguity: "Test ambiguity." },
      options: [{ value: "yes", label: "Yes" }],

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
    await expect(firstCreated).resolves.toMatchObject({
      type: "ask.created",
      payload: {
        requestId: "ask-replay",
        questionId: "ask-replay",
        revision: 1,
        ownerRevision: 1,
        status: "pending",
        disposition: "created"
      }
    });

    firstSocket.close();
    await new Promise((resolve) => firstSocket.once("close", resolve));

    const secondSocket = await connectAndRegister(port);
    const replayCreated = nextMessage(secondSocket);
    secondSocket.send(JSON.stringify(askCreateMessage("ask-replay")));
    await expect(replayCreated).resolves.toMatchObject({
      type: "ask.created",
      payload: {
        requestId: "ask-replay",
        questionId: "ask-replay",
        revision: 1,
        ownerRevision: 1,
        status: "pending",
        disposition: "idempotent"
      }
    });

    const state = StateSnapshotSchema.parse((await app.inject({ method: "GET", url: "/api/state" })).json());
    expect(state.requests.filter((request) => request.requestId === "ask-replay")).toHaveLength(1);
    expect(state.requests[0]).toMatchObject({ requestId: "ask-replay", status: "pending" });

    const answerResponse = await app.inject({
      method: "POST",
      url: "/api/requests/ask-replay/answer",
      payload: { expectedRevision: 1, selectedValues: ["yes"] }
    });
    expect(answerResponse.statusCode).toBe(200);
  });

  it("returns the current revision, ownership revision, and status when creation is replayed after transitions", async () => {
    const app = await createPostboxApp({ databasePath: ":memory:", now: () => 15_000, askTimeoutMs: 60_000, expirySweepMs: 0 });
    apps.push(app);
    const port = await listen(app);
    const socket = await connectAndRegister(port);
    const originalOwner = { harness: "pi", ownerId: "11111111-1111-4111-8111-111111111111" };
    const nextOwner = { harness: "pi", ownerId: "22222222-2222-4222-8222-222222222222" };
    await connectAndRegister(port, "session-2", nextOwner.ownerId);

    const created = nextMessage(socket);
    socket.send(JSON.stringify(askCreateMessage("ask-current-handle")));
    await created;

    const revised = nextMessage(socket);
    socket.send(JSON.stringify({
      type: "question.update",
      requestId: "revise-current-handle",
      payload: {
        sessionId: "session-1",
        questionId: "ask-current-handle",
        update: {
          action: "revise",
          expectedRevision: 1,
          expectedOwnerRevision: 1,
          question: { prompt: "Continue after the transition?", ambiguity: "Test ambiguity." }
        }
      }
    } satisfies ExtensionClientMessage));
    await expect(revised).resolves.toMatchObject({
      type: "query.result",
      payload: { questionId: "ask-current-handle", revision: 2, ownerRevision: 1, status: "pending" }
    });

    const staleAnswer = await app.inject({
      method: "POST",
      url: "/api/requests/ask-current-handle/answer",
      payload: { expectedRevision: 1, selectedValues: ["yes"] }
    });
    expect(staleAnswer.statusCode).toBe(409);
    expect(staleAnswer.json()).toMatchObject({ error: "stale_revision", message: "Question revision is stale" });

    const transferred = nextMessage(socket);
    socket.send(JSON.stringify({
      type: "question.update",
      requestId: "transfer-current-handle",
      payload: {
        sessionId: "session-1",
        questionId: "ask-current-handle",
        update: {
          action: "transfer",
          expectedRevision: 2,
          expectedOwnerRevision: 1,
          expectedOwner: originalOwner,
          owner: nextOwner
        }
      }
    } satisfies ExtensionClientMessage));
    const transferResult = await transferred;
    expect(transferResult).toMatchObject({
      type: "query.result",
      payload: { questionId: "ask-current-handle", revision: 2, ownerRevision: 2, status: "pending", owner: nextOwner }
    });

    const answerResponse = await app.inject({
      method: "POST",
      url: "/api/requests/ask-current-handle/answer",
      payload: { expectedRevision: 2, selectedValues: ["yes"] }
    });
    expect(answerResponse.statusCode).toBe(200);

    const replayMessages = nextMessages(socket, 2);
    socket.send(JSON.stringify(askCreateMessage("ask-current-handle")));
    await expect(replayMessages).resolves.toEqual([
      expect.objectContaining({
        type: "ask.created",
        payload: {
          requestId: "ask-current-handle",
          questionId: "ask-current-handle",
          revision: 2,
          ownerRevision: 2,
          status: "answered",
          disposition: "idempotent"
        }
      }),
      expect.objectContaining({ type: "ask.resolved", payload: expect.objectContaining({ status: "answered" }) })
    ]);
  });

  it("replaying an already terminal request returns the existing terminal result instead of a duplicate card", async () => {
    const app = await createPostboxApp({ databasePath: ":memory:", now: () => 20_000, askTimeoutMs: 60_000, expirySweepMs: 0 });
    apps.push(app);
    const port = await listen(app);
    const socket = await connectAndRegister(port);

    const created = nextMessage(socket);
    socket.send(JSON.stringify(askCreateMessage("ask-terminal")));
    await created;

    const answerResponse = await app.inject({
      method: "POST",
      url: "/api/requests/ask-terminal/answer",
      payload: { expectedRevision: 1, selectedValues: ["yes"], note: "Already decided" }
    });
    expect(answerResponse.statusCode).toBe(200);

    const replayMessages = nextMessages(socket, 2);
    socket.send(JSON.stringify(askCreateMessage("ask-terminal")));
    await expect(replayMessages).resolves.toEqual([
      expect.objectContaining({
        type: "ask.created",
        payload: {
          requestId: "ask-terminal",
          questionId: "ask-terminal",
          revision: 1,
          ownerRevision: 1,
          status: "answered",
          disposition: "idempotent"
        }
      }),
      expect.objectContaining({
        type: "ask.resolved",
        payload: expect.objectContaining({
          status: "answered",
          requestId: "ask-terminal",
          selectedValues: ["yes"],
          note: "Already decided"
        })
      })
    ]);

    const state = StateSnapshotSchema.parse((await app.inject({ method: "GET", url: "/api/state" })).json());
    expect(state.requests).toEqual([]);
    const history = HistoryResponseSchema.parse((await app.inject({ method: "GET", url: "/api/history" })).json());
    expect(history.history.filter((record) => record.request.requestId === "ask-terminal")).toHaveLength(1);
  });

  it("moves expired requests from live state to History and resolves waiting extension callers", async () => {
    let now = 30_000;
    const app = await createPostboxApp({ databasePath: ":memory:", now: () => now, expirySweepMs: 0 });
    apps.push(app);
    const port = await listen(app);
    const socket = await connectAndRegister(port);

    const created = nextMessage(socket);
    socket.send(JSON.stringify(askCreateMessage("ask-expire", new Date(31_000).toISOString())));
    await created;

    now = 31_001;
    const state = StateSnapshotSchema.parse((await app.inject({ method: "GET", url: "/api/state" })).json());
    expect(state.requests).toEqual([]);
    const history = HistoryResponseSchema.parse((await app.inject({ method: "GET", url: "/api/history" })).json());
    const expiredRequest = history.history[0]?.request;
    expect(expiredRequest).toMatchObject({ status: "expired", result: { status: "expired", requestId: "ask-expire" } });
    expect(AskResultSchema.parse(expiredRequest?.result)).toMatchObject({ status: "expired", requestId: "ask-expire" });
  });
});
