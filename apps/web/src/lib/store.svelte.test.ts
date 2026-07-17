import { describe, expect, it } from "vitest";
import type { AskRequestSnapshot, SessionSnapshot, StateSnapshot } from "@pi-postbox/protocol";
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

describe("store deselection of questions resolved on another device", () => {
  const liveSession = session({
    sessionId: "session-remote",
    projectId: "remote-project",
    projectName: "Remote Project",
    presence: "live",
    semanticState: "blocked"
  });

  function askRequest(requestId: string, status: AskRequestSnapshot["status"]): AskRequestSnapshot {
    return {
      requestId,
      sessionId: "session-remote",
      mode: "single",
      question: { prompt: `Prompt for ${requestId}` },
      options: [{ value: "yes", label: "Yes" }],
      context: {
        codebaseContext: "Svelte dashboard store with multi-device state synchronization.",
        problemContext: "Keep navigation correct when a remote decision resolves."
      },
      status,
      createdAt: SNAPSHOT_TIME
    };
  }

  function remoteSnapshot(requests: AskRequestSnapshot[]): StateSnapshot {
    return { timestamp: SNAPSHOT_TIME, sessions: [liveSession], requests };
  }

  it("clears the selection when the open question resolves remotely and its project has no other open questions", () => {
    store.applyStateSnapshot(remoteSnapshot([askRequest("ask-remote", "pending")]));
    store.selectRequest("ask-remote");

    store.applyStateSnapshot(remoteSnapshot([askRequest("ask-remote", "answered")]));

    expect(store.selection).toEqual({ kind: "none" });
  });

  it("routes to the project queue when the project still has other open questions", () => {
    store.applyStateSnapshot(remoteSnapshot([askRequest("ask-remote", "pending"), askRequest("ask-other", "pending")]));
    store.selectRequest("ask-remote");

    store.applyStateSnapshot(remoteSnapshot([askRequest("ask-remote", "cancelled"), askRequest("ask-other", "pending")]));

    expect(store.selection).toEqual({ kind: "project", projectId: "remote-project" });
  });

  it("keeps the selection while this tab is resolving the question locally", () => {
    store.applyStateSnapshot(remoteSnapshot([askRequest("ask-remote", "pending")]));
    store.selectRequest("ask-remote");
    store.beginLocalResolve("ask-remote");

    store.applyStateSnapshot(remoteSnapshot([askRequest("ask-remote", "answered")]));

    expect(store.selection).toEqual({ kind: "request", requestId: "ask-remote" });
    store.endLocalResolve("ask-remote");
  });

  it("leaves non-request selections untouched when questions resolve", () => {
    store.applyStateSnapshot(remoteSnapshot([askRequest("ask-remote", "pending")]));
    store.selectSession("session-remote");

    store.applyStateSnapshot(remoteSnapshot([askRequest("ask-remote", "answered")]));

    expect(store.selection).toEqual({ kind: "session", sessionId: "session-remote" });
  });
});

describe("store notification navigation", () => {
  const liveSession = session({
    sessionId: "session-notification",
    projectId: "notification-project",
    projectName: "Notification Project",
    presence: "live",
    semanticState: "blocked"
  });

  function askRequest(status: AskRequestSnapshot["status"]): AskRequestSnapshot {
    return {
      requestId: "ask-notification",
      sessionId: liveSession.sessionId,
      mode: "single",
      question: { prompt: "Still need an answer?" },
      options: [{ value: "yes", label: "Yes" }],
      context: {
        codebaseContext: "Svelte dashboard store with notification navigation.",
        problemContext: "Open a pending decision from a device notification."
      },
      status,
      createdAt: SNAPSHOT_TIME
    };
  }

  it("shows home while checking and opens a tapped question only after a fresh snapshot confirms it is pending", async () => {
    store.applyStateSnapshot({ timestamp: SNAPSHOT_TIME, sessions: [liveSession], requests: [askRequest("pending")] });
    store.selectRequest("ask-notification");
    let releaseFetch!: (snapshot: StateSnapshot) => void;
    const fetchCurrentSnapshot = () => new Promise<StateSnapshot>((resolve) => (releaseFetch = resolve));

    const navigation = store.openRequestFromNotification("ask-notification", fetchCurrentSnapshot);

    expect(store.selection).toEqual({ kind: "none" });
    expect(store.syncing).toBe(true);

    releaseFetch({ timestamp: SNAPSHOT_TIME, sessions: [liveSession], requests: [askRequest("pending")] });
    await navigation;

    expect(store.selection).toEqual({ kind: "request", requestId: "ask-notification" });
  });

  it("stays on home when a fresh snapshot says the tapped question was already answered", async () => {
    store.applyStateSnapshot({ timestamp: SNAPSHOT_TIME, sessions: [liveSession], requests: [askRequest("pending")] });
    store.selectRequest("ask-notification");

    await store.openRequestFromNotification("ask-notification", async () => ({
      timestamp: SNAPSHOT_TIME,
      sessions: [liveSession],
      requests: [askRequest("answered")]
    }));

    expect(store.selection).toEqual({ kind: "none" });
  });

  it("keeps the latest tapped notification selected when an older refresh finishes last", async () => {
    const secondRequest = { ...askRequest("pending"), requestId: "ask-notification-2" };
    let releaseFirstFetch!: (snapshot: StateSnapshot) => void;
    const firstNavigation = store.openRequestFromNotification(
      "ask-notification",
      () => new Promise<StateSnapshot>((resolve) => (releaseFirstFetch = resolve))
    );
    const snapshot = {
      timestamp: SNAPSHOT_TIME,
      sessions: [liveSession],
      requests: [askRequest("pending"), secondRequest]
    };

    await store.openRequestFromNotification("ask-notification-2", async () => snapshot);
    releaseFirstFetch(snapshot);
    await firstNavigation;

    expect(store.selection).toEqual({ kind: "request", requestId: "ask-notification-2" });
  });
});

describe("store sync freshness", () => {
  it("clears the syncing flag once a snapshot is applied", () => {
    store.syncing = true;

    store.applyStateSnapshot({ timestamp: SNAPSHOT_TIME, sessions: [], requests: [] });

    expect(store.syncing).toBe(false);
  });
});
