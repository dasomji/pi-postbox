import { StateSnapshotSchema, type ExtensionClientMessage } from "@pi-postbox/protocol";
import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { createPostboxApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const START_MS = Date.parse("2026-06-25T12:00:00.000Z");

const apps: Array<{ close: () => Promise<void> }> = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
  }
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function registrationMessage(sessionId = "session-1"): ExtensionClientMessage {
  return {
    type: "session.register",
    requestId: `register-${sessionId}`,
    payload: {
      machine: { machineId: "machine-1", hostname: "workstation" },
      project: {
        projectId: "project-1",
        name: "pi-postbox",
        cwd: "/repo/pi-postbox",
        branch: "feature/session-cleanup"
      },
      session: {
        sessionId,
        title: "Session cleanup",
        cwd: "/repo/pi-postbox",
        branch: "feature/session-cleanup",
        semanticState: "working"
      }
    }
  };
}

function listenerPort(app: FastifyInstance): number {
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP listener");
  return address.port;
}

function nextMessage(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    socket.once("message", (raw) => resolve(JSON.parse(raw.toString())));
    socket.once("error", reject);
  });
}

async function connectAndRegister(app: FastifyInstance, sessionId = "session-1"): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${listenerPort(app)}/api/extension/ws`);
  sockets.push(socket);

  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });

  const registered = nextMessage(socket);
  socket.send(JSON.stringify(registrationMessage(sessionId)));
  await expect(registered).resolves.toMatchObject({ type: "registered" });

  return socket;
}

async function createAsk(socket: WebSocket, requestId: string, sessionId = "session-1"): Promise<void> {
  const created = nextMessage(socket);
  socket.send(
    JSON.stringify({
      type: "ask.create",
      requestId: `wire-${requestId}`,
      payload: {
        requestId,
        sessionId,
        mode: "single",
        question: { prompt: "Keep this session visible?" },
        options: [
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" }
        ]
      }
    } satisfies ExtensionClientMessage)
  );
  await expect(created).resolves.toMatchObject({ type: "ask.created", payload: { requestId, status: "pending" } });
}

async function disconnect(app: FastifyInstance, socket: WebSocket): Promise<void> {
  socket.close();
  // The server records disconnected_at asynchronously when the socket closes.
  await expect
    .poll(async () => {
      const snapshot = StateSnapshotSchema.parse((await app.inject({ method: "GET", url: "/api/state" })).json());
      return snapshot.sessions[0]?.disconnectedAt;
    })
    .toBeTruthy();
}

async function fetchSnapshot(app: FastifyInstance) {
  const response = await app.inject({ method: "GET", url: "/api/state" });
  expect(response.statusCode).toBe(200);
  return StateSnapshotSchema.parse(response.json());
}

describe("session cleanup", () => {
  it.each([
    { staleAfterMs: 5_000, expectedPresence: "live" as const },
    { staleAfterMs: 500, expectedPresence: "stale" as const }
  ])(
    "keeps a connected $expectedPresence session when cleanup windows are shorter than offline detection",
    async ({ staleAfterMs, expectedPresence }) => {
      let nowMs = START_MS;
      const app = await createPostboxApp({
        databasePath: ":memory:",
        now: () => nowMs,
        staleAfterMs,
        offlineAfterMs: 5_000,
        sessionHideOfflineAfterMs: 1_000,
        sessionRetentionMs: 1_000
      });
      apps.push(app);
      await app.listen({ host: "127.0.0.1", port: 0 });
      await connectAndRegister(app);

      nowMs += 2_000;
      const snapshot = await fetchSnapshot(app);
      expect(snapshot.sessions).toMatchObject([
        { sessionId: "session-1", presence: expectedPresence }
      ]);

      // Snapshot generation also runs retention cleanup. A successful rename
      // proves the session's project was not swept while its socket was live.
      const rename = await app.inject({
        method: "POST",
        url: "/api/projects/project-1/rename",
        payload: { displayName: "Still connected" }
      });
      expect(rename.statusCode).toBe(200);
    }
  );

  it("rejects invalid programmatic cleanup durations", async () => {
    const invalidValues = [0, -1, 1.5, Number.MAX_SAFE_INTEGER];

    for (const value of invalidValues) {
      await expect(
        createPostboxApp({
          databasePath: ":memory:",
          now: () => START_MS,
          sessionHideOfflineAfterMs: value
        })
      ).rejects.toThrow(/hideOfflineAfterMs must be a positive safe integer within the supported date range/);
      await expect(
        createPostboxApp({
          databasePath: ":memory:",
          now: () => START_MS,
          sessionRetentionMs: value
        })
      ).rejects.toThrow(/retentionMs must be a positive safe integer within the supported date range/);
    }
  });

  it("hides sessions from the snapshot once they have been offline past the hide window", async () => {
    let nowMs = START_MS;
    const app = await createPostboxApp({ databasePath: ":memory:", now: () => nowMs });
    apps.push(app);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const socket = await connectAndRegister(app);
    await disconnect(app, socket);

    nowMs += 23 * HOUR_MS;
    expect((await fetchSnapshot(app)).sessions).toHaveLength(1);

    nowMs += 2 * HOUR_MS;
    expect((await fetchSnapshot(app)).sessions).toHaveLength(0);
  });

  it("keeps a long-offline session in the snapshot while it still has a pending question", async () => {
    let nowMs = START_MS;
    const app = await createPostboxApp({ databasePath: ":memory:", now: () => nowMs, askTimeoutMs: 365 * DAY_MS });
    apps.push(app);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const socket = await connectAndRegister(app);
    await createAsk(socket, "ask-visible");
    await disconnect(app, socket);

    nowMs += 3 * DAY_MS;
    const snapshot = await fetchSnapshot(app);
    expect(snapshot.sessions.map((session) => session.sessionId)).toEqual(["session-1"]);
    expect(snapshot.requests.map((request) => request.requestId)).toEqual(["ask-visible"]);
  });

  it("deletes sessions past the retention window, including orphaned machines and projects", async () => {
    let nowMs = START_MS;
    const app = await createPostboxApp({ databasePath: ":memory:", now: () => nowMs });
    apps.push(app);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const socket = await connectAndRegister(app);
    await disconnect(app, socket);

    nowMs += 31 * DAY_MS;
    expect((await fetchSnapshot(app)).sessions).toHaveLength(0);

    // The project row was swept with the session, so renaming it now 404s.
    const rename = await app.inject({
      method: "POST",
      url: "/api/projects/project-1/rename",
      payload: { displayName: "Renamed" }
    });
    expect(rename.statusCode).toBe(404);
  });

  it("preserves sessions referenced by resolved questions so history keeps working", async () => {
    let nowMs = START_MS;
    const app = await createPostboxApp({ databasePath: ":memory:", now: () => nowMs });
    apps.push(app);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const socket = await connectAndRegister(app);
    await createAsk(socket, "ask-history");

    const answer = await app.inject({
      method: "POST",
      url: "/api/requests/ask-history/answer",
      payload: { selectedValues: ["yes"] }
    });
    expect(answer.statusCode).toBe(200);
    await disconnect(app, socket);

    nowMs += 31 * DAY_MS;
    expect((await fetchSnapshot(app)).sessions).toHaveLength(0);

    const history = await app.inject({ method: "GET", url: "/api/history" });
    expect(history.statusCode).toBe(200);
    expect(history.json()).toMatchObject({
      history: [{ request: { requestId: "ask-history" }, session: { sessionId: "session-1" } }]
    });
  });

  it("purges a session once history pruning has dropped its resolved questions", async () => {
    let nowMs = START_MS;
    const app = await createPostboxApp({
      databasePath: ":memory:",
      now: () => nowMs,
      historyRetentionMaxAgeMs: 40 * DAY_MS
    });
    apps.push(app);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const socket = await connectAndRegister(app);
    await createAsk(socket, "ask-pruned");

    const answer = await app.inject({
      method: "POST",
      url: "/api/requests/ask-pruned/answer",
      payload: { selectedValues: ["yes"] }
    });
    expect(answer.statusCode).toBe(200);
    await disconnect(app, socket);

    // Within history retention the session row must survive the purge.
    nowMs += 35 * DAY_MS;
    await fetchSnapshot(app);
    expect((await app.inject({ method: "GET", url: "/api/history" })).json().history).toHaveLength(1);

    // After history retention lapses, the request is pruned and the session follows.
    nowMs += 10 * DAY_MS;
    await fetchSnapshot(app);
    expect((await app.inject({ method: "GET", url: "/api/history" })).json().history).toHaveLength(0);
    const rename = await app.inject({
      method: "POST",
      url: "/api/projects/project-1/rename",
      payload: { displayName: "Renamed" }
    });
    expect(rename.statusCode).toBe(404);
  });
});
