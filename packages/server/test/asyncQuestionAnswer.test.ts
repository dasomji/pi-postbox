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
  semanticState: "working" | "blocked" = "working",
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
    awaitAnswer: false,
    payload: {
      requestId: "question-1",
      sessionId: "control-session-1",
      mode: "single",
      urgency: "normal",
      question: { prompt: "Which database should v1 use?" },
      options: [{ value: "sqlite", label: "SQLite" }],
      context: { codebaseContext: "Fastify server.", problemContext: "Choose durable storage." }
    }
  } satisfies ExtensionClientMessage));
  return created;
}

describe("one asynchronous Question-to-Answer loop", () => {
  it("replays the durable notification after disconnect/restart and waits while the owner is blocked", async () => {
    const directory = await mkdtemp(join(tmpdir(), "postbox-answer-outbox-"));
    directories.push(directory);
    const databasePath = join(directory, "postbox.sqlite");
    let app = await createPostboxApp({ databasePath, expirySweepMs: 0 });
    apps.push(app);
    const creator = await connectOwner(app);
    await createQuestion(creator);
    creator.close();
    await app.inject({ method: "POST", url: "/api/requests/question-1/answer", payload: { selectedValues: ["sqlite"] } });
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
    owner.send(JSON.stringify({ type: "session.update", payload: { sessionId: "control-session-1", semanticState: "working" } } satisfies ExtensionClientMessage));
    expect(await updated).toMatchObject({ type: "ack", payload: { type: "session.update" } });
    const replay = await notification;
    expect(observed).toHaveLength(1);
    expect(replay).toMatchObject({ type: "answer.available", payload: {
      questionId: "question-1", question: "Which database should v1 use?", answerId: expect.any(String)
    } });
    owner.send(JSON.stringify({ type: "answer.available.ack", requestId: replay.requestId as string,
      payload: { answerId: (replay.payload as { answerId: string }).answerId } } satisfies ExtensionClientMessage));
    await new Promise((resolve) => setTimeout(resolve, 10));
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
    const socket = await connectOwner(app);

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
    const socket = await connectOwner(app);
    await createQuestion(socket);

    const ping = nextMessage(socket);
    const response = await app.inject({
      method: "POST",
      url: "/api/requests/question-1/answer",
      payload: { selectedValues: ["sqlite"], note: "Keep it local", rationale: "Simple persistence" }
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

  it("atomically records the first get_answer reader and retains full content for later readers", async () => {
    const app = await createPostboxApp({ databasePath: ":memory:", expirySweepMs: 0 });
    apps.push(app);
    const socket = await connectOwner(app);
    await createQuestion(socket);
    const notification = nextMessage(socket);
    await app.inject({
      method: "POST",
      url: "/api/requests/question-1/answer",
      payload: { selectedValues: ["sqlite"], note: "Keep it local", rationale: "Simple persistence" }
    });
    await notification;

    const read = async (requestId: string) => {
      const response = nextMessage(socket);
      socket.send(JSON.stringify({ type: "answer.get", requestId, payload: { questionId: "question-1" } } satisfies ExtensionClientMessage));
      return response;
    };
    const reads = [await read("read-1"), await read("read-2")];
    expect(reads.filter((result) => (result.payload as { alreadyRead: boolean }).alreadyRead === false)).toHaveLength(1);
    expect(reads.filter((result) => (result.payload as { alreadyRead: boolean }).alreadyRead === true)).toHaveLength(1);
    for (const result of reads) {
      expect(result).toMatchObject({
        type: "answer.result",
        payload: {
        question: { questionId: "question-1", revision: 1, question: { prompt: "Which database should v1 use?" } },
        answer: {
          answerId: expect.any(String),
          selectedValues: ["sqlite"],
          note: "Keep it local",
          rationale: "Simple persistence"
        },
        firstRead: { reader: { harness: "pi", ownerId: PI_SESSION_UUID } }
        }
      });
    }
  });
});
