import { HistoryRecordSchema, ProjectIconSchema, type HistoryRecord } from "@pi-postbox/protocol";
import type { SqliteDatabase } from "../db/database.js";
import { RequestStore } from "./requestStore.js";

interface HistoryRow {
  request_id: string;
  session_id: string;
  session_title: string | null;
  session_cwd: string;
  session_branch: string | null;
  session_worktree_path: string | null;
  machine_id: string;
  hostname: string;
  machine_display_name: string | null;
  project_id: string;
  project_name: string;
  project_display_name: string | null;
  project_description: string | null;
  project_cwd: string;
  git_root: string | null;
  repo_name: string | null;
  project_branch: string | null;
  head_sha: string | null;
  is_dirty: number | null;
  project_worktree_path: string | null;
  icon_hash: string | null;
  icon_data_url: string | null;
  icon_media_type: string | null;
  icon_size_bytes: number | null;
}

const TERMINAL_STATUSES = "'answered','cancelled','expired'";

export class HistoryService {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly requestStore: RequestStore,
    private readonly now: () => number
  ) {}

  list(): HistoryRecord[] {
    const rows = this.db
      .prepare(
        `SELECT
          questions.question_id AS request_id,
          sessions.session_id,
          sessions.title AS session_title,
          sessions.cwd AS session_cwd,
          sessions.branch AS session_branch,
          sessions.worktree_path AS session_worktree_path,
          machines.machine_id,
          machines.hostname,
          machines.display_name AS machine_display_name,
          projects.project_id,
          projects.name AS project_name,
          projects.display_name AS project_display_name,
          projects.description AS project_description,
          projects.cwd AS project_cwd,
          projects.git_root,
          projects.repo_name,
          projects.branch AS project_branch,
          projects.head_sha,
          projects.is_dirty,
          projects.worktree_path AS project_worktree_path,
          projects.icon_hash,
          projects.icon_data_url,
          projects.icon_media_type,
          projects.icon_size_bytes
        FROM questions
        JOIN sessions ON sessions.session_id = questions.source_session_id
        JOIN machines ON machines.machine_id = sessions.machine_id
        JOIN projects ON projects.project_id = sessions.project_id
        WHERE questions.status IN (${TERMINAL_STATUSES})
        ORDER BY questions.resolved_at DESC, questions.created_at DESC`
      )
      .all() as HistoryRow[];

    return rows.map((row) => this.toRecord(row));
  }

  private toRecord(row: HistoryRow): HistoryRecord {
    const request = this.requestStore.get(row.request_id);
    if (!request) throw new Error(`History request missing from request store: ${row.request_id}`);

    return HistoryRecordSchema.parse({
      request,
      session: {
        sessionId: row.session_id,
        title: row.session_title ?? undefined,
        cwd: row.session_cwd,
        branch: row.session_branch ?? undefined,
        worktreePath: row.session_worktree_path ?? undefined,
        machine: {
          machineId: row.machine_id,
          machineName: row.machine_display_name ?? row.hostname,
          hostname: row.hostname
        },
        project: {
          projectId: row.project_id,
          projectName: row.project_display_name ?? row.project_name,
          projectDetectedName: row.project_name,
          projectDescription: row.project_description ?? undefined,
          cwd: row.project_cwd,
          gitRoot: row.git_root ?? undefined,
          repoName: row.repo_name ?? undefined,
          branch: row.project_branch ?? undefined,
          headSha: row.head_sha ?? undefined,
          isDirty: row.is_dirty == null ? undefined : row.is_dirty === 1,
          worktreePath: row.project_worktree_path ?? undefined,
          icon: row.icon_hash && row.icon_data_url
            ? ProjectIconSchema.parse({
                hash: row.icon_hash,
                dataUrl: row.icon_data_url,
                mediaType: row.icon_media_type ?? undefined,
                sizeBytes: row.icon_size_bytes ?? undefined
              })
            : undefined
        }
      }
    });
  }
}
