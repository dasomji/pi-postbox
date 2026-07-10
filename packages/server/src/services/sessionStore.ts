import { ProjectIconSchema } from "@pi-postbox/protocol";
import type {
  PresenceState,
  SemanticState,
  SessionRegisterPayload,
  SessionSnapshot,
  SessionUpdatePayload,
  StateSnapshot
} from "@pi-postbox/protocol";
import type { SqliteDatabase } from "../db/database.js";

interface SessionPresenceRow {
  session_id: string;
  last_heartbeat_at: string | null;
  connected_at: string | null;
  disconnected_at: string | null;
  shutdown_at: string | null;
  updated_at: string;
}

interface SessionRow extends SessionPresenceRow {
  machine_id: string;
  hostname: string;
  display_name: string | null;
  project_id: string;
  project_name: string;
  project_display_name: string | null;
  project_description: string | null;
  git_root: string | null;
  repo_name: string | null;
  head_sha: string | null;
  is_dirty: number | null;
  icon_hash: string | null;
  icon_data_url: string | null;
  icon_media_type: string | null;
  icon_size_bytes: number | null;
  title: string | null;
  cwd: string;
  branch: string | null;
  worktree_path: string | null;
  semantic_state: SemanticState;
  has_pending_question: number;
}

export interface PresenceOptions {
  staleAfterMs: number;
  offlineAfterMs: number;
}

export interface SessionStoreOptions extends PresenceOptions {
  /** Offline sessions older than this are omitted from state snapshots. */
  hideOfflineAfterMs?: number;
  /** Offline sessions older than this are deleted, unless ask requests still reference them. */
  retentionMs?: number;
}

const DEFAULT_HIDE_OFFLINE_AFTER_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SESSION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

// When a session went offline: explicit disconnect/shutdown timestamp, or the
// last sign of life for sessions orphaned by a server restart.
const OFFLINE_SINCE_SQL =
  "COALESCE(sessions.disconnected_at, sessions.shutdown_at, sessions.last_heartbeat_at, sessions.updated_at)";

function validatedDurationMs(value: number, optionName: string, nowMs: number): number {
  const cutoffMs = nowMs - value;
  if (
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    !Number.isFinite(cutoffMs) ||
    Number.isNaN(new Date(cutoffMs).getTime())
  ) {
    throw new RangeError(`${optionName} must be a positive safe integer within the supported date range`);
  }
  return value;
}

export class SessionStore {
  private readonly activeConnections = new Map<string, string>();
  private readonly hideOfflineAfterMs: number;
  private readonly retentionMs: number;
  private closed = false;

  constructor(
    private readonly db: SqliteDatabase,
    private readonly now: () => number,
    private readonly presenceOptions: SessionStoreOptions
  ) {
    const nowMs = now();
    this.hideOfflineAfterMs = validatedDurationMs(
      presenceOptions.hideOfflineAfterMs ?? DEFAULT_HIDE_OFFLINE_AFTER_MS,
      "hideOfflineAfterMs",
      nowMs
    );
    this.retentionMs = validatedDurationMs(
      presenceOptions.retentionMs ?? DEFAULT_SESSION_RETENTION_MS,
      "retentionMs",
      nowMs
    );
  }

  close(): void {
    this.closed = true;
    this.activeConnections.clear();
  }

  register(connectionId: string, payload: SessionRegisterPayload): void {
    if (this.closed) return;
    const nowIso = new Date(this.now()).toISOString();
    const insertMachine = this.db.prepare(`
      INSERT INTO machines (machine_id, hostname, display_name, created_at, updated_at)
      VALUES (@machineId, @hostname, @displayName, @nowIso, @nowIso)
      ON CONFLICT(machine_id) DO UPDATE SET
        hostname = excluded.hostname,
        display_name = COALESCE(excluded.display_name, machines.display_name),
        updated_at = excluded.updated_at
    `);
    const insertProject = this.db.prepare(`
      INSERT INTO projects (
        project_id, name, display_name, description, cwd, git_root, repo_name, branch,
        head_sha, is_dirty, worktree_path, icon_hash, icon_data_url, icon_media_type,
        icon_size_bytes, created_at, updated_at
      ) VALUES (
        @projectId, @name, @displayName, @description, @cwd, @gitRoot, @repoName, @branch,
        @headSha, @isDirty, @worktreePath, @iconHash, @iconDataUrl, @iconMediaType,
        @iconSizeBytes, @nowIso, @nowIso
      )
      ON CONFLICT(project_id) DO UPDATE SET
        name = excluded.name,
        display_name = COALESCE(projects.display_name, excluded.display_name),
        description = COALESCE(excluded.description, projects.description),
        cwd = excluded.cwd,
        git_root = excluded.git_root,
        repo_name = excluded.repo_name,
        branch = excluded.branch,
        head_sha = excluded.head_sha,
        is_dirty = excluded.is_dirty,
        worktree_path = excluded.worktree_path,
        icon_hash = COALESCE(excluded.icon_hash, projects.icon_hash),
        icon_data_url = COALESCE(excluded.icon_data_url, projects.icon_data_url),
        icon_media_type = COALESCE(excluded.icon_media_type, projects.icon_media_type),
        icon_size_bytes = COALESCE(excluded.icon_size_bytes, projects.icon_size_bytes),
        updated_at = excluded.updated_at
    `);
    const insertSession = this.db.prepare(`
      INSERT INTO sessions (
        session_id, machine_id, project_id, title, cwd, branch, worktree_path, semantic_state,
        last_heartbeat_at, connected_at, disconnected_at, shutdown_at, agent_session_id,
        agent_session_path, leaf_id, created_at, updated_at
      ) VALUES (
        @sessionId, @machineId, @projectId, @title, @cwd, @branch, @worktreePath, @semanticState,
        @nowIso, @nowIso, NULL, NULL, @agentSessionId, @agentSessionPath, @leafId, @nowIso, @nowIso
      )
      ON CONFLICT(session_id) DO UPDATE SET
        machine_id = excluded.machine_id,
        project_id = excluded.project_id,
        title = excluded.title,
        cwd = excluded.cwd,
        branch = excluded.branch,
        worktree_path = excluded.worktree_path,
        semantic_state = excluded.semantic_state,
        last_heartbeat_at = excluded.last_heartbeat_at,
        connected_at = excluded.connected_at,
        disconnected_at = NULL,
        shutdown_at = NULL,
        agent_session_id = excluded.agent_session_id,
        agent_session_path = excluded.agent_session_path,
        leaf_id = excluded.leaf_id,
        updated_at = excluded.updated_at
    `);

    const transaction = this.db.transaction(() => {
      insertMachine.run({ ...payload.machine, displayName: payload.machine.displayName ?? null, nowIso });
      insertProject.run({
        ...payload.project,
        displayName: payload.project.displayName ?? null,
        description: payload.project.description ?? null,
        gitRoot: payload.project.gitRoot ?? null,
        repoName: payload.project.repoName ?? null,
        branch: payload.project.branch ?? null,
        headSha: payload.project.headSha ?? null,
        isDirty: payload.project.isDirty == null ? null : payload.project.isDirty ? 1 : 0,
        worktreePath: payload.project.worktreePath ?? null,
        iconHash: payload.project.icon?.hash ?? null,
        iconDataUrl: payload.project.icon?.dataUrl ?? null,
        iconMediaType: payload.project.icon?.mediaType ?? null,
        iconSizeBytes: payload.project.icon?.sizeBytes ?? null,
        nowIso
      });
      insertSession.run({
        ...payload.session,
        title: payload.session.title ?? null,
        branch: payload.session.branch ?? payload.project.branch ?? null,
        worktreePath: payload.session.worktreePath ?? payload.project.worktreePath ?? null,
        semanticState: payload.session.semanticState,
        machineId: payload.machine.machineId,
        projectId: payload.project.projectId,
        agentSessionId: payload.session.agentSessionId ?? null,
        agentSessionPath: payload.session.agentSessionPath ?? null,
        leafId: payload.session.leafId ?? null,
        nowIso
      });
    });

    transaction();
    this.activeConnections.set(payload.session.sessionId, connectionId);
  }

  heartbeat(connectionId: string, sessionId: string, semanticState?: SemanticState): void {
    if (this.closed) return;
    const nowIso = new Date(this.now()).toISOString();
    const currentConnection = this.activeConnections.get(sessionId);
    if (currentConnection !== connectionId && currentConnection !== undefined) return;
    this.activeConnections.set(sessionId, connectionId);

    const changes = this.db
      .prepare(
        `UPDATE sessions
         SET last_heartbeat_at = @nowIso,
             semantic_state = COALESCE(@semanticState, semantic_state),
             disconnected_at = NULL,
             shutdown_at = NULL,
             updated_at = @nowIso
         WHERE session_id = @sessionId`
      )
      .run({ sessionId, semanticState: semanticState ?? null, nowIso }).changes;

    if (changes === 0) {
      this.activeConnections.delete(sessionId);
    }
  }

  updateSession(payload: SessionUpdatePayload): void {
    if (this.closed) return;
    const nowIso = new Date(this.now()).toISOString();
    this.db
      .prepare(
        `UPDATE sessions
         SET title = COALESCE(@title, title),
             cwd = COALESCE(@cwd, cwd),
             branch = COALESCE(@branch, branch),
             worktree_path = COALESCE(@worktreePath, worktree_path),
             semantic_state = COALESCE(@semanticState, semantic_state),
             updated_at = @nowIso
         WHERE session_id = @sessionId`
      )
      .run({
        sessionId: payload.sessionId,
        title: payload.title ?? null,
        cwd: payload.cwd ?? null,
        branch: payload.branch ?? null,
        worktreePath: payload.worktreePath ?? null,
        semanticState: payload.semanticState ?? null,
        nowIso
      });
  }

  disconnectConnection(connectionId: string): void {
    if (this.closed) return;
    const nowIso = new Date(this.now()).toISOString();
    const sessionIds = [...this.activeConnections.entries()]
      .filter(([, activeConnectionId]) => activeConnectionId === connectionId)
      .map(([sessionId]) => sessionId);

    if (sessionIds.length === 0) return;

    const statement = this.db.prepare(
      `UPDATE sessions SET disconnected_at = @nowIso, updated_at = @nowIso WHERE session_id = @sessionId`
    );
    const transaction = this.db.transaction(() => {
      for (const sessionId of sessionIds) {
        this.activeConnections.delete(sessionId);
        statement.run({ sessionId, nowIso });
      }
    });
    transaction();
  }

  renameMachine(machineId: string, displayName: string): void {
    if (this.closed) return;
    const nowIso = new Date(this.now()).toISOString();
    const changes = this.db
      .prepare(`UPDATE machines SET display_name = @displayName, updated_at = @nowIso WHERE machine_id = @machineId`)
      .run({ machineId, displayName, nowIso }).changes;
    if (changes === 0) throw new SessionStoreError("machine_not_found", `Machine not found: ${machineId}`);
  }

  renameProject(projectId: string, displayName: string): void {
    if (this.closed) return;
    const nowIso = new Date(this.now()).toISOString();
    const changes = this.db
      .prepare(`UPDATE projects SET display_name = @displayName, updated_at = @nowIso WHERE project_id = @projectId`)
      .run({ projectId, displayName, nowIso }).changes;
    if (changes === 0) throw new SessionStoreError("project_not_found", `Project not found: ${projectId}`);
  }

  shutdown(sessionId: string): void {
    if (this.closed) return;
    const nowIso = new Date(this.now()).toISOString();
    this.activeConnections.delete(sessionId);
    this.db
      .prepare(
        `UPDATE sessions
         SET shutdown_at = @nowIso, disconnected_at = @nowIso, updated_at = @nowIso
         WHERE session_id = @sessionId`
      )
      .run({ sessionId, nowIso });
  }

  snapshot(): StateSnapshot {
    if (this.closed) return { sessions: [], requests: [], timestamp: new Date(this.now()).toISOString() };
    const nowMs = this.now();
    const visibleCutoffMs = nowMs - this.hideOfflineAfterMs;
    const rows = this.db
      .prepare(
        `SELECT
          sessions.session_id,
          sessions.machine_id,
          machines.hostname,
          machines.display_name,
          sessions.project_id,
          projects.name AS project_name,
          projects.display_name AS project_display_name,
          projects.description AS project_description,
          projects.git_root,
          projects.repo_name,
          projects.head_sha,
          projects.is_dirty,
          projects.icon_hash,
          projects.icon_data_url,
          projects.icon_media_type,
          projects.icon_size_bytes,
          sessions.title,
          sessions.cwd,
          sessions.branch,
          sessions.worktree_path,
          sessions.semantic_state,
          sessions.last_heartbeat_at,
          sessions.connected_at,
          sessions.disconnected_at,
          sessions.shutdown_at,
          sessions.updated_at,
          EXISTS (
            SELECT 1 FROM ask_requests
            WHERE ask_requests.session_id = sessions.session_id AND ask_requests.status = 'pending'
          ) AS has_pending_question
        FROM sessions
        JOIN machines ON machines.machine_id = sessions.machine_id
        JOIN projects ON projects.project_id = sessions.project_id
        ORDER BY sessions.updated_at DESC`
      )
      .all() as SessionRow[];

    // Derive presence before applying age-based visibility. This prevents a
    // short hide window from hiding live or stale sessions whose heartbeat is
    // older than the configured window.
    const sessions = rows
      .map((row) => ({ row, snapshot: this.toSnapshot(row) }))
      .filter(({ row, snapshot }) =>
        snapshot.presence !== "offline" ||
        row.has_pending_question === 1 ||
        this.offlineSinceMs(row) >= visibleCutoffMs
      )
      .map(({ snapshot }) => snapshot);
    return { sessions, requests: [], timestamp: new Date(nowMs).toISOString() };
  }

  /**
   * Deletes sessions that have been offline for longer than the retention
   * window. Sessions still referenced by any ask request (pending or kept as
   * history) are preserved; they become eligible once history pruning removes
   * those requests. Machines and projects left without sessions are swept too.
   */
  pruneOfflineSessions(): number {
    if (this.closed) return 0;
    const cutoffIso = new Date(this.now() - this.retentionMs).toISOString();
    const candidates = this.db
      .prepare(
        `SELECT session_id, last_heartbeat_at, connected_at, disconnected_at, shutdown_at, updated_at
         FROM sessions
         WHERE ${OFFLINE_SINCE_SQL} < @cutoffIso
           AND NOT EXISTS (
             SELECT 1 FROM ask_requests WHERE ask_requests.session_id = sessions.session_id
           )`
      )
      .all({ cutoffIso }) as SessionPresenceRow[];
    const sessionIds = candidates
      .filter((row) => this.derivePresence(row) === "offline")
      .map((row) => row.session_id);
    if (sessionIds.length === 0) return 0;

    const deleteSession = this.db.prepare("DELETE FROM sessions WHERE session_id = @sessionId");
    let pruned = 0;
    const transaction = this.db.transaction(() => {
      for (const sessionId of sessionIds) {
        pruned += deleteSession.run({ sessionId }).changes;
        this.activeConnections.delete(sessionId);
      }
      this.db
        .prepare(
          `DELETE FROM machines
           WHERE NOT EXISTS (SELECT 1 FROM sessions WHERE sessions.machine_id = machines.machine_id)`
        )
        .run();
      this.db
        .prepare(
          `DELETE FROM projects
           WHERE NOT EXISTS (SELECT 1 FROM sessions WHERE sessions.project_id = projects.project_id)`
        )
        .run();
    });
    transaction();
    return pruned;
  }

  private toSnapshot(row: SessionRow): SessionSnapshot {
    return {
      sessionId: row.session_id,
      title: row.title ?? undefined,
      machineId: row.machine_id,
      machineName: row.display_name ?? row.hostname,
      hostname: row.hostname,
      projectId: row.project_id,
      projectName: row.project_display_name ?? row.project_name,
      projectDetectedName: row.project_name,
      projectDescription: row.project_description ?? undefined,
      projectIcon: row.icon_hash && row.icon_data_url
        ? ProjectIconSchema.parse({
            hash: row.icon_hash,
            dataUrl: row.icon_data_url,
            mediaType: row.icon_media_type ?? undefined,
            sizeBytes: row.icon_size_bytes ?? undefined
          })
        : undefined,
      cwd: row.cwd,
      gitRoot: row.git_root ?? undefined,
      repoName: row.repo_name ?? undefined,
      branch: row.branch ?? undefined,
      headSha: row.head_sha ?? undefined,
      isDirty: row.is_dirty == null ? undefined : row.is_dirty === 1,
      worktreePath: row.worktree_path ?? undefined,
      semanticState: row.semantic_state,
      presence: this.derivePresence(row),
      lastHeartbeatAt: row.last_heartbeat_at ?? undefined,
      connectedAt: row.connected_at ?? undefined,
      disconnectedAt: row.disconnected_at ?? undefined,
      updatedAt: row.updated_at
    };
  }

  private offlineSinceMs(row: SessionPresenceRow): number {
    return Date.parse(
      row.disconnected_at ?? row.shutdown_at ?? row.last_heartbeat_at ?? row.updated_at
    );
  }

  private derivePresence(row: SessionPresenceRow): PresenceState {
    if (row.shutdown_at || row.disconnected_at || !this.activeConnections.has(row.session_id)) {
      return "offline";
    }

    const heartbeatMs = row.last_heartbeat_at ? Date.parse(row.last_heartbeat_at) : 0;
    const ageMs = this.now() - heartbeatMs;
    if (ageMs > this.presenceOptions.offlineAfterMs) return "offline";
    if (ageMs > this.presenceOptions.staleAfterMs) return "stale";
    return "live";
  }
}

export class SessionStoreError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "SessionStoreError";
  }
}
