import { AskResultSchema, HistoryResponseSchema, OTHER_OPTION_VALUE, StateSnapshotSchema, type ExtensionClientMessage } from "@pi-postbox/protocol";
import type { FastifyInstance } from "fastify";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
      session: { sessionId: "session-1", title: "Answer loop", cwd: "/repo", branch: "main", semanticState: "working", owner: { harness: "pi", ownerId: "11111111-1111-4111-8111-111111111111" } }
    }
  };
}

async function connectAndRegister(app: FastifyInstance): Promise<WebSocket> {
  await app.listen({ host: "127.0.0.1", port: 0 });
  const socket = new WebSocket(`ws://127.0.0.1:${listenerPort(app)}/api/extension/ws`);
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

describe("ask_postbox request loop", () => {
  it("lists pending requests oldest first across restart without priority metadata", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-postbox-order-db-"));
    const databasePath = join(dir, "postbox.sqlite");

    try {
      let now = 1_000;
      let app = await createPostboxApp({ databasePath, now: () => now, expirySweepMs: 0 });
      apps.push(app);
      const socket = await connectAndRegister(app);

      const asks = [
        { requestId: "oldest", now: 1_000 }, { requestId: "older", now: 2_000 },
        { requestId: "newer", now: 3_000 }, { requestId: "newest", now: 4_000 }
      ] as const;

      for (const ask of asks) {
        now = ask.now;
        const created = nextMessage(socket);
        socket.send(
          JSON.stringify({
            type: "ask.create",
            requestId: `wire-${ask.requestId}`,
            payload: {
              requestId: ask.requestId,
              sessionId: "session-1",
              mode: "single",
              question: { prompt: `Resolve ${ask.requestId}?`, ambiguity: "Test ambiguity." },
              options: [{ value: "yes", label: "Yes" }]
            }
          } satisfies ExtensionClientMessage)
        );
        await expect(created).resolves.toMatchObject({ type: "ask.created", payload: { requestId: ask.requestId } });
      }

      socket.close();
      await app.close();
      apps.pop();

      app = await createPostboxApp({ databasePath, now: () => now, expirySweepMs: 0 });
      apps.push(app);
      const pending = (await app.inject({ method: "GET", url: "/api/requests?status=pending" })).json().requests;

      expect(pending.map((request: { requestId: string }) => request.requestId)).toEqual([
        "oldest", "older", "newer", "newest"
      ]);
      expect(pending.every((request: object) => !("urgency" in request))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("accepts direct extension-protocol ask creation without top-level handoff context", async () => {
    const app = await createPostboxApp({ databasePath: ":memory:", now: () => 750 });
    apps.push(app);
    const socket = await connectAndRegister(app);

    const created = nextMessage(socket);
    socket.send(JSON.stringify({
      type: "ask.create",
      requestId: "wire-without-context",
      payload: {
        requestId: "ask-without-context",
        sessionId: "session-1",
        mode: "single",
        question: { prompt: "Which path?", ambiguity: "Test ambiguity." },
        options: [{ value: "ship", label: "Ship" }]
      }
    }));

    await expect(created).resolves.toMatchObject({
      type: "ask.created",
      requestId: "wire-without-context",
      payload: { requestId: "ask-without-context", status: "pending" }
    });
    expect((await app.inject({ method: "GET", url: "/api/requests?status=pending" })).json().requests)
      .toEqual([expect.objectContaining({ requestId: "ask-without-context" })]);
  });

  it("rejects creator-spoofed Chat provenance before state or history serialization", async () => {
    const app = await createPostboxApp({ databasePath: ":memory:", now: () => 800 });
    apps.push(app);
    const socket = await connectAndRegister(app);

    const rejected = nextMessage(socket);
    socket.send(JSON.stringify({
      type: "ask.create",
      requestId: "wire-spoofed-provenance",
      payload: {
        requestId: "ask-spoofed-provenance",
        sessionId: "session-1",
        mode: "single",
        question: { prompt: "Which path?", ambiguity: "Test ambiguity." },
        options: [{ value: "ship", label: "Ship", provenance: "chat" }]
      }
    }));

    await expect(rejected).resolves.toMatchObject({
      type: "error",
      requestId: "wire-spoofed-provenance",
      error: { code: "invalid_message" }
    });
    expect((await app.inject({ method: "GET", url: "/api/state" })).json().requests).toEqual([]);
    expect((await app.inject({ method: "GET", url: "/api/history" })).json().history).toEqual([]);
  });

  it("creates a pending single-choice card and resolves the waiting extension caller when answered over HTTP", async () => {
    const app = await createPostboxApp({ databasePath: ":memory:", now: () => 1_000 });
    apps.push(app);
    const socket = await connectAndRegister(app);

    const created = nextMessage(socket);
    socket.send(
      JSON.stringify({
        type: "ask.create",
        requestId: "wire-ask-1",
        payload: {
          requestId: "ask-1",
          sessionId: "session-1",
          mode: "single",
          question: { prompt: "Which server framework should v1 use?", ambiguity: "Test ambiguity." },
          options: [
            { value: "fastify", label: "Fastify" },
            { value: "hono", label: "Hono" }
          ]
        }
      } satisfies ExtensionClientMessage)
    );
    await expect(created).resolves.toMatchObject({ type: "ask.created", payload: { requestId: "ask-1", status: "pending" } });

    const pendingResponse = await app.inject({ method: "GET", url: "/api/requests?status=pending" });
    expect(pendingResponse.statusCode).toBe(200);
    expect(pendingResponse.json()).toMatchObject({
      requests: [
        {
          requestId: "ask-1",
          sessionId: "session-1",
          status: "pending",
          mode: "single",
          question: { prompt: "Which server framework should v1 use?", ambiguity: "Test ambiguity." }
        }
      ]
    });

    const removedRationale = await app.inject({
      method: "POST",
      url: "/api/requests/ask-1/answer",
      payload: { expectedRevision: 1, selectedValues: ["fastify"], rationale: "Removed field" }
    });
    expect(removedRationale.statusCode).toBe(400);

    const answerResponse = await app.inject({
      method: "POST",
      url: "/api/requests/ask-1/answer",
      payload: { expectedRevision: 1, selectedValues: ["fastify"], note: "Use the boring daemon choice" }
    });

    expect(answerResponse.statusCode).toBe(200);
    const answerBody = answerResponse.json();
    expect(AskResultSchema.parse(answerBody.result)).toMatchObject({
      status: "answered",
      requestId: "ask-1",
      selectedValues: ["fastify"],
      note: "Use the boring daemon choice"
    });
  });

  it("accepts the virtual Other option from the web UI when accompanied by a note", async () => {
    const app = await createPostboxApp({ databasePath: ":memory:", now: () => 1_500 });
    apps.push(app);
    const socket = await connectAndRegister(app);

    const created = nextMessage(socket);
    socket.send(
      JSON.stringify({
        type: "ask.create",
        requestId: "wire-ask-other",
        payload: {
          requestId: "ask-other",
          sessionId: "session-1",
          mode: "single",
          question: { prompt: "Which path should we take?", ambiguity: "Test ambiguity." },
          options: [{ value: "ship", label: "Ship it" }]
        }
      } satisfies ExtensionClientMessage)
    );
    await expect(created).resolves.toMatchObject({ type: "ask.created", payload: { requestId: "ask-other", status: "pending" } });

    const answerResponse = await app.inject({
      method: "POST",
      url: "/api/requests/ask-other/answer",
      payload: { expectedRevision: 1, selectedValues: [OTHER_OPTION_VALUE], note: "Wait for design review first." }
    });

    expect(answerResponse.statusCode).toBe(200);
    expect(answerResponse.json().result).toMatchObject({
      status: "answered",
      requestId: "ask-other",
      selectedValues: [OTHER_OPTION_VALUE],
      note: "Wait for design review first."
    });
  });

  it("supports multi-choice answers and exposes pending cards in the state snapshot", async () => {
    const app = await createPostboxApp({ databasePath: ":memory:", now: () => 2_000 });
    apps.push(app);
    const socket = await connectAndRegister(app);

    const created = nextMessage(socket);
    socket.send(
      JSON.stringify({
        type: "ask.create",
        payload: {
          requestId: "ask-multi",
          sessionId: "session-1",
          mode: "multi",
          question: { prompt: "Which metadata should be shown?", ambiguity: "Test ambiguity." },
          options: [
            { value: "branch", label: "Branch" },
            { value: "machine", label: "Machine" },
            { value: "cwd", label: "CWD" }
          ]
        }
      } satisfies ExtensionClientMessage)
    );
    await created;

    const snapshot = StateSnapshotSchema.parse((await app.inject({ method: "GET", url: "/api/state" })).json());
    expect(snapshot.requests).toHaveLength(1);
    expect(snapshot.requests[0]).toMatchObject({ requestId: "ask-multi", mode: "multi", status: "pending" });

    const answerResponse = await app.inject({
      method: "POST",
      url: "/api/requests/ask-multi/answer",
      payload: { expectedRevision: 1, selectedValues: ["branch", "machine"] }
    });
    expect(answerResponse.statusCode).toBe(200);
  });

  it("cancels a pending ask and returns a structured cancellation to the waiting caller", async () => {
    const app = await createPostboxApp({ databasePath: ":memory:", now: () => 3_000 });
    apps.push(app);
    const socket = await connectAndRegister(app);

    const created = nextMessage(socket);
    socket.send(
      JSON.stringify({
        type: "ask.create",
        payload: {
          requestId: "ask-cancel",
          sessionId: "session-1",
          mode: "single",
          question: { prompt: "Continue?", ambiguity: "Test ambiguity." },
          options: [{ value: "yes", label: "Yes" }]
        }
      } satisfies ExtensionClientMessage)
    );
    await created;

    const cancelResponse = await app.inject({
      method: "POST",
      url: "/api/requests/ask-cancel/cancel",
      payload: { note: "Not now" }
    });

    expect(cancelResponse.statusCode).toBe(200);
    expect(cancelResponse.json().result).toMatchObject({ status: "cancelled", requestId: "ask-cancel", note: "Not now" });
  });

  it("preserves all pending asks while marking a replaced Pi session offline", async () => {
    const app = await createPostboxApp({ databasePath: ":memory:", now: () => 3_500 });
    apps.push(app);
    const socket = await connectAndRegister(app);

    for (const requestId of ["ask-old-1", "ask-old-2"]) {
      const created = nextMessage(socket);
      socket.send(
        JSON.stringify({
          type: "ask.create",
          payload: {
            requestId,
            sessionId: "session-1",
            mode: "single",
            question: { prompt: `Resolve ${requestId}?`, ambiguity: "Test ambiguity." },
            options: [{ value: "yes", label: "Yes" }]
          }
        } satisfies ExtensionClientMessage)
      );
      await expect(created).resolves.toMatchObject({ type: "ask.created", payload: { requestId, status: "pending" } });
    }

    const shutdownAck = nextMessage(socket);
    socket.send(
      JSON.stringify({
        type: "session.shutdown",
        requestId: "shutdown-new",
        payload: { sessionId: "session-1", reason: "new" }
      } satisfies ExtensionClientMessage)
    );

    await expect(shutdownAck).resolves.toMatchObject({ type: "ack", requestId: "shutdown-new" });

    const snapshot = StateSnapshotSchema.parse((await app.inject({ method: "GET", url: "/api/state" })).json());
    expect(snapshot.sessions[0]).toMatchObject({ sessionId: "session-1", presence: "offline" });
    expect(snapshot.requests).toEqual(expect.arrayContaining([
      expect.objectContaining({ requestId: "ask-old-1", status: "pending" }),
      expect.objectContaining({ requestId: "ask-old-2", status: "pending" })
    ]));

    const history = HistoryResponseSchema.parse((await app.inject({ method: "GET", url: "/api/history" })).json());
    expect(history.history).toHaveLength(0);
  });

  it("treats reload shutdown reason as a reconnect path that does not cancel pending asks", async () => {
    const app = await createPostboxApp({ databasePath: ":memory:", now: () => 3_750 });
    apps.push(app);
    const socket = await connectAndRegister(app);

    const created = nextMessage(socket);
    socket.send(
      JSON.stringify({
        type: "ask.create",
        payload: {
          requestId: "ask-survives-reload",
          sessionId: "session-1",
          mode: "single",
          question: { prompt: "Survive reload?", ambiguity: "Test ambiguity." },
          options: [{ value: "yes", label: "Yes" }]
        }
      } satisfies ExtensionClientMessage)
    );
    await created;

    const ack = nextMessage(socket);
    socket.send(
      JSON.stringify({
        type: "session.shutdown",
        requestId: "shutdown-reload",
        payload: { sessionId: "session-1", reason: "reload" }
      } satisfies ExtensionClientMessage)
    );
    await expect(ack).resolves.toMatchObject({ type: "ack", payload: { type: "session.shutdown" } });

    const snapshot = StateSnapshotSchema.parse((await app.inject({ method: "GET", url: "/api/state" })).json());
    expect(snapshot.sessions[0]).toMatchObject({ sessionId: "session-1", presence: "offline" });
    expect(snapshot.requests).toEqual([expect.objectContaining({ requestId: "ask-survives-reload", status: "pending" })]);
  });

  it("persists option impact and fork references in public request snapshots", async () => {
    const app = await createPostboxApp({ databasePath: ":memory:", now: () => 4_000 });
    apps.push(app);
    const socket = await connectAndRegister(app);

    const created = nextMessage(socket);
    socket.send(
      JSON.stringify({
        type: "ask.create",
        payload: {
          requestId: "ask-rich",
          sessionId: "session-1",
          mode: "single",
          question: {
            prompt: "Which storage boundary should v1 use?",
            ambiguity: "Which storage boundary best balances durability and deployment simplicity?"
          },
          options: [
            {
              value: "sqlite",
              label: "SQLite",
              description: "Use local SQLite.",
              impact: "Durable local database with minimal deployment overhead."
            }
          ],
          forkReference: {
            agentSessionId: "agent-session-1",
            agentSessionPath: "/tmp/session.jsonl",
            leafId: "leaf-1",
            cwd: "/repo",
            model: "gpt-5.5"
          }
        }
      } satisfies ExtensionClientMessage)
    );
    await created;

    const pendingResponse = await app.inject({ method: "GET", url: "/api/requests?status=pending" });
    expect(pendingResponse.statusCode).toBe(200);
    expect(pendingResponse.json().requests[0]).toMatchObject({
      requestId: "ask-rich",
      question: {
        ambiguity: "Which storage boundary best balances durability and deployment simplicity?"
      },
      options: [{ value: "sqlite", impact: "Durable local database with minimal deployment overhead." }],
      forkReference: { agentSessionPath: "/tmp/session.jsonl", leafId: "leaf-1" }
    });

    const stateSnapshot = StateSnapshotSchema.parse((await app.inject({ method: "GET", url: "/api/state" })).json());
    expect(stateSnapshot.requests[0]?.options[0]?.impact).toContain("deployment overhead");
    expect(stateSnapshot.requests[0]).not.toHaveProperty("context");

    const answerResponse = await app.inject({
      method: "POST",
      url: "/api/requests/ask-rich/answer",
      payload: { expectedRevision: 1, selectedValues: ["sqlite"], note: "Simple durable v1 storage." }
    });
    expect(answerResponse.statusCode).toBe(200);
    expect(answerResponse.json().request).toMatchObject({
      status: "answered",

      forkReference: { agentSessionId: "agent-session-1" }
    });
  });
});
