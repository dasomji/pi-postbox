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

async function connectOwner(app: FastifyInstance): Promise<WebSocket> {
  if (!app.server.listening) await app.listen({ host: "127.0.0.1", port: 0 });
  const socket = new WebSocket(`ws://127.0.0.1:${port(app)}/api/extension/ws`);
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
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
        semanticState: "working",
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
      urgency: "normal",
      question: { prompt: "Which database should v1 use?" },
      options: [{ value: "sqlite", label: "SQLite" }],
      context: { codebaseContext: "Fastify server.", problemContext: "Choose durable storage." }
    }
  } satisfies ExtensionClientMessage));
  return created;
}

describe("one asynchronous Question-to-Answer loop", () => {
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
    await app.inject({
      method: "POST",
      url: "/api/requests/question-1/answer",
      payload: { selectedValues: ["sqlite"], note: "Keep it local", rationale: "Simple persistence" }
    });

    const read = () => app.inject({
      method: "POST",
      url: "/api/questions/question-1/get-answer",
      payload: { reader: { harness: "pi", ownerId: PI_SESSION_UUID } }
    });
    const [first, competing] = await Promise.all([read(), read()]);
    expect([first.statusCode, competing.statusCode]).toEqual([200, 200]);
    const reads = [first.json(), competing.json()];
    expect(reads.filter((result) => result.alreadyRead === false)).toHaveLength(1);
    expect(reads.filter((result) => result.alreadyRead === true)).toHaveLength(1);
    for (const result of reads) {
      expect(result).toMatchObject({
        question: { questionId: "question-1", prompt: "Which database should v1 use?", revision: 1 },
        answer: {
          answerId: expect.any(String),
          selectedValues: ["sqlite"],
          note: "Keep it local",
          rationale: "Simple persistence"
        },
        firstReader: { harness: "pi", ownerId: PI_SESSION_UUID }
      });
    }
  });
});
