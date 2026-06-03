import { StateSnapshotSchema, type ExtensionClientMessage } from "@pi-postbox/protocol";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { createPostboxApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";

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
    requestId: "register-1",
    payload: {
      machine: { machineId: "machine-1", hostname: "workstation" },
      project: {
        projectId: "project-1",
        name: "pi-postbox",
        cwd: "/repo/pi-postbox",
        branch: "feature/presence",
        worktreePath: "/repo/pi-postbox"
      },
      session: {
        sessionId,
        title: "Build presence",
        cwd: "/repo/pi-postbox",
        branch: "feature/presence",
        worktreePath: "/repo/pi-postbox",
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

async function connectAndRegister(port: number, message = registrationMessage()): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/api/extension/ws`);
  sockets.push(socket);

  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });

  const registered = new Promise<unknown>((resolve, reject) => {
    socket.once("message", (raw) => resolve(JSON.parse(raw.toString())));
    socket.once("error", reject);
  });
  socket.send(JSON.stringify(message));
  await expect(registered).resolves.toMatchObject({
    type: "registered",
    payload: { sessionId: message.payload.session.sessionId, presence: "live" }
  });

  return socket;
}

describe("Pi session presence", () => {
  it("registers an extension WebSocket session and exposes it as live through the state endpoint", async () => {
    const app = await createPostboxApp({ databasePath: ":memory:", now: () => 1_000 });
    apps.push(app);
    await app.listen({ host: "127.0.0.1", port: 0 });

    await connectAndRegister(listenerPort(app));

    const response = await app.inject({ method: "GET", url: "/api/state" });
    const snapshot = StateSnapshotSchema.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(snapshot.sessions).toHaveLength(1);
    expect(snapshot.sessions[0]).toMatchObject({
      sessionId: "session-1",
      title: "Build presence",
      machineName: "workstation",
      projectName: "pi-postbox",
      branch: "feature/presence",
      cwd: "/repo/pi-postbox",
      worktreePath: "/repo/pi-postbox",
      semanticState: "working",
      presence: "live"
    });
  });

  it("derives stale and offline presence from missed heartbeats", async () => {
    let nowMs = 1_000;
    const app = await createPostboxApp({
      databasePath: ":memory:",
      now: () => nowMs,
      staleAfterMs: 100,
      offlineAfterMs: 300
    });
    apps.push(app);
    await app.listen({ host: "127.0.0.1", port: 0 });
    await connectAndRegister(listenerPort(app));

    nowMs = 1_150;
    const stale = StateSnapshotSchema.parse((await app.inject({ method: "GET", url: "/api/state" })).json());
    expect(stale.sessions[0]?.presence).toBe("stale");

    nowMs = 1_350;
    const offline = StateSnapshotSchema.parse((await app.inject({ method: "GET", url: "/api/state" })).json());
    expect(offline.sessions[0]?.presence).toBe("offline");
  });

  it("keeps persisted metadata after a server restart while marking the disconnected session offline", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-postbox-presence-"));
    const databasePath = join(dir, "postbox.sqlite");

    try {
      let app = await createPostboxApp({ databasePath, now: () => 1_000 });
      apps.push(app);
      await app.listen({ host: "127.0.0.1", port: 0 });
      await connectAndRegister(listenerPort(app));
      await app.close();
      apps.pop();

      app = await createPostboxApp({ databasePath, now: () => 2_000 });
      apps.push(app);
      const response = await app.inject({ method: "GET", url: "/api/state" });
      const snapshot = StateSnapshotSchema.parse(response.json());

      expect(snapshot.sessions[0]).toMatchObject({
        sessionId: "session-1",
        machineName: "workstation",
        projectName: "pi-postbox",
        branch: "feature/presence",
        presence: "offline"
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
