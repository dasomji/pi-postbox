import {
  HistoryResponseSchema,
  StateSnapshotSchema,
  type ExtensionClientMessage
} from "@pi-postbox/protocol";
import Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { createPostboxApp } from "../src/app.js";

const apps: FastifyInstance[] = [];
const sockets: WebSocket[] = [];

function listenerPort(app: FastifyInstance): number {
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP listener");
  return address.port;
}

function registrationMessage(sessionId = "session-history-1", projectId = "project-history-1"): ExtensionClientMessage {
  return {
    type: "session.register",
    requestId: `register-${sessionId}`,
    payload: {
      machine: { machineId: "machine-history-1", hostname: "studio-host", displayName: "Studio" },
      project: {
        projectId,
        name: "pi-postbox",
        displayName: "Postbox History",
        description: "Decision audit trail",
        cwd: "/worktrees/history",
        gitRoot: "/worktrees/history",
        repoName: "pi-postbox",
        branch: "feature/history",
        headSha: "abcdef0123456789abcdef0123456789abcdef01",
        isDirty: false,
        worktreePath: "/worktrees/history",
        icon: {
          hash: "sha256:history-icon",
          dataUrl: "data:image/svg+xml;base64,PHN2Zy8+",
          mediaType: "image/svg+xml",
          sizeBytes: 6
        }
      },
      session: {
        sessionId,
        title: "History worker",
        cwd: "/worktrees/history",
        branch: "feature/history",
        worktreePath: "/worktrees/history",
        semanticState: "blocked"
      }
    }
  };
}

async function connectAndRegister(app: FastifyInstance, message = registrationMessage()): Promise<WebSocket> {
  await app.listen({ host: "127.0.0.1", port: 0 });
  const socket = new WebSocket(`ws://127.0.0.1:${listenerPort(app)}/api/extension/ws`);
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const registered = nextMessage(socket);
  socket.send(JSON.stringify(message));
  await expect(registered).resolves.toMatchObject({ type: "registered" });
  return socket;
}

function nextMessage(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    socket.once("message", (raw) => resolve(JSON.parse(raw.toString())));
    socket.once("error", reject);
  });
}

function askCreateMessage(requestId: string, prompt = `Question ${requestId}`): ExtensionClientMessage {
  return {
    type: "ask.create",
    requestId: `wire-${requestId}`,
    payload: {
      requestId,
      sessionId: "session-history-1",
      mode: "single",
      question: {
        prompt,
        context: "A focused decision needs an audit trail.",
        relevance: "History helps understand prior choices.",
        decisionImpact: "This affects later implementation slices."
      },
      options: [
        {
          value: "ship",
          label: "Ship it",
          meaning: "Proceed with the implementation.",
          context: "The user accepts this direction."
        },
        { value: "hold", label: "Hold" }
      ],
      context: {
        codebaseContext: "Fastify + SQLite request storage already persists rich ask context.",
        problemContext: "The user needs decision audit records without full chat transcripts.",
        additionalInfo: [{ kind: "code", title: "No transcript", content: "history stores ask payloads, not chats", language: "text" }]
      },
      forkReference: { agentSessionId: "agent-history", leafId: "leaf-history", cwd: "/worktrees/history" }
    }
  };
}

async function createAsk(socket: WebSocket, requestId: string): Promise<void> {
  const created = nextMessage(socket);
  socket.send(JSON.stringify(askCreateMessage(requestId)));
  await expect(created).resolves.toMatchObject({ type: "ask.created", payload: { requestId, status: "pending" } });
}

afterEach(async () => {
  for (const socket of sockets.splice(0)) {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
  }
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("question history", () => {
  it("loads legacy persisted questions without inventing context in state or History", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-postbox-legacy-context-db-"));
    const databasePath = join(dir, "postbox.sqlite");

    try {
      let app = await createPostboxApp({ databasePath, now: () => 1_000, expirySweepMs: 0 });
      apps.push(app);
      const socket = await connectAndRegister(app);
      socket.close();
      await app.close();
      apps.pop();

      const db = new Database(databasePath);
      const insertLegacy = db.prepare(
        `INSERT INTO ask_requests (
          request_id, session_id, mode, prompt, question_json, options_json, context_json, fork_reference_json, status,
          selected_values_json, note, rationale, created_at, expires_at, resolved_at, updated_at
        ) VALUES (
          @requestId, 'session-history-1', 'single', @prompt, NULL, @optionsJson, NULL, @forkReferenceJson, @status,
          @selectedValuesJson, NULL, NULL, @createdAt, @expiresAt, @resolvedAt, @updatedAt
        )`
      );
      insertLegacy.run({
        requestId: "legacy-pending",
        prompt: "Legacy pending question",
        optionsJson: JSON.stringify([{ value: "ship", label: "Ship" }]),
        forkReferenceJson: JSON.stringify({
          agentSessionPath: "/worktrees/history/.pi/session.jsonl",
          leafId: "legacy-leaf",
          cwd: "/worktrees/history"
        }),
        status: "pending",
        selectedValuesJson: null,
        createdAt: new Date(1_100).toISOString(),
        expiresAt: new Date(10_000).toISOString(),
        resolvedAt: null,
        updatedAt: new Date(1_100).toISOString()
      });
      insertLegacy.run({
        requestId: "legacy-answered",
        prompt: "Legacy answered question",
        optionsJson: JSON.stringify([{ value: "ship", label: "Ship" }]),
        forkReferenceJson: JSON.stringify({
          agentSessionPath: "/worktrees/history/.pi/session.jsonl",
          leafId: "legacy-leaf",
          cwd: "/worktrees/history"
        }),
        status: "answered",
        selectedValuesJson: JSON.stringify(["ship"]),
        createdAt: new Date(1_200).toISOString(),
        expiresAt: new Date(10_000).toISOString(),
        resolvedAt: new Date(1_300).toISOString(),
        updatedAt: new Date(1_300).toISOString()
      });
      db.close();

      app = await createPostboxApp({ databasePath, now: () => 2_000, expirySweepMs: 0 });
      apps.push(app);
      const state = StateSnapshotSchema.parse((await app.inject({ method: "GET", url: "/api/state" })).json());
      const pending = state.requests.find((request) => request.requestId === "legacy-pending");
      expect(pending).toMatchObject({
        urgency: "normal",
        question: { prompt: "Legacy pending question" },
        forkReference: { leafId: "legacy-leaf" }
      });
      expect(pending?.context).toBeUndefined();

      const history = HistoryResponseSchema.parse((await app.inject({ method: "GET", url: "/api/history" })).json());
      const answered = history.history.find((record) => record.request.requestId === "legacy-answered")?.request;
      expect(answered).toMatchObject({
        question: { prompt: "Legacy answered question" },
        result: { status: "answered", selectedValues: ["ship"] },
        forkReference: { agentSessionPath: "/worktrees/history/.pi/session.jsonl", leafId: "legacy-leaf" }
      });
      expect(answered?.context).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns terminal requests with answer, timestamps, session/project/machine metadata, rich context, and persists across restart", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-postbox-history-db-"));
    const databasePath = join(dir, "postbox.sqlite");

    try {
      let now = 1_000;
      let app = await createPostboxApp({ databasePath, now: () => now, expirySweepMs: 0 });
      apps.push(app);
      const socket = await connectAndRegister(app);
      await createAsk(socket, "ask-history");

      now = 2_000;
      const resolved = nextMessage(socket);
      const answer = await app.inject({
        method: "POST",
        url: "/api/requests/ask-history/answer",
        payload: { selectedValues: ["ship"], note: "Proceed", rationale: "The audit trail has enough context." }
      });
      expect(answer.statusCode).toBe(200);
      await resolved;

      await app.close();
      apps.pop();

      app = await createPostboxApp({ databasePath, now: () => 3_000, expirySweepMs: 0 });
      apps.push(app);
      const historyResponse = await app.inject({ method: "GET", url: "/api/history" });
      expect(historyResponse.statusCode).toBe(200);
      const history = HistoryResponseSchema.parse(historyResponse.json());

      expect(history.history).toHaveLength(1);
      expect(history.history[0]).toMatchObject({
        request: {
          requestId: "ask-history",
          status: "answered",
          result: {
            status: "answered",
            selectedValues: ["ship"],
            note: "Proceed",
            rationale: "The audit trail has enough context."
          },
          question: {
            relevance: "History helps understand prior choices.",
            decisionImpact: "This affects later implementation slices."
          },
          context: {
            codebaseContext: "Fastify + SQLite request storage already persists rich ask context.",
            additionalInfo: [{ kind: "code", title: "No transcript" }]
          },
          forkReference: { agentSessionId: "agent-history", leafId: "leaf-history" }
        },
        session: {
          sessionId: "session-history-1",
          title: "History worker",
          machine: { machineId: "machine-history-1", machineName: "Studio", hostname: "studio-host" },
          project: {
            projectId: "project-history-1",
            projectName: "Postbox History",
            repoName: "pi-postbox",
            branch: "feature/history",
            icon: { hash: "sha256:history-icon" }
          }
        }
      });
      expect(history.history[0]?.request.options).toEqual(
        expect.arrayContaining([expect.objectContaining({ value: "ship", meaning: "Proceed with the implementation." })])
      );
      expect(history.history[0]?.request.createdAt).toBe(new Date(1_000).toISOString());
      expect(history.history[0]?.request.resolvedAt).toBe(new Date(2_000).toISOString());
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("includes cancelled and expired terminal requests in history", async () => {
    let now = 5_000;
    const app = await createPostboxApp({ databasePath: ":memory:", now: () => now, askTimeoutMs: 500, expirySweepMs: 0 });
    apps.push(app);
    const socket = await connectAndRegister(app);

    await createAsk(socket, "ask-cancelled");
    const cancelled = nextMessage(socket);
    const cancelResponse = await app.inject({ method: "POST", url: "/api/requests/ask-cancelled/cancel", payload: { note: "Not today" } });
    expect(cancelResponse.statusCode).toBe(200);
    await cancelled;

    await createAsk(socket, "ask-expired");
    const expired = nextMessage(socket);
    now = 5_501;
    const historyResponse = await app.inject({ method: "GET", url: "/api/history" });
    expect(historyResponse.statusCode).toBe(200);
    await expired;

    const history = HistoryResponseSchema.parse(historyResponse.json());
    expect(history.history.map((record) => record.request.status)).toEqual(["expired", "cancelled"]);
    expect(history.history.find((record) => record.request.requestId === "ask-cancelled")?.request.result).toMatchObject({
      status: "cancelled",
      note: "Not today"
    });
    expect(history.history.find((record) => record.request.requestId === "ask-expired")?.request.result).toMatchObject({
      status: "expired",
      requestId: "ask-expired"
    });
  });

  it("prunes terminal history by max age without deleting pending requests", async () => {
    let now = 10_000;
    const app = await createPostboxApp({
      databasePath: ":memory:",
      now: () => now,
      expirySweepMs: 0,
      historyRetentionMaxAgeMs: 1_000
    });
    apps.push(app);
    const socket = await connectAndRegister(app);

    await createAsk(socket, "ask-old-terminal");
    const oldResolved = nextMessage(socket);
    await app.inject({ method: "POST", url: "/api/requests/ask-old-terminal/answer", payload: { selectedValues: ["ship"] } });
    await oldResolved;

    await createAsk(socket, "ask-still-pending");
    now = 12_001;

    const pruneResponse = await app.inject({ method: "POST", url: "/api/history/prune" });
    expect(pruneResponse.statusCode).toBe(200);
    expect(pruneResponse.json()).toMatchObject({ pruned: 1 });

    const history = HistoryResponseSchema.parse((await app.inject({ method: "GET", url: "/api/history" })).json());
    expect(history.history).toHaveLength(0);

    const state = StateSnapshotSchema.parse((await app.inject({ method: "GET", url: "/api/state" })).json());
    expect(state.requests).toEqual([expect.objectContaining({ requestId: "ask-still-pending", status: "pending" })]);
  });

  it("prunes terminal history by max record count while keeping the newest terminal records", async () => {
    let now = 20_000;
    const app = await createPostboxApp({
      databasePath: ":memory:",
      now: () => now,
      expirySweepMs: 0,
      historyRetentionMaxRecords: 2
    });
    apps.push(app);
    const socket = await connectAndRegister(app);

    for (const requestId of ["ask-count-1", "ask-count-2", "ask-count-3"]) {
      await createAsk(socket, requestId);
      const resolved = nextMessage(socket);
      await app.inject({ method: "POST", url: `/api/requests/${requestId}/answer`, payload: { selectedValues: ["ship"] } });
      await resolved;
      now += 1_000;
    }

    const pruneResponse = await app.inject({ method: "POST", url: "/api/history/prune" });
    expect(pruneResponse.statusCode).toBe(200);
    expect(pruneResponse.json()).toMatchObject({ pruned: 1 });

    const history = HistoryResponseSchema.parse((await app.inject({ method: "GET", url: "/api/history" })).json());
    expect(history.history.map((record) => record.request.requestId)).toEqual(["ask-count-3", "ask-count-2"]);
  });
});
