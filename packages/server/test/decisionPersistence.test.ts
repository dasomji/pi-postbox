import Database from "better-sqlite3";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openPostboxDatabase, type SqliteDatabase } from "../src/db/database.js";

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
    legacy.exec("CREATE TABLE legacy_sentinel (id TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO legacy_sentinel VALUES ('one', 'preserved')");
    legacy.close();

    const first = openPostboxDatabase(databasePath);
    first.close();
    const reopened = openPostboxDatabase(databasePath);
    databases.push(reopened);

    expect(reopened.prepare("SELECT * FROM legacy_sentinel").get()).toEqual({ id: "one", value: "preserved" });
    expect(tableColumns(reopened, "owners")).toContain("owner_id");
    expect(tableColumns(reopened, "questions")).toContain("revision");
    expect(tableColumns(reopened, "answers")).toContain("answer_id");
  });
});
