import type { ExtensionClientMessage } from "@pi-postbox/protocol";
import type { FastifyInstance } from "fastify";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { createPostboxApp } from "../src/app.js";

const apps: FastifyInstance[] = [];
const sockets: WebSocket[] = [];
const directories: string[] = [];
const PI_SESSION_UUID = "12345678-1234-4123-8123-123456789abc";

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function port(app: FastifyInstance): number {
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("expected TCP listener");
  return address.port;
}

function nextMessage(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    socket.once("message", (data) => resolve(JSON.parse(data.toString()) as Record<string, unknown>));
    socket.once("error", reject);
  });
}

async function connectOwner(
  app: FastifyInstance,
  semanticState: "working" | "blocked" | "idle" = "working",
  beforeRegister?: (socket: WebSocket) => void
): Promise<WebSocket> {
  if (!app.server.listening) await app.listen({ host: "127.0.0.1", port: 0 });
  const socket = new WebSocket(`ws://127.0.0.1:${port(app)}/api/extension/ws`);
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  beforeRegister?.(socket);
  const registered = nextMessage(socket);
  socket.send(JSON.stringify({
    type: "session.register",
    requestId: "register-owner",
    payload: {
      machine: { machineId: "machine-1", hostname: "workstation" },
      project: { projectId: "project-1", name: "pi-postbox", cwd: "/repo" },
      session: {
        sessionId: "control-session-1",
        cwd: "/repo",
        semanticState,
        owner: { harness: "pi", ownerId: PI_SESSION_UUID },
        agentSessionId: "session-file-provenance-only",
        agentSessionPath: "/tmp/session.jsonl"
      }
    }
  } satisfies ExtensionClientMessage));
  await registered;
  return socket;
}

async function createQuestion(socket: WebSocket): Promise<Record<string, unknown>> {
  const created = nextMessage(socket);
  socket.send(JSON.stringify({
    type: "ask.create",
    requestId: "wire-question-1",
    payload: {
      requestId: "question-1",
      sessionId: "control-session-1",
      mode: "single",
      question: { prompt: "Which database should v1 use?" },
      options: [{ value: "sqlite", label: "SQLite" }],
      context: { codebaseContext: "Fastify server.", problemContext: "Choose durable storage." }
    }
  } satisfies ExtensionClientMessage));
  return created;
}

describe("one asynchronous Question-to-Answer loop", () => {
  it("reassigns an unacked ping to the replacement connection without letting the old socket ack or release it", async () => {
    const app = await createPostboxApp({ databasePath: ":memory:", expirySweepMs: 0 });
    apps.push(app);
    const first = await connectOwner(app, "idle");
    await createQuestion(first);
    const firstPingPromise = nextMessage(first);
    const answered = await app.inject({ method: "POST", url: "/api/requests/question-1/answer",
      payload: { expectedRevision: 1, selectedValues: ["sqlite"] } });
    const firstPing = await firstPingPromise;
    const replacementPingPromise = new Promise<Record<string, unknown>>((resolve) => {
      void connectOwner(app, "idle", (socket) => socket.on("message", (data) => {
        const message = JSON.parse(data.toString()) as Record<string, unknown>;
        if (message.type === "answer.available") resolve(message);
      }));
    });
    const replacementPing = await replacementPingPromise;
    expect(replacementPing).toMatchObject({ type: "answer.available", payload: { answerId: answered.json().result.answerId } });
    first.send(JSON.stringify({ type: "answer.available.ack", requestId: firstPing.requestId as string,
      payload: { answerId: answered.json().result.answerId } } satisfies ExtensionClientMessage));
    first.close();
    const replacement = sockets.at(-1)!;
    replacement.send(JSON.stringify({ type: "answer.available.ack", requestId: replacementPing.requestId as string,
      payload: { answerId: answered.json().result.answerId } } satisfies ExtensionClientMessage));
    const barrier = nextMessage(replacement);
    replacement.send(JSON.stringify({ type: "heartbeat", requestId: "ack-race-barrier",
      payload: { sessionId: "control-session-1", semanticState: "idle" } } satisfies ExtensionClientMessage));
    await expect(barrier).resolves.toMatchObject({ type: "ack", requestId: "ack-race-barrier" });
  });

  it("replays a send-before-ack claim after server restart for client-side durable dedupe", async () => {
    const directory = await mkdtemp(join(tmpdir(), "postbox-answer-claim-restart-")); directories.push(directory);
    const databasePath = join(directory, "postbox.sqlite");
    let app = await createPostboxApp({ databasePath, expirySweepMs: 0 }); apps.push(app);
    const first = await connectOwner(app, "idle"); await createQuestion(first);
    const firstPing = nextMessage(first);
    await app.inject({ method: "POST", url: "/api/requests/question-1/answer", payload: { expectedRevision: 1, selectedValues: ["sqlite"] } });
    const sent = await firstPing;
    await app.close(); apps.pop();
    app = await createPostboxApp({ databasePath, expirySweepMs: 0 }); apps.push(app);
    const replay = new Promise<Record<string, unknown>>((resolve) => {
      void connectOwner(app, "idle", (socket) => socket.on("message", (data) => {
        const message = JSON.parse(data.toString()) as Record<string, unknown>;
        if (message.type === "answer.available") resolve(message);
      }));
    });
    await expect(replay).resolves.toMatchObject({ type: "answer.available", payload: { answerId: (sent.payload as any).answerId } });
  });

  it("settles a displaced correlated wait when the same session connection is replaced", async () => {
    const app = await createPostboxApp({ databasePath: ":memory:", expirySweepMs: 0 });
    apps.push(app);
    const first = await connectOwner(app);
    await createQuestion(first);
    const displaced = nextMessage(first);
    first.send(JSON.stringify({ type: "postbox.wait", requestId: "wait-displaced", payload: { sessionId: "control-session-1" } } satisfies ExtensionClientMessage));
    await connectOwner(app);
    await expect(displaced).resolves.toMatchObject({ type: "postbox.wait.result", requestId: "wait-displaced",
      payload: { type: "lifecycle", event: "connection_replaced", sessionId: "control-session-1" } });
  });

  it("replays the durable notification after disconnect/restart and waits while the owner is blocked", async () => {
    const directory = await mkdtemp(join(tmpdir(), "postbox-answer-outbox-"));
    directories.push(directory);
    const databasePath = join(directory, "postbox.sqlite");
    let app = await createPostboxApp({ databasePath, expirySweepMs: 0 });
    apps.push(app);
    const creator = await connectOwner(app);
    await createQuestion(creator);
    creator.close();
    await app.inject({ method: "POST", url: "/api/requests/question-1/answer", payload: { expectedRevision: 1, selectedValues: ["sqlite"] } });
    await app.close();
    apps.pop();

    app = await createPostboxApp({ databasePath, expirySweepMs: 0 });
    apps.push(app);
    const observed: Record<string, unknown>[] = [];
    const owner = await connectOwner(app, "blocked", (socket) => socket.on("message", (data) => {
      const message = JSON.parse(data.toString()) as Record<string, unknown>;
      if (message.type === "answer.available") observed.push(message);
    }));
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(observed).toEqual([]);

    const notification = new Promise<Record<string, unknown>>((resolve) => {
      const listener = (data: WebSocket.RawData) => {
        const message = JSON.parse(data.toString()) as Record<string, unknown>;
        if (message.type === "answer.available") { owner.off("message", listener); resolve(message); }
      };
      owner.on("message", listener);
    });
    const updated = nextMessage(owner);
    owner.send(JSON.stringify({ type: "session.update", payload: { sessionId: "control-session-1", semanticState: "idle" } } satisfies ExtensionClientMessage));
    expect(await updated).toMatchObject({ type: "ack", payload: { type: "session.update" } });
    const replay = await notification;
    expect(observed).toHaveLength(1);
    expect(replay).toMatchObject({ type: "answer.available", payload: {
      questionId: "question-1", question: "Which database should v1 use?", answerId: expect.any(String)
    } });
    owner.send(JSON.stringify({ type: "answer.available.ack", requestId: replay.requestId as string,
      payload: { answerId: (replay.payload as { answerId: string }).answerId } } satisfies ExtensionClientMessage));
    const ackBarrier = nextMessage(owner);
    owner.send(JSON.stringify({ type: "heartbeat", requestId: "after-answer-ack",
      payload: { sessionId: "control-session-1", semanticState: "working" } } satisfies ExtensionClientMessage));
    await expect(ackBarrier).resolves.toMatchObject({ type: "ack", requestId: "after-answer-ack", payload: { type: "heartbeat" } });
    owner.close();
    await app.close();
    apps.pop();
    app = await createPostboxApp({ databasePath, expirySweepMs: 0 });
    apps.push(app);
    const afterRestart: Record<string, unknown>[] = [];
    await connectOwner(app, "working", (socket) => socket.on("message", (data) => {
      const message = JSON.parse(data.toString()) as Record<string, unknown>;
      if (message.type === "answer.available") afterRestart.push(message);
    }));
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(afterRestart).toEqual([]);
  });

  it("keeps a pending owner-addressed Question across disconnect and restart with no default expiry", async () => {
    const directory = await mkdtemp(join(tmpdir(), "postbox-async-question-"));
    directories.push(directory);
    const databasePath = join(directory, "postbox.sqlite");
    let app = await createPostboxApp({ databasePath, expirySweepMs: 0 });
    apps.push(app);
    const socket = await connectOwner(app, "idle");

    await expect(createQuestion(socket)).resolves.toMatchObject({
      type: "ask.created",
      payload: { requestId: "question-1", status: "pending" }
    });
    socket.close();
    await app.close();
    apps.pop();

    app = await createPostboxApp({ databasePath, expirySweepMs: 0 });
    apps.push(app);
    const pending = (await app.inject({ method: "GET", url: "/api/requests?status=pending" })).json().requests[0];
    expect(pending).toMatchObject({ requestId: "question-1", status: "pending" });
    expect(pending.expiresAt).toBeUndefined();
  });

  it("creates an unread Answer ID and sends the connected owner one content-free ping", async () => {
    const app = await createPostboxApp({ databasePath: ":memory:", expirySweepMs: 0 });
    apps.push(app);
    const socket = await connectOwner(app, "idle");
    await createQuestion(socket);

    const ping = nextMessage(socket);
    const response = await app.inject({
      method: "POST",
      url: "/api/requests/question-1/answer",
      payload: { expectedRevision: 1, selectedValues: ["sqlite"], note: "Keep it local" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().result).toMatchObject({
      questionId: "question-1",
      answerId: expect.any(String),
      status: "answered",
      alreadyRead: false
    });
    expect(response.json().result.answerId).not.toBe("question-1");
    expect(await ping).toEqual({
      type: "answer.available",
      requestId: `answer_available_${response.json().result.answerId}`,
      payload: {
        questionId: "question-1",
        question: "Which database should v1 use?",
        answerId: response.json().result.answerId
      }
    });
  });

  it("returns an immediate explicit lifecycle result for a cancelled Question", async () => {
    const app = await createPostboxApp({ databasePath: ":memory:", expirySweepMs: 0 });
    apps.push(app);
    const socket = await connectOwner(app, "idle");
    await createQuestion(socket);

    const cancellation = await app.inject({
      method: "POST",
      url: "/api/requests/question-1/cancel",
      payload: { note: "The decision is no longer needed" }
    });
    expect(cancellation.statusCode).toBe(200);

    const response = nextMessage(socket);
    socket.send(JSON.stringify({
      type: "answer.get",
      requestId: "read-cancelled",
      payload: { questionId: "question-1" }
    } satisfies ExtensionClientMessage));
    const result = await response;
    expect(result).toMatchObject({
      type: "answer.result",
      requestId: "read-cancelled",
      payload: {
        type: "lifecycle",
        status: "cancelled",
        questionId: "question-1",
        note: "The decision is no longer needed",
        resolvedAt: expect.any(String)
      }
    });
    expect(result.payload).not.toHaveProperty("question");
    expect(result.payload).not.toHaveProperty("answer");
    expect(result.payload).not.toHaveProperty("answerId");
    expect(result.payload).not.toHaveProperty("alreadyRead");
  });

  it("returns only the compact Answer contract and keeps repeated reads stable", async () => {
    const app = await createPostboxApp({ databasePath: ":memory:", expirySweepMs: 0 });
    apps.push(app);
    const socket = await connectOwner(app, "idle");
    await createQuestion(socket);
    const notification = nextMessage(socket);
    await app.inject({
      method: "POST",
      url: "/api/requests/question-1/answer",
      payload: { expectedRevision: 1, selectedValues: ["sqlite"], note: "Keep it local" }
    });
    await notification;

    const read = async (requestId: string) => {
      const response = nextMessage(socket);
      socket.send(JSON.stringify({ type: "answer.get", requestId, payload: { questionId: "question-1" } } satisfies ExtensionClientMessage));
      return response;
    };
    const reads = [await read("read-1"), await read("read-2")];
    for (const result of reads) {
      expect(result).toMatchObject({
        type: "answer.result",
        payload: {
          questionId: "question-1",
          answerId: expect.any(String),
          answer: ["sqlite"],
          note: "Keep it local"
        }
      });
      expect(Object.keys(result.payload as object).sort()).toEqual(["answer", "answerId", "note", "questionId"]);
    }
    expect((reads[1].payload as any).answerId).toBe((reads[0].payload as any).answerId);
  });
});
