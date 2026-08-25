import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { createPostboxApp } from "../src/app.js";

const apps: FastifyInstance[] = [];
const sockets: WebSocket[] = [];
const OWNER = { harness: "pi", ownerId: "transport-agent" } as const;

afterEach(async () => {
  sockets.splice(0).forEach((socket) => socket.close());
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function connect(app: FastifyInstance): Promise<WebSocket> {
  if (!app.server.listening) await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("expected listener");
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/extension/ws`);
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return socket;
}

function next(socket: WebSocket): Promise<any> {
  return new Promise((resolve, reject) => {
    socket.once("message", (raw) => resolve(JSON.parse(raw.toString())));
    socket.once("error", reject);
  });
}

async function send(socket: WebSocket, message: Record<string, unknown>): Promise<any> {
  const response = next(socket);
  socket.send(JSON.stringify(message));
  return response;
}

describe("output-reduced WebSocket transport", () => {
  it("carries compact batches, explicit full views, event history, and pending Answer results", async () => {
    const app = await createPostboxApp({ databasePath: ":memory:", expirySweepMs: 0 });
    apps.push(app);
    const socket = await connect(app);
    await expect(send(socket, {
      type: "session.register",
      requestId: "register",
      payload: {
        machine: { machineId: "machine-1", hostname: "workstation" },
        project: { projectId: "project-1", name: "postbox", cwd: "/workspace/postbox" },
        session: {
          sessionId: "session-1",
          cwd: "/workspace/postbox",
          semanticState: "working",
          owner: OWNER,
          repository: { repositoryId: "repo-1" },
          worktree: { worktreeId: "worktree-1", machineId: "machine-1", path: "/workspace/postbox" }
        }
      }
    })).resolves.toMatchObject({ type: "registered", requestId: "register" });

    const batchQuestions = [
      {
        localRef: "root",
        requestId: "transport-root",
        mode: "single",
        question: { prompt: "Root transport Question?", ambiguity: "Test ambiguity." },
        options: [{ value: "yes", label: "Yes" }]
      },
      {
        localRef: "child",
        requestId: "transport-child",
        mode: "single",
        question: { prompt: "Child transport Question?", ambiguity: "Test ambiguity." },
        options: [{ value: "yes", label: "Yes" }],
        parentLocalRef: "root"
      }
    ];
    await expect(send(socket, {
      type: "ask.batch.create",
      requestId: "batch",
      payload: { sessionId: "session-1", questions: batchQuestions }
    })).resolves.toMatchObject({
      type: "ask.batch.result",
      requestId: "batch",
      payload: {
        status: "created",
        items: [
          {
            localRef: "root",
            status: "created",
            questionId: "transport-root",
            revision: 1,
            ownerRevision: 1,
            questionStatus: "pending",
            disposition: "created"
          },
          {
            localRef: "child",
            status: "created",
            questionId: "transport-child",
            revision: 1,
            ownerRevision: 1,
            questionStatus: "pending",
            disposition: "created"
          }
        ]
      }
    });

    const controls = await send(socket, {
      type: "questions.get",
      requestId: "controls",
      payload: { questionIds: ["transport-root"] }
    });
    expect(controls).toMatchObject({
      type: "query.result",
      requestId: "controls",
      payload: [{ questionId: "transport-root", revision: 1, ownerRevision: 1, status: "pending", owner: OWNER }]
    });
    expect(controls.payload[0]).not.toHaveProperty("question");
    expect(controls.payload[0]).not.toHaveProperty("context");

    const full = await send(socket, {
      type: "questions.get",
      requestId: "full",
      payload: { questionIds: ["transport-root", "transport-child"], view: "full" }
    });
    expect(full.payload[0]).toMatchObject({ question: { prompt: "Root transport Question?", ambiguity: "Test ambiguity." } });
    expect(full.payload[1]).toMatchObject({ question: { prompt: "Child transport Question?", ambiguity: "Test ambiguity." } });
    expect(full.payload.every((question: object) => !("context" in question))).toBe(true);

    await expect(send(socket, {
      type: "question.update",
      requestId: "revise",
      payload: {
        sessionId: "session-1",
        questionId: "transport-root",
        update: {
          action: "revise",
          expectedRevision: 1,
          expectedOwnerRevision: 1,
          question: { prompt: "Revised transport Question?", ambiguity: "Test ambiguity." }
        }
      }
    })).resolves.toMatchObject({ type: "query.result", requestId: "revise", payload: { revision: 2 } });

    await expect(send(socket, {
      type: "ask.batch.create",
      requestId: "batch-replay",
      payload: { sessionId: "session-1", questions: batchQuestions }
    })).resolves.toMatchObject({
      type: "ask.batch.result",
      payload: {
        status: "created",
        items: [
          {
            localRef: "root",
            questionId: "transport-root",
            revision: 2,
            ownerRevision: 1,
            questionStatus: "pending",
            disposition: "idempotent"
          },
          {
            localRef: "child",
            questionId: "transport-child",
            revision: 1,
            ownerRevision: 1,
            questionStatus: "pending",
            disposition: "idempotent"
          }
        ]
      }
    });

    const events = await send(socket, {
      type: "question.history.get",
      requestId: "history-events",
      payload: { questionId: "transport-root" }
    });
    expect(events.payload).toMatchObject({
      questionId: "transport-root",
      initial: { revision: 1, question: { prompt: "Root transport Question?", ambiguity: "Test ambiguity." } },
      revisions: [{ revision: 2, question: { prompt: "Revised transport Question?", ambiguity: "Test ambiguity." } }],
      events: []
    });

    const historyFull = await send(socket, {
      type: "question.history.get",
      requestId: "history-full",
      payload: { questionId: "transport-root", view: "full" }
    });
    expect(historyFull.payload.revisions).toHaveLength(2);
    expect(historyFull.payload.events).toContainEqual(expect.objectContaining({ type: "revision", revision: 2 }));

    await expect(send(socket, {
      type: "answer.get",
      requestId: "answer-pending",
      payload: { questionId: "transport-root" }
    })).resolves.toEqual({
      type: "answer.result",
      requestId: "answer-pending",
      payload: { type: "pending", status: "pending", questionId: "transport-root" }
    });
  });

  it("defaults recovery reads to compact output and transports an explicit full view", async () => {
    let now = Date.parse("2026-08-18T12:00:00.000Z");
    const app = await createPostboxApp({
      databasePath: ":memory:",
      expirySweepMs: 0,
      now: () => now,
      staleAfterMs: 100,
      offlineAfterMs: 500
    });
    apps.push(app);
    const creatorSocket = await connect(app);
    await send(creatorSocket, {
      type: "session.register",
      requestId: "register-creator",
      payload: {
        machine: { machineId: "machine-1", hostname: "workstation" },
        project: { projectId: "project-1", name: "postbox", cwd: "/workspace/postbox" },
        session: { sessionId: "creator-session", cwd: "/workspace/postbox", semanticState: "working", owner: OWNER }
      }
    });
    await send(creatorSocket, {
      type: "ask.create",
      requestId: "create-recovery",
      payload: {
        requestId: "recovery-question",
        sessionId: "creator-session",
        mode: "single",
        question: { prompt: "Recover compactly?", ambiguity: "Test ambiguity." },
        options: [{ value: "yes", label: "Yes" }],

      }
    });
    const answered = await send(creatorSocket, {
      type: "ask.answer",
      requestId: "answer-recovery",
      payload: {
        requestId: "recovery-question",
        answer: { expectedRevision: 1, selectedValues: ["yes"], note: "Recovered." }
      }
    });
    const answerId = answered.payload.answerId;
    await new Promise<void>((resolve) => {
      creatorSocket.once("close", () => resolve());
      creatorSocket.close();
    });
    now += 1_000;

    const recoverySocket = await connect(app);
    const recoveryOwner = { harness: "claude-code", ownerId: "recovery-agent" };
    await send(recoverySocket, {
      type: "session.register",
      requestId: "register-recovery",
      payload: {
        machine: { machineId: "machine-1", hostname: "workstation" },
        project: { projectId: "project-1", name: "postbox", cwd: "/workspace/postbox" },
        session: { sessionId: "recovery-session", cwd: "/workspace/postbox", semanticState: "working", owner: recoveryOwner }
      }
    });

    const compact = await send(recoverySocket, {
      type: "question.answer.recover",
      requestId: "recover-compact",
      payload: { sessionId: "recovery-session", questionId: "recovery-question" }
    });
    expect(compact).toEqual({
      type: "query.result",
      requestId: "recover-compact",
      payload: {
        questionId: "recovery-question",
        answerId,
        answer: ["yes"],
        note: "Recovered.",
        alreadyRead: false,
        firstRead: { reader: recoveryOwner, readAt: "2026-08-18T12:00:01.000Z" }
      }
    });
    expect(compact.payload).not.toHaveProperty("question");

    const full = await send(recoverySocket, {
      type: "question.answer.recover",
      requestId: "recover-full",
      payload: { sessionId: "recovery-session", questionId: "recovery-question", view: "full" }
    });
    expect(full).toMatchObject({
      type: "query.result",
      requestId: "recover-full",
      payload: {
        alreadyRead: true,
        question: { questionId: "recovery-question", question: { prompt: "Recover compactly?", ambiguity: "Test ambiguity." } },
        answer: { answerId, selectedValues: ["yes"], note: "Recovered." },
        firstRead: { reader: recoveryOwner, readAt: "2026-08-18T12:00:01.000Z" }
      }
    });
  });
});
