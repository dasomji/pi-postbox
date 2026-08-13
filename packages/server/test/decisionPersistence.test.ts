import Database from "better-sqlite3";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openPostboxDatabase, type SqliteDatabase } from "../src/db/database.js";
import { RequestStore, RequestStoreError } from "../src/services/requestStore.js";
import { SessionStore } from "../src/services/sessionStore.js";

const directories: string[] = [];
const databases: SqliteDatabase[] = [];

afterEach(async () => {
  for (const db of databases.splice(0)) db.close();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function tableColumns(db: SqliteDatabase, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(({ name }) => name);
}

describe("durable decision compatibility migration", () => {
  it("adds owners, questions, and separately identified answers beside legacy requests", () => {
    const db = openPostboxDatabase(":memory:");
    databases.push(db);

    expect(tableColumns(db, "owners")).toEqual(expect.arrayContaining([
      "harness", "owner_id", "harness_session_id", "parent_owner_id", "root_owner_id", "depth", "path", "task_label"
    ]));
    expect(tableColumns(db, "questions")).toEqual(expect.arrayContaining([
      "question_id", "creator_harness", "creator_owner_id", "owner_harness", "owner_owner_id", "revision", "created_at", "updated_at"
    ]));
    expect(tableColumns(db, "answers")).toEqual(expect.arrayContaining([
      "answer_id", "question_id", "question_revision", "created_at"
    ]));
    expect(tableColumns(db, "ask_requests")).toContain("request_id");
    expect(tableColumns(db, "sessions")).toContain("session_id");
  });

  it("persists complete Question and Answer decisions while keeping sibling owners distinct", () => {
    const now = Date.parse("2026-08-13T00:00:00.000Z");
    const db = openPostboxDatabase(":memory:");
    databases.push(db);
    const sessions = new SessionStore(db, () => now, { staleAfterMs: 1_000, offlineAfterMs: 2_000 });
    const requests = new RequestStore(db, () => now);
    const shared = { machine: { machineId: "machine-1", hostname: "host" }, project: { projectId: "project-1", name: "repo", cwd: "/repo" } };
    const register = (sessionId: string, ownerId: string) => sessions.register(`connection-${ownerId}`, {
      ...shared,
      session: { sessionId, cwd: "/repo", semanticState: "working", owner: { harness: "pi", ownerId }, lineage: { harnessSessionId: "shared-control-session" } }
    });
    register("session-left", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    register("session-right", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    sessions.register("connection-left-reconnect", {
      ...shared,
      session: { sessionId: "session-left", cwd: "/repo", semanticState: "working", owner: { harness: "pi", ownerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } }
    });

    requests.create({
      requestId: "question-complete", sessionId: "session-left", mode: "single", urgency: "high",
      question: { prompt: "Which deployment?", context: "Release window", relevance: "Production", decisionImpact: "Chooses rollout" },
      options: [{ value: "blue", label: "Blue", description: "Blue pool", meaning: "Low risk", context: "Already warm" }],
      context: { codebaseContext: "Deployment service", problemContext: "Pick a production pool" }
    });

    expect(() => requests.proposeAnswer("question-complete", "session-right", { label: "Green" }))
      .toThrowError(expect.objectContaining({ code: "wrong_owner" } satisfies Partial<RequestStoreError>));
    requests.answer("question-complete", { selectedValues: ["blue"], note: "Proceed tonight", rationale: "Pool is warm" });

    expect(db.prepare("SELECT harness, owner_id, harness_session_id FROM owners ORDER BY owner_id").all()).toEqual([
      { harness: "pi", owner_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", harness_session_id: "shared-control-session" },
      { harness: "pi", owner_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", harness_session_id: "shared-control-session" }
    ]);
    expect(db.prepare(`SELECT question_json, options_json, context_json, status, creator_owner_id, owner_owner_id
      FROM questions WHERE question_id = ?`).get("question-complete")).toEqual({
      question_json: JSON.stringify({ prompt: "Which deployment?", context: "Release window", relevance: "Production", decisionImpact: "Chooses rollout" }),
      options_json: JSON.stringify([{ value: "blue", label: "Blue", description: "Blue pool", meaning: "Low risk", context: "Already warm" }]),
      context_json: JSON.stringify({ codebaseContext: "Deployment service", problemContext: "Pick a production pool" }),
      status: "answered",
      creator_owner_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      owner_owner_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    });
    expect(db.prepare(`SELECT question_id, question_revision, status, selected_values_json, note, rationale
      FROM answers WHERE question_id = ?`).get("question-complete")).toEqual({
      question_id: "question-complete", question_revision: 1, status: "answered", selected_values_json: '["blue"]', note: "Proceed tonight", rationale: "Pool is warm"
    });

    requests.create({
      requestId: "question-transferred", sessionId: "session-left", mode: "single", urgency: "normal",
      question: { prompt: "Transferred choice?" }, options: [{ value: "yes", label: "Yes" }],
      context: { codebaseContext: "Ownership", problemContext: "Successor must mutate" }
    });
    db.prepare(`UPDATE questions SET owner_owner_id = ?, revision = revision + 1 WHERE question_id = ?`)
      .run("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "question-transferred");
    expect(() => requests.proposeAnswer("question-transferred", "session-left", { label: "No" }))
      .toThrowError(expect.objectContaining({ code: "wrong_owner" } satisfies Partial<RequestStoreError>));
    expect(requests.proposeAnswer("question-transferred", "session-right", { label: "No" }).option.label).toBe("No");
  });

  it("makes creator immutable while permitting explicit ownership transfer and revision", () => {
    const db = openPostboxDatabase(":memory:");
    databases.push(db);
    const now = "2026-08-13T00:00:00.000Z";

    db.prepare("INSERT INTO owners (harness, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .run("claude-code", "agent-creator", now, now);
    db.prepare("INSERT INTO owners (harness, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .run("claude-code", "agent-successor", now, now);
    db.prepare(`INSERT INTO questions
      (question_id, creator_harness, creator_owner_id, owner_harness, owner_owner_id, revision, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("question-1", "claude-code", "agent-creator", "claude-code", "agent-creator", 1, now, now);

    expect(() => db.prepare("UPDATE questions SET creator_owner_id = ? WHERE question_id = ?")
      .run("agent-successor", "question-1")).toThrow();
    expect(db.prepare(`UPDATE questions
      SET owner_owner_id = ?, revision = revision + 1, updated_at = ? WHERE question_id = ?`)
      .run("agent-successor", "2026-08-13T00:01:00.000Z", "question-1").changes).toBe(1);
    expect(db.prepare("SELECT creator_owner_id, owner_owner_id, revision FROM questions WHERE question_id = ?")
      .get("question-1")).toEqual({ creator_owner_id: "agent-creator", owner_owner_id: "agent-successor", revision: 2 });
  });

  it("is idempotent and restart-safe when expanding an existing legacy database", async () => {
    const directory = await mkdtemp(join(tmpdir(), "postbox-decision-migration-"));
    directories.push(directory);
    const databasePath = join(directory, "postbox.sqlite");
    const legacy = new Database(databasePath);
    legacy.exec(`
      CREATE TABLE machines (machine_id TEXT PRIMARY KEY, hostname TEXT NOT NULL, display_name TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE projects (project_id TEXT PRIMARY KEY, name TEXT NOT NULL, display_name TEXT, description TEXT, cwd TEXT NOT NULL, git_root TEXT, repo_name TEXT, branch TEXT, head_sha TEXT, is_dirty INTEGER, worktree_path TEXT, icon_hash TEXT, icon_data_url TEXT, icon_media_type TEXT, icon_size_bytes INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE sessions (session_id TEXT PRIMARY KEY, machine_id TEXT NOT NULL REFERENCES machines(machine_id), project_id TEXT NOT NULL REFERENCES projects(project_id), title TEXT, cwd TEXT NOT NULL, branch TEXT, worktree_path TEXT, semantic_state TEXT NOT NULL, last_heartbeat_at TEXT, connected_at TEXT, disconnected_at TEXT, shutdown_at TEXT, agent_session_id TEXT, agent_session_path TEXT, leaf_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE ask_requests (request_id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(session_id), mode TEXT NOT NULL, urgency TEXT NOT NULL DEFAULT 'normal', prompt TEXT NOT NULL, question_json TEXT, options_json TEXT NOT NULL, context_json TEXT, fork_reference_json TEXT, status TEXT NOT NULL, selected_values_json TEXT, note TEXT, rationale TEXT, created_at TEXT NOT NULL, expires_at TEXT, resolved_at TEXT, updated_at TEXT NOT NULL);
      INSERT INTO machines VALUES ('legacy-machine', 'legacy-host', NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
      INSERT INTO projects (project_id, name, cwd, created_at, updated_at) VALUES ('legacy-project', 'legacy-repo', '/legacy', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
      INSERT INTO sessions (session_id, machine_id, project_id, cwd, semantic_state, created_at, updated_at) VALUES ('legacy-session', 'legacy-machine', 'legacy-project', '/legacy', 'idle', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
      INSERT INTO ask_requests (request_id, session_id, mode, prompt, options_json, status, selected_values_json, note, rationale, created_at, resolved_at, updated_at) VALUES ('legacy-request', 'legacy-session', 'single', 'Legacy choice?', '[{"value":"yes","label":"Yes"}]', 'answered', '["yes"]', 'old note', 'old rationale', '2026-01-01T00:00:00.000Z', '2026-01-01T00:01:00.000Z', '2026-01-01T00:01:00.000Z');
    `);
    legacy.close();

    const first = openPostboxDatabase(databasePath);
    first.close();
    const reopened = openPostboxDatabase(databasePath);
    databases.push(reopened);

    expect(reopened.prepare("SELECT prompt, status, selected_values_json FROM ask_requests WHERE request_id = 'legacy-request'").get())
      .toEqual({ prompt: "Legacy choice?", status: "answered", selected_values_json: '["yes"]' });
    expect(tableColumns(reopened, "owners")).toContain("owner_id");
    expect(tableColumns(reopened, "questions")).toContain("revision");
    expect(tableColumns(reopened, "answers")).toContain("answer_id");
    expect(reopened.prepare("SELECT status, question_json, options_json FROM questions WHERE question_id = 'legacy-request'").get())
      .toEqual({ status: "answered", question_json: '{"prompt":"Legacy choice?"}', options_json: '[{"value":"yes","label":"Yes"}]' });
    expect(reopened.prepare("SELECT status, selected_values_json, note, rationale FROM answers WHERE question_id = 'legacy-request'").get())
      .toEqual({ status: "answered", selected_values_json: '["yes"]', note: "old note", rationale: "old rationale" });
  });
});
