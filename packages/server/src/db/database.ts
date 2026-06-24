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
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ask_requests (
      request_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(session_id),
      mode TEXT NOT NULL,
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

    CREATE INDEX IF NOT EXISTS idx_ask_requests_status_created
      ON ask_requests(status, created_at);

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
  `);

  ensureColumn(db, "projects", "display_name", "TEXT");
  ensureColumn(db, "projects", "description", "TEXT");
  ensureColumn(db, "projects", "icon_hash", "TEXT");
  ensureColumn(db, "projects", "icon_data_url", "TEXT");
  ensureColumn(db, "projects", "icon_media_type", "TEXT");
  ensureColumn(db, "projects", "icon_size_bytes", "INTEGER");

  ensureColumn(db, "ask_requests", "question_json", "TEXT");
  ensureColumn(db, "ask_requests", "context_json", "TEXT");
  ensureColumn(db, "ask_requests", "fork_reference_json", "TEXT");
  ensureColumn(db, "ask_requests", "expires_at", "TEXT");
}

function ensureColumn(db: SqliteDatabase, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((existing) => existing.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
