import {
  compareAskUrgency,
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

export function comparePendingRequests(a: AskRequestSnapshot, b: AskRequestSnapshot): number {
  return compareAskUrgency(a.urgency, b.urgency) || Date.parse(a.createdAt) - Date.parse(b.createdAt);
}

class PostboxStore {
  /**
   * Requests this tab is resolving itself. Their snapshot transition to a terminal
   * status must not auto-deselect, so the local answer flow keeps its delivered-stamp
   * confirmation and does its own routing afterwards.
   */
  private readonly locallyResolvingRequestIds = new Set<string>();
  private locallyRetainedRequest: AskRequestSnapshot | undefined;
  private displayedRequest: AskRequestSnapshot | undefined;
  private historyLoadPromise: Promise<HistoryResponse> | undefined;
  private snapshotLoadPromise: Promise<StateSnapshot> | undefined;
  private readonly snapshotWaiters = new Set<{
    resolve: (snapshot: StateSnapshot) => void;
    reject: (error: Error) => void;
  }>();
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
  pendingRequests = $derived(
    this.requests.filter((request) => request.status === "pending").sort(comparePendingRequests)
  );
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
    return this.requests.find((request) => request.requestId === selection.requestId)
      ?? (this.locallyRetainedRequest?.requestId === selection.requestId ? this.locallyRetainedRequest : undefined);
  });

  displayedSelectedRequest = $derived.by(() => this.displayedRequest?.requestId === this.selectedRequest?.requestId ? this.displayedRequest : this.selectedRequest);

  selectedSession = $derived.by<SessionSnapshot | undefined>(() => {
    const selection = this.selection;
    if (selection.kind === "session") {
      return this.sessions.find((session) => session.sessionId === selection.sessionId);
    }
    if (selection.kind === "request") {
      const request = this.requests.find((entry) => entry.requestId === selection.requestId)
        ?? (this.locallyRetainedRequest?.requestId === selection.requestId ? this.locallyRetainedRequest : undefined);
      return request ? this.sessions.find((session) => session.sessionId === request.sessionId) : undefined;
    }
    return undefined;
  });

  openQuestionsFor(sessionId: string): AskRequestSnapshot[] {
    return this.requestsBySession.get(sessionId) ?? [];
  }

  selectSession(sessionId: string): void {
    this.displayedRequest = undefined;
    this.locallyRetainedRequest = undefined;
    this.selection = { kind: "session", sessionId };
  }

  selectRequest(requestId: string): void {
    if (this.selection.kind !== "request" || this.selection.requestId !== requestId) {
      this.displayedRequest = this.requests.find((request) => request.requestId === requestId);
    }
    if (this.locallyRetainedRequest?.requestId !== requestId) this.locallyRetainedRequest = undefined;
    this.selection = { kind: "request", requestId };
  }

  selectProject(projectId: string): void {
    this.displayedRequest = undefined;
    this.locallyRetainedRequest = undefined;
    this.selection = { kind: "project", projectId };
  }

  async showHistory(fetchCurrentHistory: () => Promise<HistoryResponse> = fetchHistory): Promise<void> {
    this.locallyRetainedRequest = undefined;
    this.selection = { kind: "history" };
    await this.loadHistory(fetchCurrentHistory);
  }

  clearSelection(): void {
    this.displayedRequest = undefined;
    this.locallyRetainedRequest = undefined;
    this.selection = { kind: "none" };
  }

  /**
   * A notification can outlive its question. Hide any previously selected question while a fresh
   * snapshot is fetched, then open the target only when the server still reports it as pending.
   */
  async openRequestFromNotification(
    requestId: string,
    fetchCurrentSnapshot?: () => Promise<StateSnapshot>
  ): Promise<void> {
    const attempt = ++this.notificationNavigationAttempt;
    this.clearSelection();
    this.syncing = true;

    try {
      const next = fetchCurrentSnapshot
        ? await this.requestSnapshot(fetchCurrentSnapshot)
        : this.snapshot.status === "loading"
          ? await this.waitForNextSnapshot()
          : await this.requestSnapshot(fetchSnapshot);
      if (attempt !== this.notificationNavigationAttempt) return;
      const request = next.requests.find((candidate) => candidate.requestId === requestId);
      if (request?.status === "pending") this.selectRequest(requestId);
      else this.clearSelection();
    } catch (error) {
      if (attempt !== this.notificationNavigationAttempt) return;
      this.failStateSnapshot(error, "Unknown state snapshot error");
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
    const selection = this.selection;
    const previouslySelectedRequest = selection.kind === "request"
      ? this.requests.find((entry) => entry.requestId === selection.requestId)
        ?? (this.locallyRetainedRequest?.requestId === selection.requestId ? this.locallyRetainedRequest : undefined)
      : undefined;

    if (previouslySelectedRequest && !this.displayedRequest) this.displayedRequest = previouslySelectedRequest;
    this.snapshot = { status: "ready", data: next };
    this.syncing = false;
    this.lastSnapshotAtMs = Date.now();
    this.deselectRemotelyResolvedRequest(previouslySelectedRequest);
    for (const waiter of this.snapshotWaiters) waiter.resolve(next);
    this.snapshotWaiters.clear();
  }

  /** A question answered or cancelled elsewhere disappears from the device that still had it open. */
  private deselectRemotelyResolvedRequest(previouslySelectedRequest: AskRequestSnapshot | undefined): void {
    const selection = this.selection;
    if (selection.kind !== "request") return;

    const currentRequest = this.requests.find((entry) => entry.requestId === selection.requestId);
    if (currentRequest?.status === "pending") {
      this.locallyRetainedRequest = undefined;
      return;
    }
    if (this.locallyResolvingRequestIds.has(selection.requestId)) {
      this.locallyRetainedRequest = previouslySelectedRequest;
      return;
    }
    if (previouslySelectedRequest) this.routeAfterRequestResolved(previouslySelectedRequest.sessionId);
  }

  async loadSnapshot(fetchCurrentSnapshot: () => Promise<StateSnapshot> = fetchSnapshot): Promise<void> {
    try {
      await this.requestSnapshot(fetchCurrentSnapshot);
    } catch (error) {
      this.failStateSnapshot(error, "Unknown state snapshot error");
    }
  }

  private requestSnapshot(fetchCurrentSnapshot: () => Promise<StateSnapshot>): Promise<StateSnapshot> {
    if (this.snapshotLoadPromise) return this.snapshotLoadPromise;

    let tracked: Promise<StateSnapshot>;
    tracked = fetchCurrentSnapshot()
      .then((next) => {
        this.applyStateSnapshot(next);
        return next;
      })
      .finally(() => {
        if (this.snapshotLoadPromise === tracked) this.snapshotLoadPromise = undefined;
      });
    this.snapshotLoadPromise = tracked;
    return tracked;
  }

  private waitForNextSnapshot(): Promise<StateSnapshot> {
    return new Promise<StateSnapshot>((resolve, reject) => {
      this.snapshotWaiters.add({ resolve, reject });
    });
  }

  private failStateSnapshot(error: unknown, fallback: string): void {
    const message = messageOf(error, fallback);
    this.snapshot = { status: "error", message };
    this.syncing = false;
    for (const waiter of this.snapshotWaiters) waiter.reject(new Error(message));
    this.snapshotWaiters.clear();
  }

  async loadHistory(fetchCurrentHistory: () => Promise<HistoryResponse> = fetchHistory): Promise<void> {
    this.history = { status: "loading" };
    const load = this.historyLoadPromise ?? fetchCurrentHistory();
    this.historyLoadPromise = load;
    try {
      this.history = { status: "ready", data: await load };
    } catch (error) {
      this.history = { status: "error", message: messageOf(error, "Unknown history error") };
    } finally {
      if (this.historyLoadPromise === load) this.historyLoadPromise = undefined;
    }
  }

  async refresh(): Promise<void> {
    await this.loadSnapshot();
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

    const applySnapshot = (next: StateSnapshot) => {
      if (!cancelled) this.applyStateSnapshot(next);
    };

    const load = () => {
      fetchSnapshot()
        .then(applySnapshot)
        .catch((error: unknown) => {
          if (!cancelled) this.failStateSnapshot(error, "Unknown state snapshot error");
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
        } catch (error) {
          if (!cancelled) this.failStateSnapshot(error, "Invalid live state event");
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
