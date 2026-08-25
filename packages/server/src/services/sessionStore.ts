import {
  POSTBOX_EXPLICIT_ID_MAX,
  POSTBOX_OWNER_PAGE_DEFAULT,
  POSTBOX_OWNER_PAGE_MAX,
  ProjectIconSchema
} from "@pi-postbox/protocol";
import type {
  FeatureIdentity,
  PostboxOwnerListScope,
  PostboxOwnerSummary,
  PresenceState,
  SemanticState,
  SessionRegisterPayload,
  SessionSnapshot,
  SessionUpdatePayload,
  StateSnapshot
} from "@pi-postbox/protocol";
import { randomUUID } from "node:crypto";
import type { QuestionChatSource } from "@pi-postbox/protocol";
import type { SqliteDatabase } from "../db/database.js";
import { decodePaginationCursor, encodePaginationCursor } from "./paginationCursor.js";

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
  repository_id: string | null; worktree_id: string | null; feature_id: string | null;
  repository_remote: string | null; repository_machine_id: string | null; common_directory: string | null;
  canonical_path: string | null; worktree_machine_id: string | null; feature_name: string | null;
}

export interface PresenceOptions {
  staleAfterMs: number;
  offlineAfterMs: number;
}

export interface PostboxOwnerListOptions {
  scope?: PostboxOwnerListScope;
  includeInactive?: boolean;
  cursor?: string;
  pageSize?: number;
}

export interface PostboxOwnerListPage {
  owners: PostboxOwnerSummary[];
  nextCursor?: string;
}

export interface SessionStoreOptions extends PresenceOptions {
  /** Offline sessions older than this are omitted from state snapshots. */
  hideOfflineAfterMs?: number;
  /** Offline sessions older than this are deleted, unless ask requests still reference them. */
  retentionMs?: number;
}

export interface PostboxOwnerStatus {
  owner: { harness: string; ownerId: string };
  presence: PresenceState;
  semanticState: SemanticState;
  lastHeartbeatAt: string | undefined;
  activeQuestionCount: number;
  unreadAnswerCount: number;
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

  ownerForSession(sessionId: string): { harness: string; ownerId: string } | undefined {
    const row = this.db.prepare("SELECT owner_harness, owner_id FROM sessions WHERE session_id = ?").get(sessionId) as
      { owner_harness: string | null; owner_id: string | null } | undefined;
    return row?.owner_harness && row.owner_id ? { harness: row.owner_harness, ownerId: row.owner_id } : undefined;
  }

  semanticStateForSession(sessionId: string): SemanticState | undefined {
    return (this.db.prepare("SELECT semantic_state FROM sessions WHERE session_id = ?").get(sessionId) as
      { semantic_state: SemanticState } | undefined)?.semantic_state;
  }

  presenceForOwner(owner: { harness: string; ownerId: string }): "live" | "stale" | "offline" {
    return this.getPostboxOwnerStatus([owner])[0]?.presence ?? "offline";
  }

  hasOfflineLease(owner: { harness: string; ownerId: string }): boolean {
    const cutoff = new Date(this.now() - this.presenceOptions.offlineAfterMs).toISOString();
    const live = this.db.prepare(`SELECT 1 FROM sessions WHERE owner_harness=? AND owner_id=?
      AND shutdown_at IS NULL AND disconnected_at IS NULL AND last_heartbeat_at > ? LIMIT 1`)
      .get(owner.harness, owner.ownerId, cutoff);
    return !live;
  }

  listPostboxOwners(sessionId: string, scope: PostboxOwnerListScope = "feature"): PostboxOwnerSummary[] {
    const owners: PostboxOwnerSummary[] = [];
    let cursor: string | undefined;
    do {
      const page = this.listPostboxOwnersPage(sessionId, {
        scope,
        pageSize: POSTBOX_OWNER_PAGE_DEFAULT,
        ...(cursor ? { cursor } : {})
      });
      owners.push(...page.owners);
      cursor = page.nextCursor;
    } while (cursor);
    return owners;
  }

  listPostboxOwnersPage(sessionId: string, options: PostboxOwnerListOptions = {}): PostboxOwnerListPage {
    const scope = options.scope ?? "feature";
    const pageSize = options.pageSize ?? POSTBOX_OWNER_PAGE_DEFAULT;
    if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > POSTBOX_OWNER_PAGE_MAX) {
      throw new SessionStoreError("invalid_page_size", `Owner discovery page size must be a positive integer and at most ${POSTBOX_OWNER_PAGE_MAX}`);
    }
    const grouping = this.db.prepare(`SELECT repository_id, worktree_id, feature_id
      FROM sessions WHERE session_id = ?`).get(sessionId) as {
        repository_id: string | null;
        worktree_id: string | null;
        feature_id: string | null;
      } | undefined;
    if (!grouping?.repository_id
      || (scope !== "repository" && !grouping.worktree_id)
      || (scope === "feature" && !grouping.feature_id)) {
      throw new SessionStoreError("scope_not_found", "Session has no owner discovery scope");
    }

    const sessionScopeClauses = ["s.repository_id = @repositoryId"];
    const questionScopeClauses = ["q.repository_id = @repositoryId"];
    const parameters: Record<string, string> = { repositoryId: grouping.repository_id };
    if (scope !== "repository") {
      sessionScopeClauses.push("s.worktree_id = @worktreeId");
      questionScopeClauses.push("q.worktree_id = @worktreeId");
      parameters.worktreeId = grouping.worktree_id!;
    }
    if (scope === "feature") {
      sessionScopeClauses.push("s.feature_id = @featureId");
      questionScopeClauses.push("q.feature_id = @featureId");
      parameters.featureId = grouping.feature_id!;
    }

    const scopeParameters = { ...parameters };
    const cursorQuery = {
      kind: "postbox-owners",
      scope,
      includeInactive: options.includeInactive ?? false,
      repositoryId: grouping.repository_id,
      worktreeId: grouping.worktree_id,
      featureId: grouping.feature_id
    };
    if (options.cursor) {
      try {
        const boundary = decodePaginationCursor(options.cursor, cursorQuery);
        if (!Array.isArray(boundary) || boundary.length !== 2
          || typeof boundary[0] !== "string" || typeof boundary[1] !== "string") throw new Error();
        sessionScopeClauses.push("(s.owner_harness > @cursorHarness OR (s.owner_harness = @cursorHarness AND s.owner_id > @cursorOwnerId))");
        parameters.cursorHarness = boundary[0];
        parameters.cursorOwnerId = boundary[1];
      } catch {
        throw new SessionStoreError("invalid_cursor", "Owner discovery cursor is invalid or belongs to another query");
      }
    }

    const ownerIdentities = this.db.prepare(`SELECT DISTINCT s.owner_harness AS harness, s.owner_id AS ownerId
      FROM sessions s
      WHERE s.owner_harness IS NOT NULL AND s.owner_id IS NOT NULL
        AND ${sessionScopeClauses.join(" AND ")}
      ORDER BY s.owner_harness, s.owner_id`).all(parameters) as Array<PostboxOwnerSummary["owner"]>;
    const sessionQuery = this.db.prepare(`SELECT s.session_id, s.last_heartbeat_at, s.connected_at,
        s.disconnected_at, s.shutdown_at, s.updated_at
      FROM sessions s
      WHERE s.owner_harness = @ownerHarness AND s.owner_id = @ownerId
        AND ${sessionScopeClauses.filter((clause) => !clause.includes("cursorHarness")).join(" AND ")}
      ORDER BY s.updated_at DESC`);
    const countsQuery = this.db.prepare(`SELECT
        SUM(CASE WHEN q.status = 'pending' THEN 1 ELSE 0 END) AS active_question_count,
        SUM(CASE WHEN q.status = 'answered' AND EXISTS (
          SELECT 1 FROM answers a WHERE a.question_id = q.question_id AND a.first_reader_harness IS NULL
        ) THEN 1 ELSE 0 END) AS unread_answer_count
      FROM questions q
      WHERE q.owner_harness = @ownerHarness AND q.owner_owner_id = @ownerId
        AND ${questionScopeClauses.join(" AND ")}`);

    const matching = ownerIdentities.map((owner): PostboxOwnerSummary => {
      const ownerParameters = { ...scopeParameters, ownerHarness: owner.harness, ownerId: owner.ownerId };
      const presence = (sessionQuery.all(ownerParameters) as SessionPresenceRow[])
        .map((row) => this.derivePresence(row))
        .sort((left, right) => this.presenceRank(right) - this.presenceRank(left))[0] ?? "offline";
      const counts = countsQuery.get(ownerParameters) as {
        active_question_count: number | null;
        unread_answer_count: number | null;
      };
      return {
        owner,
        presence,
        activeQuestionCount: counts.active_question_count ?? 0,
        unreadAnswerCount: counts.unread_answer_count ?? 0
      };
    }).filter((summary) => options.includeInactive
      || summary.presence !== "offline"
      || summary.activeQuestionCount > 0
      || summary.unreadAnswerCount > 0);
    const hasMore = matching.length > pageSize;
    const owners = matching.slice(0, pageSize);
    const last = owners.at(-1);
    return {
      owners,
      ...(hasMore && last
        ? { nextCursor: encodePaginationCursor(cursorQuery, [last.owner.harness, last.owner.ownerId]) }
        : {})
    };
  }

  getPostboxOwnerStatus(owners: ReadonlyArray<{ harness: string; ownerId: string }>): PostboxOwnerStatus[] {
    if (owners.length > POSTBOX_EXPLICIT_ID_MAX) {
      throw new SessionStoreError("too_many_owners", `At most ${POSTBOX_EXPLICIT_ID_MAX} owners may be inspected at once`);
    }
    const sessionQuery = this.db.prepare(`SELECT session_id, semantic_state, last_heartbeat_at, connected_at,
        disconnected_at, shutdown_at, updated_at
      FROM sessions WHERE owner_harness = ? AND owner_id = ?
      ORDER BY updated_at DESC`);
    const countsQuery = this.db.prepare(`SELECT
        SUM(CASE WHEN q.status = 'pending' THEN 1 ELSE 0 END) AS active_question_count,
        SUM(CASE WHEN a.answer_id IS NOT NULL AND a.first_reader_harness IS NULL THEN 1 ELSE 0 END) AS unread_answer_count
      FROM questions q LEFT JOIN answers a ON a.question_id = q.question_id
      WHERE q.owner_harness = ? AND q.owner_owner_id = ?`);
    return owners.map((owner) => {
      const ownerSessions = sessionQuery.all(owner.harness, owner.ownerId) as Array<SessionPresenceRow & {
        semantic_state: SemanticState;
      }>;
      const session = ownerSessions
        .map((row) => ({ row, presence: this.derivePresence(row) }))
        .sort((left, right) => this.presenceRank(right.presence) - this.presenceRank(left.presence))[0];
      const counts = countsQuery.get(owner.harness, owner.ownerId) as {
        active_question_count: number | null;
        unread_answer_count: number | null;
      };
      return {
        owner,
        presence: session?.presence ?? "offline",
        semanticState: session?.row.semantic_state ?? "unknown",
        lastHeartbeatAt: session?.row.last_heartbeat_at ?? undefined,
        activeQuestionCount: counts.active_question_count ?? 0,
        unreadAnswerCount: counts.unread_answer_count ?? 0
      };
    });
  }

  isConnectedNonWaitingOwner(sessionId: string, owner: { harness: string; ownerId: string }): boolean {
    if (!this.activeConnections.has(sessionId)) return false;
    const row = this.db.prepare(`SELECT owner_harness, owner_id, semantic_state FROM sessions WHERE session_id = ?`).get(sessionId) as
      { owner_harness: string | null; owner_id: string | null; semantic_state: SemanticState } | undefined;
    return row?.owner_harness === owner.harness && row.owner_id === owner.ownerId && !["blocked", "waiting_for_postbox"].includes(row.semantic_state);
  }

  isCurrentConnection(sessionId: string, connectionId: string): boolean {
    return this.activeConnections.get(sessionId) === connectionId;
  }

  groupingForSession(sessionId: string): { repositoryId: string; worktreeId: string; featureId: string } | undefined {
    return this.db.prepare("SELECT repository_id AS repositoryId, worktree_id AS worktreeId, feature_id AS featureId FROM sessions WHERE session_id = ?")
      .get(sessionId) as { repositoryId: string; worktreeId: string; featureId: string } | undefined;
  }

  selectFeature(sessionId: string, action: { action: "start"; name: string } | { action: "select" | "inherit"; featureId: string }): FeatureIdentity {
    const row = this.db.prepare("SELECT worktree_id FROM sessions WHERE session_id = ?").get(sessionId) as { worktree_id: string | null } | undefined;
    if (!row?.worktree_id) throw new SessionStoreError("worktree_not_found", "Session has no worktree identity");
    const featureId = action.action === "start" ? randomUUID() : action.featureId;
    const name = action.action === "start" ? action.name : undefined;
    const nowIso = new Date(this.now()).toISOString();
    if (action.action !== "start" && !this.db.prepare("SELECT 1 FROM features WHERE feature_id = ?").get(featureId)) {
      throw new SessionStoreError("feature_not_found", "Feature not found");
    }
    if (action.action === "start") this.db.prepare("INSERT INTO features (feature_id, name, created_at) VALUES (?, ?, ?)").run(featureId, name ?? null, nowIso);
    this.db.prepare("UPDATE worktrees SET active_feature_id = ? WHERE worktree_id = ?").run(featureId, row.worktree_id);
    this.db.prepare("UPDATE sessions SET feature_id = ?, updated_at = ? WHERE session_id = ?").run(featureId, nowIso, sessionId);
    return { featureId, name };
  }

  register(connectionId: string, payload: SessionRegisterPayload): FeatureIdentity | undefined {
    if (this.closed) return undefined;
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
        agent_session_path, leaf_id, owner_harness, owner_id, repository_id, worktree_id, feature_id, created_at, updated_at
      ) VALUES (
        @sessionId, @machineId, @projectId, @title, @cwd, @branch, @worktreePath, @semanticState,
        @nowIso, @nowIso, NULL, NULL, @agentSessionId, @agentSessionPath, @leafId, @ownerHarness, @ownerId, @repositoryId, @worktreeId, @featureId, @nowIso, @nowIso
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
        owner_harness = excluded.owner_harness,
        owner_id = excluded.owner_id,
        repository_id = excluded.repository_id,
        worktree_id = excluded.worktree_id,
        feature_id = excluded.feature_id,
        updated_at = excluded.updated_at
    `);

    let activeFeature: FeatureIdentity | undefined;
    const transaction = this.db.transaction(() => {
      const owner = payload.session.owner;
      const repository = payload.session.repository ?? payload.project.repository;
      const worktree = payload.session.worktree ?? payload.project.worktree;
      if (repository && worktree) {
        this.db.prepare(`INSERT INTO repositories (repository_id, remote, machine_id, common_directory) VALUES (?, ?, ?, ?)
          ON CONFLICT(repository_id) DO UPDATE SET remote=excluded.remote, machine_id=excluded.machine_id, common_directory=excluded.common_directory`)
          .run(repository.repositoryId, repository.remote ?? null, repository.machineId ?? null, repository.commonDirectory ?? null);
        const requested = payload.session.feature;
        const current = this.db.prepare("SELECT active_feature_id FROM worktrees WHERE worktree_id = ?").get(worktree.worktreeId) as { active_feature_id: string | null } | undefined;
        let featureId: string;
        let featureName: string | undefined;
        if (requested && "action" in requested) {
          if (requested.action === "start") { featureId = randomUUID(); featureName = requested.name; }
          else {
            featureId = requested.featureId;
            if (!this.db.prepare("SELECT 1 FROM features WHERE feature_id = ?").get(featureId)) throw new SessionStoreError("feature_not_found", "Feature not found");
          }
        } else if (requested) { featureId = requested.featureId; featureName = requested.name; }
        else featureId = current?.active_feature_id ?? randomUUID();
        if (!this.db.prepare("SELECT 1 FROM features WHERE feature_id = ?").get(featureId)) {
          this.db.prepare("INSERT INTO features (feature_id, name, created_at) VALUES (?, ?, ?)").run(featureId, featureName ?? null, nowIso);
        }
        const stored = this.db.prepare("SELECT name FROM features WHERE feature_id = ?").get(featureId) as { name: string | null };
        activeFeature = { featureId, name: stored.name ?? undefined };
        this.db.prepare(`INSERT INTO worktrees (worktree_id, machine_id, canonical_path, repository_id, active_feature_id) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(worktree_id) DO UPDATE SET machine_id=excluded.machine_id, canonical_path=excluded.canonical_path, repository_id=excluded.repository_id, active_feature_id=excluded.active_feature_id`)
          .run(worktree.worktreeId, worktree.machineId, worktree.path, repository.repositoryId, featureId);
      }
      if (owner) this.db.prepare(`INSERT INTO owners (
        harness, owner_id, harness_session_id, parent_owner_id, root_owner_id, depth, path, task_label, created_at, updated_at
      ) VALUES (@harness, @ownerId, @harnessSessionId, @parentOwnerId, @rootOwnerId, @depth, @path, @taskLabel, @nowIso, @nowIso)
      ON CONFLICT(harness, owner_id) DO UPDATE SET
        harness_session_id = COALESCE(excluded.harness_session_id, owners.harness_session_id),
        parent_owner_id = COALESCE(excluded.parent_owner_id, owners.parent_owner_id),
        root_owner_id = COALESCE(excluded.root_owner_id, owners.root_owner_id),
        depth = COALESCE(excluded.depth, owners.depth),
        path = COALESCE(excluded.path, owners.path),
        task_label = COALESCE(excluded.task_label, owners.task_label),
        updated_at = excluded.updated_at`).run({
          ...owner,
          harnessSessionId: payload.session.lineage?.harnessSessionId ?? null,
          parentOwnerId: payload.session.lineage?.parentOwnerId ?? null,
          rootOwnerId: payload.session.lineage?.rootOwnerId ?? null,
          depth: payload.session.lineage?.depth ?? null,
          path: payload.session.lineage?.path ?? null,
          taskLabel: payload.session.lineage?.taskLabel ?? null,
          nowIso
        });
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
        ownerHarness: owner?.harness ?? null,
        ownerId: owner?.ownerId ?? null,
        repositoryId: repository?.repositoryId ?? null,
        worktreeId: worktree?.worktreeId ?? null,
        featureId: activeFeature?.featureId ?? null,
        nowIso
      });
    });

    transaction();
    this.activeConnections.set(payload.session.sessionId, connectionId);
    return activeFeature;
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
               agent_session_path = COALESCE(@agentSessionPath, agent_session_path),
               leaf_id = COALESCE(@leafId, leaf_id),
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
        agentSessionPath: payload.agentSessionPath ?? null,
        leafId: payload.leafId ?? null,
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

  questionChatSource(sessionId: string): QuestionChatSource | undefined {
    const row = this.db
      .prepare("SELECT agent_session_path, leaf_id, cwd FROM sessions WHERE session_id = ?")
      .get(sessionId) as { agent_session_path: string | null; leaf_id: string | null; cwd: string } | undefined;
    if (!row?.agent_session_path || !row.leaf_id) return undefined;
    return { agentSessionPath: row.agent_session_path, leafId: row.leaf_id, cwd: row.cwd };
  }

  questionChatCwd(sessionId: string): string | undefined {
    const row = this.db.prepare("SELECT cwd FROM sessions WHERE session_id = ?").get(sessionId) as
      | { cwd: string }
      | undefined;
    return row?.cwd;
  }

  getQuestionChatSourceState(sessionId: string): "missing_path" | "missing_leaf" {
    const row = this.db
      .prepare("SELECT agent_session_path, leaf_id FROM sessions WHERE session_id = ?")
      .get(sessionId) as { agent_session_path: string | null; leaf_id: string | null } | undefined;
    return row?.agent_session_path && !row.leaf_id ? "missing_leaf" : "missing_path";
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
          sessions.repository_id, sessions.worktree_id, sessions.feature_id,
          repositories.remote AS repository_remote, repositories.machine_id AS repository_machine_id,
          repositories.common_directory, worktrees.canonical_path, worktrees.machine_id AS worktree_machine_id,
          features.name AS feature_name,
          EXISTS (
            SELECT 1 FROM questions
            WHERE questions.source_session_id = sessions.session_id AND questions.status = 'pending'
          ) AS has_pending_question
        FROM sessions
        JOIN machines ON machines.machine_id = sessions.machine_id
        JOIN projects ON projects.project_id = sessions.project_id
        LEFT JOIN repositories ON repositories.repository_id = sessions.repository_id
        LEFT JOIN worktrees ON worktrees.worktree_id = sessions.worktree_id
        LEFT JOIN features ON features.feature_id = sessions.feature_id
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

  /** Deletes only offline sessions which have never sourced a durable Question. */
  pruneOfflineSessions(): number {
    if (this.closed) return 0;
    const cutoffIso = new Date(this.now() - this.retentionMs).toISOString();
    const candidates = this.db
      .prepare(
        `SELECT session_id, last_heartbeat_at, connected_at, disconnected_at, shutdown_at, updated_at
         FROM sessions
         WHERE ${OFFLINE_SINCE_SQL} < @cutoffIso
           AND NOT EXISTS (
             SELECT 1 FROM questions WHERE questions.source_session_id = sessions.session_id
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
      updatedAt: row.updated_at,
      repository: row.repository_id ? { repositoryId: row.repository_id, remote: row.repository_remote ?? undefined,
        machineId: row.repository_machine_id ?? undefined, commonDirectory: row.common_directory ?? undefined } : undefined,
      worktree: row.worktree_id && row.worktree_machine_id && row.canonical_path
        ? { worktreeId: row.worktree_id, machineId: row.worktree_machine_id, path: row.canonical_path } : undefined,
      feature: row.feature_id ? { featureId: row.feature_id, name: row.feature_name ?? undefined } : undefined
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

  private presenceRank(presence: PresenceState): number {
    return presence === "live" ? 2 : presence === "stale" ? 1 : 0;
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
