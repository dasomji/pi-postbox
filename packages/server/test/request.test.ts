import { AskResultSchema, OTHER_OPTION_VALUE, StateSnapshotSchema, type ExtensionClientMessage } from "@pi-postbox/protocol";
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
      session: { sessionId: "session-1", title: "Answer loop", cwd: "/repo", branch: "main", semanticState: "working" }
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

function interviewerContext() {
  return {
    codebaseContext: "Fastify server with shared protocol schemas.",
    problemContext: "Exercise the remote decision request lifecycle."
  };
}

describe("ask_postbox request loop", () => {
  it("rejects direct extension-protocol ask creation without complete interviewer context", async () => {
    const app = await createPostboxApp({ databasePath: ":memory:", now: () => 750 });
    apps.push(app);
    const socket = await connectAndRegister(app);

    const rejected = nextMessage(socket);
    socket.send(
      JSON.stringify({
        type: "ask.create",
        requestId: "wire-missing-context",
        payload: {
          requestId: "ask-missing-context",
          sessionId: "session-1",
          mode: "single",
          question: { prompt: "Which path?" },
          options: [{ value: "ship", label: "Ship" }],
          context: { codebaseContext: "Fastify server.", problemContext: "  " }
        }
      })
    );

    await expect(rejected).resolves.toMatchObject({
      type: "error",
      requestId: "wire-missing-context",
      error: { code: "invalid_message" }
    });
    expect((await app.inject({ method: "GET", url: "/api/requests?status=pending" })).json()).toEqual({ requests: [] });
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
          question: { prompt: "Which server framework should v1 use?" },
          options: [
            { value: "fastify", label: "Fastify" },
            { value: "hono", label: "Hono" }
          ],
          context: interviewerContext()
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
          question: { prompt: "Which server framework should v1 use?" }
        }
      ]
    });

    const resolvedMessage = nextMessage(socket);
    const answerResponse = await app.inject({
      method: "POST",
      url: "/api/requests/ask-1/answer",
      payload: { selectedValues: ["fastify"], note: "Use the boring daemon choice", rationale: "Strong lifecycle" }
    });

    expect(answerResponse.statusCode).toBe(200);
    const answerBody = answerResponse.json();
    expect(AskResultSchema.parse(answerBody.result)).toMatchObject({
      status: "answered",
      requestId: "ask-1",
      selectedValues: ["fastify"],
      note: "Use the boring daemon choice",
      rationale: "Strong lifecycle"
    });
    await expect(resolvedMessage).resolves.toMatchObject({
      type: "ask.resolved",
      payload: { status: "answered", requestId: "ask-1", selectedValues: ["fastify"] }
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
          question: { prompt: "Which path should we take?" },
          options: [{ value: "ship", label: "Ship it" }],
          context: interviewerContext()
        }
      } satisfies ExtensionClientMessage)
    );
    await expect(created).resolves.toMatchObject({ type: "ask.created", payload: { requestId: "ask-other", status: "pending" } });

    const resolvedMessage = nextMessage(socket);
    const answerResponse = await app.inject({
      method: "POST",
      url: "/api/requests/ask-other/answer",
      payload: { selectedValues: [OTHER_OPTION_VALUE], note: "Wait for design review first." }
    });

    expect(answerResponse.statusCode).toBe(200);
    expect(answerResponse.json().result).toMatchObject({
      status: "answered",
      requestId: "ask-other",
      selectedValues: [OTHER_OPTION_VALUE],
      note: "Wait for design review first."
    });
    await expect(resolvedMessage).resolves.toMatchObject({
      type: "ask.resolved",
      payload: { status: "answered", requestId: "ask-other", selectedValues: [OTHER_OPTION_VALUE] }
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
          question: { prompt: "Which metadata should be shown?" },
          options: [
            { value: "branch", label: "Branch" },
            { value: "machine", label: "Machine" },
            { value: "cwd", label: "CWD" }
          ],
          context: interviewerContext()
        }
      } satisfies ExtensionClientMessage)
    );
    await created;

    const snapshot = StateSnapshotSchema.parse((await app.inject({ method: "GET", url: "/api/state" })).json());
    expect(snapshot.requests).toHaveLength(1);
    expect(snapshot.requests[0]).toMatchObject({ requestId: "ask-multi", mode: "multi", status: "pending" });

    const resolvedMessage = nextMessage(socket);
    const answerResponse = await app.inject({
      method: "POST",
      url: "/api/requests/ask-multi/answer",
      payload: { selectedValues: ["branch", "machine"] }
    });
    expect(answerResponse.statusCode).toBe(200);
    await expect(resolvedMessage).resolves.toMatchObject({
      type: "ask.resolved",
      payload: { status: "answered", selectedValues: ["branch", "machine"] }
    });
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
          question: { prompt: "Continue?" },
          options: [{ value: "yes", label: "Yes" }],
          context: interviewerContext()
        }
      } satisfies ExtensionClientMessage)
    );
    await created;

    const resolvedMessage = nextMessage(socket);
    const cancelResponse = await app.inject({
      method: "POST",
      url: "/api/requests/ask-cancel/cancel",
      payload: { note: "Not now" }
    });

    expect(cancelResponse.statusCode).toBe(200);
    expect(cancelResponse.json().result).toMatchObject({ status: "cancelled", requestId: "ask-cancel", note: "Not now" });
    await expect(resolvedMessage).resolves.toMatchObject({
      type: "ask.resolved",
      payload: { status: "cancelled", requestId: "ask-cancel", note: "Not now" }
    });
  });

  it("cancels all pending asks for a session when the originating Pi session is replaced", async () => {
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
            question: { prompt: `Resolve ${requestId}?` },
            options: [{ value: "yes", label: "Yes" }],
            context: interviewerContext()
          }
        } satisfies ExtensionClientMessage)
      );
      await expect(created).resolves.toMatchObject({ type: "ask.created", payload: { requestId, status: "pending" } });
    }

    const firstResolved = nextMessage(socket);
    socket.send(
      JSON.stringify({
        type: "session.shutdown",
        requestId: "shutdown-new",
        payload: { sessionId: "session-1", reason: "new" }
      } satisfies ExtensionClientMessage)
    );

    await expect(firstResolved).resolves.toMatchObject({
      type: "ask.resolved",
      payload: {
        status: "cancelled",
        requestId: "ask-old-1",
        note: "Originating Pi session shut down.",
        rationale: "Originating Pi session was replaced by /new."
      }
    });

    const snapshot = StateSnapshotSchema.parse((await app.inject({ method: "GET", url: "/api/state" })).json());
    expect(snapshot.sessions[0]).toMatchObject({ sessionId: "session-1", presence: "offline" });
    expect(snapshot.requests).toEqual([
      expect.objectContaining({ requestId: "ask-old-1", status: "cancelled", result: expect.objectContaining({ status: "cancelled" }) }),
      expect.objectContaining({ requestId: "ask-old-2", status: "cancelled", result: expect.objectContaining({ status: "cancelled" }) })
    ]);
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
          question: { prompt: "Survive reload?" },
          options: [{ value: "yes", label: "Yes" }],
          context: interviewerContext()
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
    expect(snapshot.sessions[0]).toMatchObject({ sessionId: "session-1", presence: "live" });
    expect(snapshot.requests).toEqual([expect.objectContaining({ requestId: "ask-survives-reload", status: "pending" })]);
  });

  it("persists rich handoff context, option meaning, and fork references in public request snapshots", async () => {
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
            context: "Postbox needs pending asks and resolved decisions to survive restarts.",
            relevance: "This controls the server persistence shape.",
            decisionImpact: "It affects migration design and future history queries."
          },
          options: [
            {
              value: "sqlite",
              label: "SQLite",
              description: "Use local SQLite.",
              meaning: "Durable local database with minimal deployment overhead.",
              context: "Matches the personal Tailscale service boundary."
            }
          ],
          context: {
            codebaseContext: "Fastify server with better-sqlite3 and shared protocol schemas.",
            problemContext: "Need an interviewer handoff without streaming full chats.",
            additionalInfo: [{ kind: "diagram", title: "Decision flow", content: "Pi -> Postbox -> Browser -> Pi" }]
          },
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
        context: "Postbox needs pending asks and resolved decisions to survive restarts.",
        relevance: "This controls the server persistence shape.",
        decisionImpact: "It affects migration design and future history queries."
      },
      options: [{ value: "sqlite", meaning: "Durable local database with minimal deployment overhead." }],
      context: { codebaseContext: "Fastify server with better-sqlite3 and shared protocol schemas." },
      forkReference: { agentSessionPath: "/tmp/session.jsonl", leafId: "leaf-1" }
    });

    const stateSnapshot = StateSnapshotSchema.parse((await app.inject({ method: "GET", url: "/api/state" })).json());
    expect(stateSnapshot.requests[0]?.options[0]?.context).toContain("Tailscale");
    expect(stateSnapshot.requests[0]?.context?.additionalInfo?.[0]).toMatchObject({ kind: "diagram", title: "Decision flow" });

    const resolvedMessage = nextMessage(socket);
    const answerResponse = await app.inject({
      method: "POST",
      url: "/api/requests/ask-rich/answer",
      payload: { selectedValues: ["sqlite"], rationale: "Simple durable v1 storage." }
    });
    expect(answerResponse.statusCode).toBe(200);
    expect(answerResponse.json().request).toMatchObject({
      status: "answered",
      context: { problemContext: "Need an interviewer handoff without streaming full chats." },
      forkReference: { agentSessionId: "agent-session-1" }
    });
    await expect(resolvedMessage).resolves.toMatchObject({
      type: "ask.resolved",
      payload: { status: "answered", requestId: "ask-rich", selectedValues: ["sqlite"] }
    });
  });
});
