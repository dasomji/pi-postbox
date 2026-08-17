import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { createPostboxApp } from "../src/app.js";
import { openPostboxDatabase, type SqliteDatabase } from "../src/db/database.js";
import { RequestStore } from "../src/services/requestStore.js";
import { SessionStore } from "../src/services/sessionStore.js";

const NOW = Date.parse("2026-08-15T12:00:00.000Z");
const OWNER_A = { harness: "pi", ownerId: "agent-a" } as const;
const OWNER_B = { harness: "pi", ownerId: "agent-b" } as const;
const OWNER_C = { harness: "pi", ownerId: "agent-c" } as const;
const OWNER_D = { harness: "pi", ownerId: "agent-d" } as const;
const OWNER_E = { harness: "pi", ownerId: "agent-e" } as const;
const apps: FastifyInstance[] = [];
const databases: SqliteDatabase[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  sockets.splice(0).forEach((socket) => socket.close());
  databases.splice(0).forEach((database) => database.close());
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function register(
  sessions: SessionStore,
  sessionId: string,
  owner: { harness: string; ownerId: string },
  repositoryId: string,
  worktreeId: string,
  featureId: string
): void {
  sessions.register(`connection-${sessionId}`, {
    machine: { machineId: "machine-1", hostname: "workstation" },
    project: { projectId: `project-${sessionId}`, name: "postbox", cwd: `/workspace/${worktreeId}` },
    session: {
      sessionId,
      cwd: `/workspace/${worktreeId}`,
      semanticState: "working",
      owner,
      repository: { repositoryId },
      worktree: { worktreeId, machineId: "machine-1", path: `/workspace/${worktreeId}` },
      feature: { featureId, name: featureId }
    }
  });
}

function createQuestion(requests: RequestStore, sessionId: string, questionId: string): void {
  requests.create({
    requestId: questionId,
    sessionId,
    mode: "single",
    question: { prompt: `${questionId}?` },
    options: [{ value: "yes", label: "Yes" }],
    context: { codebaseContext: "Postbox", problemContext: "Find a scoped transfer target" }
  });
}

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

async function registerSocket(
  socket: WebSocket,
  sessionId: string,
  ownerId: string,
  worktreeId: string,
  feature: { featureId: string; name?: string } | { action: "start"; name: string } | { action: "inherit"; featureId: string } | undefined = undefined
): Promise<any> {
  const response = next(socket);
  socket.send(JSON.stringify({
    type: "session.register",
    requestId: `register-${sessionId}`,
    payload: {
      machine: { machineId: "machine-1", hostname: "workstation" },
      project: { projectId: `project-${sessionId}`, name: "postbox", cwd: `/workspace/${worktreeId}` },
      session: {
        sessionId,
        cwd: `/workspace/${worktreeId}`,
        semanticState: "working",
        owner: { harness: "pi", ownerId },
        repository: { repositoryId: "repo-1" },
        worktree: { worktreeId, machineId: "machine-1", path: `/workspace/${worktreeId}` },
        ...(feature ? { feature } : {})
      }
    }
  }));
  return response;
}

describe("scoped Postbox owner discovery", () => {
  it("derives feature, worktree, and repository membership while returning only coarse scoped queue facts", () => {
    const database = openPostboxDatabase(":memory:");
    databases.push(database);
    const sessions = new SessionStore(database, () => NOW, { staleAfterMs: 30_000, offlineAfterMs: 120_000 });
    const requests = new RequestStore(database, () => NOW);
    register(sessions, "session-a", OWNER_A, "repo-1", "worktree-1", "feature-1");
    register(sessions, "session-b", OWNER_B, "repo-1", "worktree-1", "feature-1");
    register(sessions, "session-c", OWNER_C, "repo-1", "worktree-1", "feature-2");
    register(sessions, "session-d", OWNER_D, "repo-1", "worktree-2", "feature-3");
    register(sessions, "session-e", OWNER_E, "repo-2", "worktree-3", "feature-4");
    createQuestion(requests, "session-a", "pending-a");
    createQuestion(requests, "session-b", "answered-b");
    requests.answer("answered-b", { selectedValues: ["yes"] });
    createQuestion(requests, "session-c", "pending-c");
    createQuestion(requests, "session-d", "pending-d");

    expect(sessions.listPostboxOwners("session-a")).toEqual([
      { owner: OWNER_A, presence: "live", activeQuestionCount: 1, unreadAnswerCount: 0 },
      { owner: OWNER_B, presence: "live", activeQuestionCount: 0, unreadAnswerCount: 1 }
    ]);
    expect(sessions.listPostboxOwners("session-a", "worktree").map((item) => item.owner)).toEqual([
      OWNER_A, OWNER_B, OWNER_C
    ]);
    expect(sessions.listPostboxOwners("session-a", "repository").map((item) => item.owner)).toEqual([
      OWNER_A, OWNER_B, OWNER_C, OWNER_D
    ]);
    for (const item of sessions.listPostboxOwners("session-a", "repository")) {
      expect(Object.keys(item).sort()).toEqual([
        "activeQuestionCount", "owner", "presence", "unreadAnswerCount"
      ]);
      expect(JSON.stringify(item)).not.toMatch(/heartbeat|semantic|title|path|prompt|context/i);
    }
  });

  it("authorizes the registered caller and carries derived owner lists over the WebSocket", async () => {
    const app = await createPostboxApp({ databasePath: ":memory:", expirySweepMs: 0 });
    apps.push(app);
    const caller = await connect(app);
    const first = await registerSocket(caller, "session-a", "agent-a", "worktree-1");
    const featureId = first.payload.feature.featureId;
    const peer = await connect(app);
    await registerSocket(peer, "session-b", "agent-b", "worktree-1", { action: "inherit", featureId });
    const other = await connect(app);
    await registerSocket(other, "session-c", "agent-c", "worktree-2");

    let response = next(caller);
    caller.send(JSON.stringify({
      type: "owner.list",
      requestId: "owners-feature",
      payload: { sessionId: "session-a" }
    }));
    await expect(response).resolves.toMatchObject({
      type: "query.result",
      requestId: "owners-feature",
      payload: [
        { owner: OWNER_A, presence: "live", activeQuestionCount: 0, unreadAnswerCount: 0 },
        { owner: OWNER_B, presence: "live", activeQuestionCount: 0, unreadAnswerCount: 0 }
      ]
    });

    response = next(caller);
    caller.send(JSON.stringify({
      type: "owner.list",
      requestId: "owners-repository",
      payload: { sessionId: "session-a", scope: "repository" }
    }));
    await expect(response).resolves.toMatchObject({
      type: "query.result",
      requestId: "owners-repository",
      payload: [
        { owner: OWNER_A },
        { owner: OWNER_B },
        { owner: OWNER_C }
      ]
    });

    response = next(caller);
    caller.send(JSON.stringify({
      type: "owner.list",
      requestId: "owners-foreign-session",
      payload: { sessionId: "session-b" }
    }));
    await expect(response).resolves.toMatchObject({ type: "error", requestId: "owners-foreign-session" });
  });
});
