import Database from "better-sqlite3";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";

export type SqliteDatabase = Database.Database;

export function openPostboxDatabase(databasePath: string): SqliteDatabase {
  if (databasePath !== ":memory:") {
    mkdirSync(dirname(databasePath), { recursive: true });
  }

  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  return db;
}

function runMigrations(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS machines (
      machine_id TEXT PRIMARY KEY,
      hostname TEXT NOT NULL,
      display_name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      project_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      display_name TEXT,
      description TEXT,
      cwd TEXT NOT NULL,
      git_root TEXT,
      repo_name TEXT,
      branch TEXT,
      head_sha TEXT,
      is_dirty INTEGER,
      worktree_path TEXT,
      icon_hash TEXT,
      icon_data_url TEXT,
      icon_media_type TEXT,
      icon_size_bytes INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      machine_id TEXT NOT NULL REFERENCES machines(machine_id),
      project_id TEXT NOT NULL REFERENCES projects(project_id),
      title TEXT,
      cwd TEXT NOT NULL,
      branch TEXT,
      worktree_path TEXT,
      semantic_state TEXT NOT NULL,
      last_heartbeat_at TEXT,
      connected_at TEXT,
      disconnected_at TEXT,
      shutdown_at TEXT,
      agent_session_id TEXT,
      agent_session_path TEXT,
      leaf_id TEXT,
      owner_harness TEXT,
      owner_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ask_requests (
      request_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(session_id),
      mode TEXT NOT NULL,
      urgency TEXT NOT NULL DEFAULT 'normal',
      prompt TEXT NOT NULL,
      question_json TEXT,
      options_json TEXT NOT NULL,
      context_json TEXT,
      fork_reference_json TEXT,
      status TEXT NOT NULL,
      selected_values_json TEXT,
      note TEXT,
      rationale TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT,
      resolved_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS owners (
      harness TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      harness_session_id TEXT,
      parent_owner_id TEXT,
      root_owner_id TEXT,
      depth INTEGER CHECK (depth IS NULL OR depth >= 0),
      path TEXT,
      task_label TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (harness, owner_id)
    );

    CREATE TABLE IF NOT EXISTS questions (
      question_id TEXT PRIMARY KEY,
      creator_harness TEXT NOT NULL,
      creator_owner_id TEXT NOT NULL,
      owner_harness TEXT NOT NULL,
      owner_owner_id TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
      legacy_request_id TEXT UNIQUE,
      mode TEXT NOT NULL DEFAULT 'single',
      urgency TEXT NOT NULL DEFAULT 'normal',
      question_json TEXT NOT NULL DEFAULT '{}',
      options_json TEXT NOT NULL DEFAULT '[]',
      context_json TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      expires_at TEXT,
      resolved_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (creator_harness, creator_owner_id) REFERENCES owners(harness, owner_id),
      FOREIGN KEY (owner_harness, owner_owner_id) REFERENCES owners(harness, owner_id)
    );

    CREATE TABLE IF NOT EXISTS answers (
      answer_id TEXT PRIMARY KEY,
      question_id TEXT NOT NULL REFERENCES questions(question_id),
      question_revision INTEGER NOT NULL CHECK (question_revision >= 1),
      status TEXT NOT NULL DEFAULT 'answered',
      selected_values_json TEXT NOT NULL DEFAULT '[]',
      note TEXT,
      rationale TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TRIGGER IF NOT EXISTS questions_creator_immutable
      BEFORE UPDATE OF creator_harness, creator_owner_id ON questions
      WHEN NEW.creator_harness IS NOT OLD.creator_harness
        OR NEW.creator_owner_id IS NOT OLD.creator_owner_id
      BEGIN
        SELECT RAISE(ABORT, 'question creator is immutable');
      END;

    CREATE INDEX IF NOT EXISTS idx_ask_requests_status_created
      ON ask_requests(status, created_at);

    CREATE INDEX IF NOT EXISTS idx_ask_requests_session_status
      ON ask_requests(session_id, status);

    CREATE INDEX IF NOT EXISTS idx_sessions_machine
      ON sessions(machine_id);

    CREATE INDEX IF NOT EXISTS idx_sessions_project
      ON sessions(project_id);

    CREATE TABLE IF NOT EXISTS push_vapid_keys (
      id TEXT PRIMARY KEY CHECK (id = 'default'),
      public_key TEXT NOT NULL,
      private_key TEXT NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('configured', 'generated')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint TEXT PRIMARY KEY,
      expiration_time INTEGER,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      subscription_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS push_fcm_tokens (
      token TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  ensureColumn(db, "projects", "display_name", "TEXT");
  ensureColumn(db, "projects", "description", "TEXT");
  ensureColumn(db, "projects", "icon_hash", "TEXT");
  ensureColumn(db, "projects", "icon_data_url", "TEXT");
  ensureColumn(db, "projects", "icon_media_type", "TEXT");
  ensureColumn(db, "projects", "icon_size_bytes", "INTEGER");

  ensureColumn(db, "ask_requests", "question_json", "TEXT");
  ensureColumn(db, "ask_requests", "urgency", "TEXT NOT NULL DEFAULT 'normal'");
  ensureColumn(db, "ask_requests", "context_json", "TEXT");
  ensureColumn(db, "ask_requests", "fork_reference_json", "TEXT");
  ensureColumn(db, "ask_requests", "expires_at", "TEXT");
  ensureColumn(db, "sessions", "owner_harness", "TEXT");
  ensureColumn(db, "sessions", "owner_id", "TEXT");
  ensureColumn(db, "questions", "legacy_request_id", "TEXT");
  ensureColumn(db, "questions", "mode", "TEXT NOT NULL DEFAULT 'single'");
  ensureColumn(db, "questions", "urgency", "TEXT NOT NULL DEFAULT 'normal'");
  ensureColumn(db, "questions", "question_json", "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn(db, "questions", "options_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "questions", "context_json", "TEXT");
  ensureColumn(db, "questions", "status", "TEXT NOT NULL DEFAULT 'pending'");
  ensureColumn(db, "questions", "expires_at", "TEXT");
  ensureColumn(db, "questions", "resolved_at", "TEXT");
  ensureColumn(db, "answers", "status", "TEXT NOT NULL DEFAULT 'answered'");
  ensureColumn(db, "answers", "selected_values_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "answers", "note", "TEXT");
  ensureColumn(db, "answers", "rationale", "TEXT");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_questions_legacy_request ON questions(legacy_request_id)");
}

function ensureColumn(db: SqliteDatabase, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((existing) => existing.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
