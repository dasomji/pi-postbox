import { StateSnapshotSchema, type ExtensionClientMessage } from "@pi-postbox/protocol";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { createPostboxApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";

const apps: FastifyInstance[] = [];
const sockets: WebSocket[] = [];

function listenerPort(app: FastifyInstance): number {
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP listener");
  return address.port;
}

function registrationMessage(overrides: Partial<ExtensionClientMessage & { type: "session.register" }> = {}): ExtensionClientMessage {
  return {
    type: "session.register",
    requestId: "register-meta-1",
    payload: {
      machine: { machineId: "machine-meta-1", hostname: "workstation" },
      project: {
        projectId: "project-worktree-1",
        name: "pi-postbox",
        displayName: "Detected Postbox",
        description: "Detected description",
        cwd: "/worktrees/postbox-feature",
        gitRoot: "/worktrees/postbox-feature",
        repoName: "pi-postbox",
        branch: "feature/postbox",
        headSha: "0123456789abcdef0123456789abcdef01234567",
        isDirty: true,
        worktreePath: "/worktrees/postbox-feature",
        icon: {
          hash: "sha256:test-icon",
          dataUrl: "data:image/svg+xml;base64,PHN2Zy8+",
          mediaType: "image/svg+xml",
          sizeBytes: 6
        }
      },
      session: {
        sessionId: "session-meta-1",
        cwd: "/worktrees/postbox-feature",
        branch: "feature/postbox",
        worktreePath: "/worktrees/postbox-feature",
        semanticState: "idle"
      }
    },
    ...overrides
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
  const registered = new Promise<unknown>((resolve) => socket.once("message", (raw) => resolve(JSON.parse(raw.toString()))));
  socket.send(JSON.stringify(message));
  await expect(registered).resolves.toMatchObject({ type: "registered" });
  return socket;
}

afterEach(async () => {
  for (const socket of sockets.splice(0)) {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
  }
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("presentation metadata", () => {
  it("persists uploaded project icon data and exposes git/worktree metadata without reading server-local files", async () => {
    const app = await createPostboxApp({ databasePath: ":memory:", now: () => 1_000 });
    apps.push(app);
    await connectAndRegister(app);

    const snapshot = StateSnapshotSchema.parse((await app.inject({ method: "GET", url: "/api/state" })).json());

    expect(snapshot.sessions[0]).toMatchObject({
      projectName: "Detected Postbox",
      projectDetectedName: "pi-postbox",
      projectDescription: "Detected description",
      repoName: "pi-postbox",
      gitRoot: "/worktrees/postbox-feature",
      branch: "feature/postbox",
      headSha: "0123456789abcdef0123456789abcdef01234567",
      isDirty: true,
      worktreePath: "/worktrees/postbox-feature",
      projectIcon: {
        hash: "sha256:test-icon",
        dataUrl: "data:image/svg+xml;base64,PHN2Zy8+",
        mediaType: "image/svg+xml"
      }
    });
  });

  it("returns validation errors for malformed rename payloads", async () => {
    const app = await createPostboxApp({ databasePath: ":memory:", now: () => 1_000 });
    apps.push(app);
    await connectAndRegister(app);

    const missingName = await app.inject({
      method: "POST",
      url: "/api/machines/machine-meta-1/rename",
      payload: {}
    });
    const tooLong = await app.inject({
      method: "POST",
      url: "/api/projects/project-worktree-1/rename",
      payload: { displayName: "x".repeat(121) }
    });

    expect(missingName.statusCode).toBe(400);
    expect(missingName.json()).toMatchObject({ code: "invalid_rename" });
    expect(tooLong.statusCode).toBe(400);
    expect(tooLong.json()).toMatchObject({ code: "invalid_rename" });
  });

  it("persists machine and project aliases across restart and keeps worktree-specific projects distinct", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-postbox-metadata-db-"));
    const databasePath = join(dir, "postbox.sqlite");

    try {
      let app = await createPostboxApp({ databasePath, now: () => 1_000 });
      apps.push(app);
      await connectAndRegister(app);

      const machineRename = await app.inject({
        method: "POST",
        url: "/api/machines/machine-meta-1/rename",
        payload: { displayName: "Studio Mac" }
      });
      const projectRename = await app.inject({
        method: "POST",
        url: "/api/projects/project-worktree-1/rename",
        payload: { displayName: "Postbox Feature WT" }
      });
      expect(machineRename.statusCode).toBe(200);
      expect(projectRename.statusCode).toBe(200);

      const secondWorktree = registrationMessage({
        requestId: "register-meta-2",
        payload: {
          ...registrationMessage().payload,
          project: {
            ...registrationMessage().payload.project,
            projectId: "project-worktree-2",
            displayName: "Detected Postbox",
            cwd: "/worktrees/postbox-other",
            gitRoot: "/worktrees/postbox-other",
            branch: "feature/other",
            worktreePath: "/worktrees/postbox-other"
          },
          session: {
            ...registrationMessage().payload.session,
            sessionId: "session-meta-2",
            cwd: "/worktrees/postbox-other",
            branch: "feature/other",
            worktreePath: "/worktrees/postbox-other"
          }
        }
      });
      const socket = sockets[0]!;
      socket.send(JSON.stringify(secondWorktree));
      await new Promise((resolve) => socket.once("message", resolve));

      await app.close();
      apps.pop();

      app = await createPostboxApp({ databasePath, now: () => 2_000 });
      apps.push(app);
      const snapshot = StateSnapshotSchema.parse((await app.inject({ method: "GET", url: "/api/state" })).json());
      const renamed = snapshot.sessions.find((session) => session.projectId === "project-worktree-1");
      const other = snapshot.sessions.find((session) => session.projectId === "project-worktree-2");

      expect(renamed).toMatchObject({ machineName: "Studio Mac", projectName: "Postbox Feature WT", branch: "feature/postbox" });
      expect(other).toMatchObject({ machineName: "Studio Mac", projectName: "Detected Postbox", branch: "feature/other" });
      expect(renamed?.worktreePath).not.toBe(other?.worktreePath);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
