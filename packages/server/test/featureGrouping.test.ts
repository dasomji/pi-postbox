import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { createPostboxApp } from "../src/app.js";

const apps: FastifyInstance[] = [];
const sockets: WebSocket[] = [];
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
  await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  return socket;
}

function next(socket: WebSocket): Promise<any> {
  return new Promise((resolve, reject) => {
    socket.once("message", (raw) => resolve(JSON.parse(raw.toString())));
    socket.once("error", reject);
  });
}

async function register(socket: WebSocket, sessionId: string, worktreeId: string, branch: string, feature?: any): Promise<any> {
  const response = next(socket);
  socket.send(JSON.stringify({
    type: "session.register",
    requestId: `register-${sessionId}`,
    payload: {
      machine: { machineId: "machine-1", hostname: "workstation" },
      project: { projectId: `project-${worktreeId}`, name: "postbox", cwd: `/workspace/${worktreeId}` },
      session: {
        sessionId, cwd: `/workspace/${worktreeId}`, branch, semanticState: "working",
        repository: { repositoryId: "repo-1", remote: "github.com/acme/postbox" },
        worktree: { worktreeId, machineId: "machine-1", path: `/workspace/${worktreeId}` },
        ...(feature ? { feature } : {})
      }
    }
  }));
  return response;
}

describe("server-managed active feature", () => {
  it("generates one sticky worktree feature reused by later sessions and branch changes", async () => {
    const app = await createPostboxApp({ databasePath: ":memory:", expirySweepMs: 0 });
    apps.push(app);
    const first = await connect(app);
    const firstRegistration = await register(first, "session-1", "wt-1", "main");
    const feature = firstRegistration.payload.feature;
    expect(feature).toMatchObject({ featureId: expect.any(String) });

    const second = await connect(app);
    await expect(register(second, "session-2", "wt-1", "renamed-branch")).resolves.toMatchObject({
      payload: { feature }
    });
  });

  it("changes grouping only through explicit select/inherit and scopes discovery by default", async () => {
    const app = await createPostboxApp({ databasePath: ":memory:", expirySweepMs: 0 });
    apps.push(app);
    const socket = await connect(app);
    const initial = await register(socket, "session-1", "wt-1", "main");
    const firstFeatureId = initial.payload.feature.featureId;

    const selected = next(socket);
    socket.send(JSON.stringify({ type: "feature.action", requestId: "select", payload: {
      sessionId: "session-1", action: "start", name: "Second feature"
    }}));
    const secondFeatureId = (await selected).payload.feature.featureId;
    expect(secondFeatureId).not.toBe(firstFeatureId);

    const collaborator = await connect(app);
    await expect(register(collaborator, "session-2", "wt-2", "other", {
      action: "inherit", featureId: firstFeatureId
    })).resolves.toMatchObject({ payload: { feature: { featureId: firstFeatureId } } });

    const list = next(socket);
    socket.send(JSON.stringify({ type: "question.list", requestId: "list-default", payload: { sessionId: "session-1" } }));
    expect((await list).payload.scope).toEqual({ repositoryId: "repo-1", worktreeId: "wt-1", featureId: secondFeatureId });
  });

  it("rejects feature and discovery actions for another connection's session", async () => {
    const app = await createPostboxApp({ databasePath: ":memory:", expirySweepMs: 0 });
    apps.push(app);
    const first = await connect(app);
    const second = await connect(app);
    const firstRegistration = await register(first, "session-1", "wt-1", "main");
    await register(second, "session-2", "wt-2", "other");

    let response = next(first);
    first.send(JSON.stringify({ type: "feature.action", requestId: "foreign-feature", payload: {
      sessionId: "session-2", action: "select", featureId: firstRegistration.payload.feature.featureId
    }}));
    await expect(response).resolves.toMatchObject({ type: "error", requestId: "foreign-feature" });

    response = next(first);
    first.send(JSON.stringify({ type: "question.status.list", requestId: "foreign-status", payload: { sessionId: "session-2" } }));
    await expect(response).resolves.toMatchObject({ type: "error", requestId: "foreign-status" });

    response = next(first);
    first.send(JSON.stringify({ type: "question.list", requestId: "foreign-list", payload: { sessionId: "session-2" } }));
    await expect(response).resolves.toMatchObject({ type: "error", requestId: "foreign-list" });
  });

  it("rejects nonexistent select and inherit ids instead of manufacturing features", async () => {
    const app = await createPostboxApp({ databasePath: ":memory:", expirySweepMs: 0 });
    apps.push(app);
    const socket = await connect(app);
    await register(socket, "session-1", "wt-1", "main");
    for (const action of ["select", "inherit"] as const) {
      const response = next(socket);
      socket.send(JSON.stringify({ type: "feature.action", requestId: `missing-${action}`, payload: {
        sessionId: "session-1", action, featureId: `missing-${action}`
      }}));
      await expect(response).resolves.toMatchObject({ type: "error", requestId: `missing-${action}` });
    }

    const collaborator = await connect(app);
    await expect(register(collaborator, "session-2", "wt-2", "other", {
      action: "inherit", featureId: "missing-inherit"
    })).resolves.toMatchObject({ type: "error" });
  });
});
