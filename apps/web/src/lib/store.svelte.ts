import {
  StateSnapshotSchema,
  type AskRequestSnapshot,
  type HealthResponse,
  type HistoryResponse,
  type SessionSnapshot,
  type StateSnapshot
} from "@pi-postbox/protocol";
import { fetchHealth, fetchHistory, fetchSnapshot } from "../api/postboxApi";
import { branchLabel } from "./status";

export type Selection =
  | { kind: "none" }
  | { kind: "session"; sessionId: string }
  | { kind: "request"; requestId: string }
  | { kind: "project"; projectId: string }
  | { kind: "history" };

export type ConnectionState =
  | { status: "checking" }
  | { status: "connected"; health: HealthResponse }
  | { status: "unavailable"; message: string };

export type Loadable<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; message: string };

export interface ProjectGroup {
  projectId: string;
  projectName: string;
  projectIcon?: SessionSnapshot["projectIcon"];
  sessions: SessionSnapshot[];
}

class PostboxStore {
  /**
   * Requests this tab is resolving itself. Their snapshot transition to a terminal
   * status must not auto-deselect, so the local answer flow keeps its delivered-stamp
   * confirmation and does its own routing afterwards.
   */
  private readonly locallyResolvingRequestIds = new Set<string>();
  private notificationNavigationAttempt = 0;

  snapshot = $state<Loadable<StateSnapshot>>({ status: "loading" });
  history = $state<Loadable<HistoryResponse>>({ status: "loading" });
  connection = $state<ConnectionState>({ status: "checking" });
  selection = $state<Selection>({ kind: "none" });

  /**
   * True while the data on screen may be stale: before the first snapshot, and again after the
   * tab returns from the background until a fresh snapshot lands. Empty views say "checking"
   * instead of claiming there are no open questions.
   */
  syncing = $state(true);
  private lastSnapshotAtMs = 0;

  sessions = $derived(this.snapshot.status === "ready" ? this.snapshot.data.sessions : []);
  requests = $derived(this.snapshot.status === "ready" ? this.snapshot.data.requests : []);
  pendingRequests = $derived(this.requests.filter((request) => request.status === "pending"));
  timestamp = $derived(this.snapshot.status === "ready" ? this.snapshot.data.timestamp : undefined);

  requestsBySession = $derived.by(() => {
    const map = new Map<string, AskRequestSnapshot[]>();
    for (const request of this.pendingRequests) {
      const list = map.get(request.sessionId);
      if (list) list.push(request);
      else map.set(request.sessionId, [request]);
    }
    return map;
  });

  projects = $derived.by<ProjectGroup[]>(() => {
    const groups = new Map<string, ProjectGroup>();
    const snapshotTimestamp = this.timestamp;
    for (const session of this.sessions) {
      if (!isSidebarSessionVisible(session, snapshotTimestamp)) continue;

      const group = groups.get(session.projectId);
      if (group) group.sessions.push(session);
      else
        groups.set(session.projectId, {
          projectId: session.projectId,
          projectName: session.projectName,
          projectIcon: session.projectIcon,
          sessions: [session]
        });
    }
    const list = [...groups.values()];
    list.sort((a, b) => a.projectName.localeCompare(b.projectName));
    for (const group of list) {
      group.sessions.sort((a, b) => branchLabel(a).localeCompare(branchLabel(b)));
    }
    return list;
  });

  selectedRequest = $derived.by<AskRequestSnapshot | undefined>(() => {
    const selection = this.selection;
    if (selection.kind !== "request") return undefined;
    return this.requests.find((request) => request.requestId === selection.requestId);
  });

  selectedSession = $derived.by<SessionSnapshot | undefined>(() => {
    const selection = this.selection;
    if (selection.kind === "session") {
      return this.sessions.find((session) => session.sessionId === selection.sessionId);
    }
    if (selection.kind === "request") {
      const request = this.requests.find((entry) => entry.requestId === selection.requestId);
      return request ? this.sessions.find((session) => session.sessionId === request.sessionId) : undefined;
    }
    return undefined;
  });

  openQuestionsFor(sessionId: string): AskRequestSnapshot[] {
    return this.requestsBySession.get(sessionId) ?? [];
  }

  selectSession(sessionId: string): void {
    this.selection = { kind: "session", sessionId };
  }

  selectRequest(requestId: string): void {
    this.selection = { kind: "request", requestId };
  }

  selectProject(projectId: string): void {
    this.selection = { kind: "project", projectId };
  }

  showHistory(): void {
    this.selection = { kind: "history" };
  }

  clearSelection(): void {
    this.selection = { kind: "none" };
  }

  /**
   * A notification can outlive its question. Hide any previously selected question while a fresh
   * snapshot is fetched, then open the target only when the server still reports it as pending.
   */
  async openRequestFromNotification(
    requestId: string,
    fetchCurrentSnapshot: () => Promise<StateSnapshot> = fetchSnapshot
  ): Promise<void> {
    const attempt = ++this.notificationNavigationAttempt;
    this.clearSelection();
    this.syncing = true;

    try {
      const next = await fetchCurrentSnapshot();
      if (attempt !== this.notificationNavigationAttempt) return;
      this.applyStateSnapshot(next);
      const request = next.requests.find((candidate) => candidate.requestId === requestId);
      if (request?.status === "pending") this.selectRequest(requestId);
      else this.clearSelection();
    } catch (error) {
      if (attempt !== this.notificationNavigationAttempt) return;
      this.snapshot = { status: "error", message: messageOf(error, "Unknown state snapshot error") };
      this.syncing = false;
      this.clearSelection();
    }
  }

  beginLocalResolve(requestId: string): void {
    this.locallyResolvingRequestIds.add(requestId);
  }

  endLocalResolve(requestId: string): void {
    this.locallyResolvingRequestIds.delete(requestId);
  }

  /** Land where the next decision is: the project's queue while it still has open questions, otherwise the main page. */
  routeAfterRequestResolved(sessionId: string): void {
    const session = this.sessions.find((candidate) => candidate.sessionId === sessionId);
    const projectId = session?.projectId;
    const projectHasOpenQuestions =
      projectId !== undefined &&
      this.sessions.some(
        (candidate) => candidate.projectId === projectId && this.openQuestionsFor(candidate.sessionId).length > 0
      );
    if (projectId !== undefined && projectHasOpenQuestions) this.selectProject(projectId);
    else this.clearSelection();
  }

  applyStateSnapshot(next: StateSnapshot): void {
    this.snapshot = { status: "ready", data: next };
    this.syncing = false;
    this.lastSnapshotAtMs = Date.now();
    this.deselectRemotelyResolvedRequest();
  }

  /** A question answered or cancelled elsewhere disappears from the device that still had it open. */
  private deselectRemotelyResolvedRequest(): void {
    const selection = this.selection;
    if (selection.kind !== "request") return;
    if (this.locallyResolvingRequestIds.has(selection.requestId)) return;

    const request = this.requests.find((entry) => entry.requestId === selection.requestId);
    if (!request || request.status === "pending") return;
    this.routeAfterRequestResolved(request.sessionId);
  }

  async loadSnapshot(): Promise<void> {
    try {
      this.applyStateSnapshot(await fetchSnapshot());
    } catch (error) {
      this.snapshot = { status: "error", message: messageOf(error, "Unknown state snapshot error") };
      this.syncing = false;
    }
  }

  async loadHistory(): Promise<void> {
    try {
      this.history = { status: "ready", data: await fetchHistory() };
    } catch (error) {
      this.history = { status: "error", message: messageOf(error, "Unknown history error") };
    }
  }

  async refresh(): Promise<void> {
    await Promise.all([this.loadSnapshot(), this.loadHistory()]);
  }

  /** Begin live updates (health probe, SSE stream, polling fallback). Returns a cleanup function. */
  start(): () => void {
    let cancelled = false;
    let fallbackTimer: ReturnType<typeof setInterval> | undefined;
    let events: EventSource | undefined;

    void fetchHealth()
      .then((health) => {
        if (!cancelled) this.connection = { status: "connected", health };
      })
      .catch((error: unknown) => {
        if (!cancelled) this.connection = { status: "unavailable", message: messageOf(error, "Unknown health check error") };
      });

    void this.loadHistory();
    // Fetch immediately instead of waiting for the SSE stream's first event, so a fresh open
    // (e.g. from a push notification) renders real data as fast as one round-trip allows.
    void this.loadSnapshot();

    const applySnapshot = (next: StateSnapshot) => {
      if (!cancelled) this.applyStateSnapshot(next);
    };

    const load = () => {
      fetchSnapshot()
        .then(applySnapshot)
        .catch((error: unknown) => {
          if (!cancelled) this.snapshot = { status: "error", message: messageOf(error, "Unknown state snapshot error") };
        });
    };

    const startPollingFallback = () => {
      if (fallbackTimer) return;
      load();
      fallbackTimer = setInterval(load, 5_000);
    };

    if (!("EventSource" in window)) {
      startPollingFallback();
    } else {
      events = new EventSource("/api/state/events");
      events.addEventListener("state", (event) => {
        try {
          applySnapshot(StateSnapshotSchema.parse(JSON.parse((event as MessageEvent).data)));
          void this.loadHistory();
        } catch (error) {
          if (!cancelled) this.snapshot = { status: "error", message: messageOf(error, "Invalid live state event") };
        }
      });
      events.onerror = () => startPollingFallback();
    }

    // Returning from the background: the SSE stream may be dead or throttled, so refetch right
    // away, and stop claiming "no open questions" if what we show is more than briefly stale.
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible" || cancelled) return;
      if (Date.now() - this.lastSnapshotAtMs > STALE_AFTER_RESUME_MS) this.syncing = true;
      void this.loadSnapshot();
      void this.loadHistory();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      events?.close();
      if (fallbackTimer) clearInterval(fallbackTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }
}

const SIDEBAR_RECENT_OFFLINE_WINDOW_MS = 5 * 60 * 1000;
const STALE_AFTER_RESUME_MS = 10_000;

function isSidebarSessionVisible(session: SessionSnapshot, snapshotTimestamp: string | undefined): boolean {
  if (session.presence !== "offline") return true;
  if (!snapshotTimestamp || !session.disconnectedAt) return false;

  const snapshotTime = Date.parse(snapshotTimestamp);
  const disconnectedTime = Date.parse(session.disconnectedAt);
  if (!Number.isFinite(snapshotTime) || !Number.isFinite(disconnectedTime)) return false;

  return snapshotTime - disconnectedTime < SIDEBAR_RECENT_OFFLINE_WINDOW_MS;
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export const store = new PostboxStore();
