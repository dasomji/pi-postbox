import { describe, expect, it } from "vitest";
import type { SessionSnapshot, StateSnapshot } from "@pi-postbox/protocol";
import { store } from "./store.svelte";

const SNAPSHOT_TIME = "2026-06-24T12:00:00.000Z";

function session(overrides: Partial<SessionSnapshot> & Pick<SessionSnapshot, "sessionId" | "projectId" | "projectName" | "presence" | "semanticState">): SessionSnapshot {
  return {
    sessionId: overrides.sessionId,
    machineId: "machine-1",
    machineName: "Workstation",
    hostname: "workstation.local",
    projectId: overrides.projectId,
    projectName: overrides.projectName,
    cwd: `/workspace/${overrides.projectId}`,
    branch: overrides.branch ?? overrides.sessionId,
    semanticState: overrides.semanticState,
    presence: overrides.presence,
    updatedAt: overrides.updatedAt ?? SNAPSHOT_TIME,
    connectedAt: overrides.connectedAt,
    disconnectedAt: overrides.disconnectedAt,
    title: overrides.title,
    projectDetectedName: overrides.projectDetectedName,
    projectDescription: overrides.projectDescription,
    projectIcon: overrides.projectIcon,
    gitRoot: overrides.gitRoot,
    repoName: overrides.repoName,
    headSha: overrides.headSha,
    isDirty: overrides.isDirty,
    worktreePath: overrides.worktreePath,
    lastHeartbeatAt: overrides.lastHeartbeatAt
  };
}

describe("store sidebar project groups", () => {
  it("shows live, stale, and recently disconnected sessions while hiding older offline sessions and empty projects", () => {
    const snapshot: StateSnapshot = {
      timestamp: SNAPSHOT_TIME,
      requests: [],
      sessions: [
        session({
          sessionId: "live-working",
          projectId: "visible-project",
          projectName: "Visible Project",
          branch: "e-working-live",
          presence: "live",
          semanticState: "working"
        }),
        session({
          sessionId: "stale-blocked",
          projectId: "visible-project",
          projectName: "Visible Project",
          branch: "a-blocked-stale",
          presence: "stale",
          semanticState: "blocked"
        }),
        session({
          sessionId: "live-idle",
          projectId: "visible-project",
          projectName: "Visible Project",
          branch: "b-idle-live",
          presence: "live",
          semanticState: "idle"
        }),
        session({
          sessionId: "stale-unknown",
          projectId: "visible-project",
          projectName: "Visible Project",
          branch: "d-unknown-stale",
          presence: "stale",
          semanticState: "unknown"
        }),
        session({
          sessionId: "recent-offline",
          projectId: "visible-project",
          projectName: "Visible Project",
          branch: "c-recent-offline",
          presence: "offline",
          semanticState: "unknown",
          disconnectedAt: "2026-06-24T11:55:01.000Z"
        }),
        session({
          sessionId: "old-offline-in-visible-project",
          projectId: "visible-project",
          projectName: "Visible Project",
          branch: "old-offline",
          presence: "offline",
          semanticState: "unknown",
          disconnectedAt: "2026-06-24T11:55:00.000Z"
        }),
        session({
          sessionId: "old-offline-only-session",
          projectId: "old-offline-project",
          projectName: "Old Offline Project",
          presence: "offline",
          semanticState: "unknown",
          disconnectedAt: "2026-06-24T11:54:59.000Z"
        }),
        session({
          sessionId: "missing-disconnected-at",
          projectId: "missing-disconnect-project",
          projectName: "Missing Disconnect Project",
          presence: "offline",
          semanticState: "unknown"
        }),
        session({
          sessionId: "invalid-disconnected-at",
          projectId: "invalid-disconnect-project",
          projectName: "Invalid Disconnect Project",
          presence: "offline",
          semanticState: "unknown",
          disconnectedAt: "not-a-date"
        })
      ]
    };

    store.snapshot = { status: "ready", data: snapshot };

    expect(store.projects.map((project) => project.projectName)).toEqual(["Visible Project"]);
    expect(store.projects[0]?.sessions.map((entry) => entry.sessionId)).toEqual([
      "stale-blocked",
      "live-idle",
      "recent-offline",
      "stale-unknown",
      "live-working"
    ]);
  });

  it("hides an offline session with an invalid disconnectedAt timestamp", () => {
    const snapshot: StateSnapshot = {
      timestamp: SNAPSHOT_TIME,
      requests: [],
      sessions: [
        session({
          sessionId: "invalid-disconnected-at",
          projectId: "invalid-disconnect-project",
          projectName: "Invalid Disconnect Project",
          presence: "offline",
          semanticState: "unknown",
          disconnectedAt: "not-a-date"
        })
      ]
    };

    store.snapshot = { status: "ready", data: snapshot };

    expect(store.projects).toEqual([]);
  });
});
