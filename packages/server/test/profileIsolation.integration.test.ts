import { type ExtensionClientMessage, StateSnapshotSchema, type ServerProfileIdentity } from "@pi-postbox/protocol";
import type { FastifyInstance } from "fastify";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { createPostboxApp } from "../src/app.js";
import { listenOnConfiguredPort } from "../src/cli.js";

const apps: FastifyInstance[] = [];
const sockets: WebSocket[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("concurrent isolated server profiles", () => {
  it("keeps production and checkout development ports, databases, metadata, state, and shutdown isolated", async () => {
    const root = await temporaryRoot();
    const production = await startProfile(root, { kind: "production", id: "production" }, 0);
    const development = await startProfile(
      root,
      { kind: "development", id: "development:0123456789abcdef" },
      0
    );

    expect(development.port).not.toBe(production.port);
    expect(development.databasePath).not.toBe(production.databasePath);
    expect(development.metadataPath).not.toBe(production.metadataPath);
    await registerSession(production.app, "production-session");

    const productionState = StateSnapshotSchema.parse((await production.app.inject({ method: "GET", url: "/api/state" })).json());
    const developmentState = StateSnapshotSchema.parse((await development.app.inject({ method: "GET", url: "/api/state" })).json());
    expect(productionState.sessions.map((session) => session.sessionId)).toEqual(["production-session"]);
    expect(developmentState.sessions).toEqual([]);
    expect(await readFile(production.metadataPath, "utf8")).toContain('"id": "production"');
    expect(await readFile(development.metadataPath, "utf8")).toContain('"id": "development:0123456789abcdef"');

    await development.app.close();
    apps.splice(apps.indexOf(development.app), 1);
    expect((await production.app.inject({ method: "GET", url: "/healthz" })).statusCode).toBe(200);
    expect(StateSnapshotSchema.parse((await production.app.inject({ method: "GET", url: "/api/state" })).json()).sessions).toHaveLength(1);
  });

  it("runs two checkout/worktree development profiles without collisions", async () => {
    const root = await temporaryRoot();
    const first = await startProfile(root, { kind: "development", id: "development:0123456789abcdef" }, 0);
    const second = await startProfile(root, { kind: "development", id: "development:fedcba9876543210" }, 0);

    expect(second.port).not.toBe(first.port);
    expect(second.databasePath).not.toBe(first.databasePath);
    expect(second.metadataPath).not.toBe(first.metadataPath);
    expect((await first.app.inject({ method: "GET", url: "/healthz" })).json().profile).toEqual(first.profile);
    expect((await second.app.inject({ method: "GET", url: "/healthz" })).json().profile).toEqual(second.profile);
  });
});

async function startProfile(root: string, profile: ServerProfileIdentity, configuredPort: number) {
  const stateDir = join(root, profile.id.replace(":", "-"));
  const databasePath = join(stateDir, "postbox.sqlite");
  const metadataPath = join(stateDir, "active-local", "server.json");
  const app = await createPostboxApp({ databasePath, profile, buildId: `build-${profile.id}`, expirySweepMs: 0 });
  apps.push(app);
  const address = await listenOnConfiguredPort(app, {
    host: "127.0.0.1",
    port: configuredPort,
    profile,
    metadataPath,
    buildId: `build-${profile.id}`,
    heartbeatIntervalMs: 0
  });
  return { app, profile, databasePath, metadataPath, port: Number(new URL(address).port) };
}

async function registerSession(app: FastifyInstance, sessionId: string): Promise<void> {
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP listener");
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/extension/ws`);
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const registered = new Promise<unknown>((resolve, reject) => {
    socket.once("message", (raw) => resolve(JSON.parse(raw.toString())));
    socket.once("error", reject);
  });
  socket.send(JSON.stringify({
    type: "session.register",
    requestId: `register-${sessionId}`,
    payload: {
      machine: { machineId: "machine", hostname: "host" },
      project: { projectId: "project", name: "Project", cwd: "/repo", branch: "main" },
      session: {
        sessionId,
        title: sessionId,
        cwd: "/repo",
        branch: "main",
        semanticState: "working",
        owner: { harness: "pi", ownerId: sessionId }
      }
    }
  } satisfies ExtensionClientMessage));
  await expect(registered).resolves.toMatchObject({ type: "registered" });
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi-postbox-profile-isolation-"));
  tempDirs.push(root);
  return root;
}
