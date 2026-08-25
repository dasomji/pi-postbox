import { afterEach, describe, expect, it } from "vitest";
import { openPostboxDatabase, type SqliteDatabase } from "../src/db/database.js";
import { RequestStore } from "../src/services/requestStore.js";
import { SessionStore } from "../src/services/sessionStore.js";

const OWNER = { harness: "pi", ownerId: "agent" };
const databases: SqliteDatabase[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));

function setup() {
  const now = Date.parse("2026-08-15T12:00:00.000Z");
  const db = openPostboxDatabase(":memory:");
  databases.push(db);
  const sessions = new SessionStore(db, () => now, { staleAfterMs: 1_000, offlineAfterMs: 2_000 });
  sessions.register("connection", {
    machine: { machineId: "machine", hostname: "host" },
    project: { projectId: "project", name: "repo", cwd: "/repo" },
    session: { sessionId: "session", cwd: "/repo", semanticState: "working", owner: OWNER }
  });
  const store = new RequestStore(db, () => now);
  const create = (questionId: string) => store.create({
    requestId: questionId,
    sessionId: "session",
    mode: "single",
    question: { prompt: `${questionId}?`, ambiguity: "Test ambiguity." },
    options: [{ value: "yes", label: "Yes" }],

  });
  return { db, store, create };
}

describe("human Answers versus lifecycle-only resolutions", () => {
  it("exposes Answer metadata only for answered Questions and returns every terminal state immediately", () => {
    const { db, store, create } = setup();
    for (const id of ["answered", "cancelled", "expired", "superseded", "replacement"]) create(id);

    store.answer("answered", { expectedRevision: 1, selectedValues: ["yes"] });
    store.cancel("cancelled", { note: "No longer needed" });
    db.prepare("UPDATE questions SET expires_at = '2000-01-01T00:00:00.000Z' WHERE question_id = 'expired'").run();
    store.expireDue();
    store.updateQuestion("superseded", OWNER, {
      action: "supersede",
      expectedRevision: 1,
      expectedOwnerRevision: 1,
      replacementQuestionId: "replacement"
    });

    const details = Object.fromEntries(store.getQuestions({
      questionIds: ["answered", "cancelled", "expired", "superseded"],
      view: "full"
    }).map((detail: Record<string, unknown>) => [detail.questionId, detail]));
    expect(details.answered).toMatchObject({ status: "answered", answerId: expect.any(String), answerRead: false });
    for (const status of ["cancelled", "expired", "superseded"] as const) {
      expect(details[status]).toMatchObject({ status });
      expect(details[status]).not.toHaveProperty("answerId");
      expect(details[status]).not.toHaveProperty("answerRead");
      expect(store.get(status)).not.toHaveProperty("answerId");
      expect(store.get(status)).not.toHaveProperty("answerRead");
      expect(store.listQuestionStatus({
        caller: { owner: OWNER, repository: "", worktree: "", feature: "" },
        global: true,
        status,
        includeTerminal: true
      })).toEqual([{ questionId: status, status }]);
    }
    const discovery = {
      caller: { owner: OWNER, repository: "", worktree: "", feature: "" },
      global: true,
      includeTerminal: true
    };
    expect(store.listQuestionStatus({ ...discovery, readState: "unread" }))
      .toEqual([{ questionId: "answered", status: "answered", answerId: expect.any(String), answerRead: false }]);
    expect(store.listQuestionStatus({ ...discovery, readState: "read" })).toEqual([]);
    expect(store.listQuestionStatus({ ...discovery, status: "cancelled", readState: "unread" })).toEqual([]);
    expect(store.listQuestionStatus(discovery).map((question) => question.questionId)).toEqual([
      "answered", "cancelled", "expired", "replacement", "superseded"
    ]);

    expect(store.getAnswer("answered", OWNER)).toEqual({
      questionId: "answered",
      answerId: expect.any(String),
      answer: ["yes"]
    });
    const lifecycle = {
      cancelled: store.getAnswer("cancelled", OWNER),
      expired: store.getAnswer("expired", OWNER),
      superseded: store.getAnswer("superseded", OWNER)
    };
    expect(lifecycle.cancelled).toMatchObject({
      type: "lifecycle",
      status: "cancelled",
      questionId: "cancelled",
      note: "No longer needed",
      resolvedAt: expect.any(String)
    });
    expect(lifecycle.expired).toMatchObject({
      type: "lifecycle",
      status: "expired",
      questionId: "expired",
      note: expect.any(String),
      resolvedAt: expect.any(String)
    });
    expect(lifecycle.superseded).toMatchObject({
      type: "lifecycle",
      status: "superseded",
      questionId: "superseded",
      replacementQuestionId: "replacement",
      resolvedAt: expect.any(String)
    });
    for (const result of Object.values(lifecycle)) {
      expect(result).not.toHaveProperty("answerId");
      expect(result).not.toHaveProperty("answer");
      expect(result).not.toHaveProperty("alreadyRead");
      expect(result).not.toHaveProperty("firstRead");
      expect(result).not.toHaveProperty("rationale");
    }

    const forensic = store.getQuestions({ questionIds: ["cancelled", "expired", "superseded"], view: "full" });
    expect(forensic[0]).toMatchObject({
      resolution: { kind: "lifecycle", status: "cancelled", note: "No longer needed", resolvedAt: expect.any(String) }
    });
    expect(forensic[1]).toMatchObject({
      resolution: { kind: "lifecycle", status: "expired", note: expect.any(String), resolvedAt: expect.any(String) }
    });
    expect(forensic[2]).toMatchObject({
      resolution: { kind: "lifecycle", status: "superseded", replacementQuestionId: "replacement", resolvedAt: expect.any(String) }
    });
    expect(JSON.stringify(forensic)).not.toContain("rationale");
  });
});
