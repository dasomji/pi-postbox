import { StateSnapshotSchema, type ExtensionClientMessage } from "@pi-postbox/protocol";
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

async function connectAndRegister(app: FastifyInstance): Promise<WebSocket> {
  await app.listen({ host: "127.0.0.1", port: 0 });
  const socket = new WebSocket(`ws://127.0.0.1:${listenerPort(app)}/api/extension/ws`);
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const registered = nextMessage(socket);
  socket.send(
    JSON.stringify({
      type: "session.register",
      payload: {
        machine: { machineId: "machine-1", hostname: "workstation" },
        project: { projectId: "project-1", name: "pi-postbox", cwd: "/repo" },
        session: { sessionId: "session-1", cwd: "/repo", semanticState: "blocked" }
      }
    } satisfies ExtensionClientMessage)
  );
  await expect(registered).resolves.toMatchObject({ type: "registered" });
  return socket;
}

function nextMessage(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    socket.once("message", (raw) => resolve(JSON.parse(raw.toString())));
    socket.once("error", reject);
  });
}

function askCreate(requestId: string): ExtensionClientMessage {
  return {
    type: "ask.create",
    payload: {
      requestId,
      sessionId: "session-1",
      mode: "single",
      question: { prompt: "Resolve locally?" },
      options: [{ value: "yes", label: "Yes" }]
    }
  };
}

describe("extension local fallback reconciliation over WebSocket", () => {
  it("accepts local answer messages and updates server request state", async () => {
    const app = await createPostboxApp({ databasePath: ":memory:", now: () => 10_000, expirySweepMs: 0 });
    apps.push(app);
    const socket = await connectAndRegister(app);

    const created = nextMessage(socket);
    socket.send(JSON.stringify(askCreate("ask-local-answer")));
    await created;

    const resolved = nextMessage(socket);
    socket.send(
      JSON.stringify({
        type: "ask.answer",
        payload: { requestId: "ask-local-answer", answer: { selectedValues: ["yes"], note: "terminal" } }
      } satisfies ExtensionClientMessage)
    );

    await expect(resolved).resolves.toMatchObject({
      type: "ask.resolved",
      payload: { status: "answered", requestId: "ask-local-answer", selectedValues: ["yes"], note: "terminal" }
    });
    const state = StateSnapshotSchema.parse((await app.inject({ method: "GET", url: "/api/state" })).json());
    expect(state.requests[0]).toMatchObject({ status: "answered", result: { status: "answered", selectedValues: ["yes"] } });
  });

  it("accepts local cancel messages and updates server request state", async () => {
    const app = await createPostboxApp({ databasePath: ":memory:", now: () => 20_000, expirySweepMs: 0 });
    apps.push(app);
    const socket = await connectAndRegister(app);

    const created = nextMessage(socket);
    socket.send(JSON.stringify(askCreate("ask-local-cancel")));
    await created;

    const resolved = nextMessage(socket);
    socket.send(
      JSON.stringify({
        type: "ask.cancel",
        payload: { requestId: "ask-local-cancel", cancel: { note: "terminal cancel" } }
      } satisfies ExtensionClientMessage)
    );

    await expect(resolved).resolves.toMatchObject({
      type: "ask.resolved",
      payload: { status: "cancelled", requestId: "ask-local-cancel", note: "terminal cancel" }
    });
    const state = StateSnapshotSchema.parse((await app.inject({ method: "GET", url: "/api/state" })).json());
    expect(state.requests[0]).toMatchObject({ status: "cancelled", result: { status: "cancelled", note: "terminal cancel" } });
  });
});
