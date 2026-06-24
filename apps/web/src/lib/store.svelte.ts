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
  snapshot = $state<Loadable<StateSnapshot>>({ status: "loading" });
  history = $state<Loadable<HistoryResponse>>({ status: "loading" });
  connection = $state<ConnectionState>({ status: "checking" });
  selection = $state<Selection>({ kind: "none" });

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

  showHistory(): void {
    this.selection = { kind: "history" };
  }

  clearSelection(): void {
    this.selection = { kind: "none" };
  }

  async loadSnapshot(): Promise<void> {
    try {
      this.snapshot = { status: "ready", data: await fetchSnapshot() };
    } catch (error) {
      this.snapshot = { status: "error", message: messageOf(error, "Unknown state snapshot error") };
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

    const applySnapshot = (next: StateSnapshot) => {
      if (!cancelled) this.snapshot = { status: "ready", data: next };
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

    return () => {
      cancelled = true;
      events?.close();
      if (fallbackTimer) clearInterval(fallbackTimer);
    };
  }
}

const SIDEBAR_RECENT_OFFLINE_WINDOW_MS = 5 * 60 * 1000;

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
