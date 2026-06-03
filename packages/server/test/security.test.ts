import { StateSnapshotSchema, type ExtensionClientMessage } from "@pi-postbox/protocol";
import type { FastifyInstance } from "fastify";
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

const registration: ExtensionClientMessage = {
  type: "session.register",
  payload: {
    machine: { machineId: "machine-security", hostname: "workstation" },
    project: { projectId: "project-security", name: "Security", cwd: "/repo" },
    session: { sessionId: "session-security", cwd: "/repo", semanticState: "idle" }
  }
};

afterEach(async () => {
  for (const socket of sockets.splice(0)) {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
  }
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("browser-origin and payload safety", () => {
  it("rejects cross-origin state-changing HTTP actions while allowing same-origin actions", async () => {
    const app = await createPostboxApp({ databasePath: ":memory:" });
    apps.push(app);

    const blocked = await app.inject({
      method: "POST",
      url: "/api/history/prune",
      headers: { host: "postbox.local", origin: "https://evil.example" }
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json()).toMatchObject({ error: "forbidden_origin" });

    const allowed = await app.inject({
      method: "POST",
      url: "/api/history/prune",
      headers: { host: "postbox.local", origin: "http://postbox.local" }
    });
    expect(allowed.statusCode).toBe(200);
  });

  it("rejects cross-origin extension WebSocket connections", async () => {
    const app = await createPostboxApp({ databasePath: ":memory:" });
    apps.push(app);
    await app.listen({ host: "127.0.0.1", port: 0 });

    const socket = new WebSocket(`ws://127.0.0.1:${listenerPort(app)}/api/extension/ws`, {
      headers: { Origin: "https://evil.example" }
    });
    sockets.push(socket);

    const close = await new Promise<{ code: number; reason: string }>((resolve, reject) => {
      socket.once("close", (code, reason) => resolve({ code, reason: reason.toString() }));
      socket.once("error", reject);
    });

    expect(close).toMatchObject({ code: 1008, reason: "forbidden_origin" });
  });

  it("rejects oversized rich ask payloads before persistence", async () => {
    const app = await createPostboxApp({ databasePath: ":memory:" });
    apps.push(app);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const socket = new WebSocket(`ws://127.0.0.1:${listenerPort(app)}/api/extension/ws`);
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    socket.send(JSON.stringify(registration));
    await new Promise((resolve) => socket.once("message", resolve));

    const error = new Promise<unknown>((resolve) => socket.once("message", (raw) => resolve(JSON.parse(raw.toString()))));
    socket.send(JSON.stringify({
      type: "ask.create",
      requestId: "oversized-ask",
      payload: {
        requestId: "oversized-ask",
        sessionId: "session-security",
        mode: "single",
        question: { prompt: "x".repeat(128_001) },
        options: [{ value: "yes", label: "Yes" }]
      }
    }));

    await expect(error).resolves.toMatchObject({ type: "error", error: { code: "invalid_message" } });
    const snapshot = StateSnapshotSchema.parse((await app.inject({ method: "GET", url: "/api/state" })).json());
    expect(snapshot.requests).toHaveLength(0);
  });
});
