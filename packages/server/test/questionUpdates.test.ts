import { afterEach, describe, expect, it } from "vitest";
import { openPostboxDatabase, type SqliteDatabase } from "../src/db/database.js";
import { RequestStore, RequestStoreError } from "../src/services/requestStore.js";
import { SessionStore } from "../src/services/sessionStore.js";

const databases: SqliteDatabase[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));

function setup() {
  const db = openPostboxDatabase(":memory:"); databases.push(db);
  let now = Date.parse("2026-08-13T12:00:00.000Z");
  const sessions = new SessionStore(db, () => now, { staleAfterMs: 1_000, offlineAfterMs: 2_000 });
  sessions.register("connection", { machine: { machineId: "machine", hostname: "host" }, project: { projectId: "project", name: "repo", cwd: "/repo" },
    session: { sessionId: "session", cwd: "/repo", semanticState: "working", owner: { harness: "pi", ownerId: "agent" } } });
  const store = new RequestStore(db, () => now) as any;
  const create = (id: string, parentQuestionId?: string) => store.create({ requestId: id, sessionId: "session", mode: "single",
    question: { prompt: `${id}?` }, options: [{ value: "yes", label: "Yes" }], context: { codebaseContext: "Postbox", problemContext: "Keep Question accurate" }, parentQuestionId });
  return { db, sessions, store, create, tick: () => { now += 1_000; } };
}

describe("immutable Question updates", () => {
  it("appends revisions under a stable ID and atomically rejects stale agent and browser writes", () => {
    const { store, create, tick } = setup(); create("question"); tick();
    expect(store.updateQuestion("question", { harness: "pi", ownerId: "agent" }, {
      action: "revise", expectedRevision: 1, question: { prompt: "Updated question?" }
    })).toMatchObject({ questionId: "question", revision: 2, question: { prompt: "Updated question?" } });
    expect(() => store.updateQuestion("question", { harness: "pi", ownerId: "agent" }, {
      action: "cancel", expectedRevision: 1, rationale: "stale"
    })).toThrowError(expect.objectContaining({ code: "stale_revision" } satisfies Partial<RequestStoreError>));
    expect(() => store.answer("question", { expectedRevision: 1, selectedValues: ["yes"] })).toThrowError(expect.objectContaining({ code: "stale_revision" }));
    expect(store.get("question")).toMatchObject({ requestId: "question", status: "pending" });
  });

  it("makes every terminal state immutable and keeps a traceable replacement link", () => {
    const terminalActions = ["cancel", "supersede"] as const;
    for (const action of terminalActions) {
      const { store, create } = setup(); create("question"); if (action === "supersede") create("replacement");
      const terminal = store.updateQuestion("question", { harness: "pi", ownerId: "agent" }, action === "cancel"
        ? { action, expectedRevision: 1, rationale: "obsolete" }
        : { action, expectedRevision: 1, replacementQuestionId: "replacement" });
      expect(terminal).toMatchObject(action === "supersede" ? { status: "superseded", replacementQuestionId: "replacement" } : { status: "cancelled" });
      expect(() => store.updateQuestion("question", { harness: "pi", ownerId: "agent" }, { action: "reparent", expectedRevision: 2, parentQuestionId: null }))
        .toThrowError(expect.objectContaining({ code: "question_terminal" }));
    }
    for (const terminal of ["answered", "expired"] as const) {
      const { db, store, create } = setup(); create(`question-${terminal}`);
      if (terminal === "answered") store.answer(`question-${terminal}`, { expectedRevision: 1, selectedValues: ["yes"] });
      else db.prepare("UPDATE questions SET status = 'expired' WHERE question_id = ?").run(`question-${terminal}`);
      expect(() => store.updateQuestion(`question-${terminal}`, { harness: "pi", ownerId: "agent" }, { action: "cancel", expectedRevision: 1 }))
        .toThrowError(expect.objectContaining({ code: "question_terminal" }));
    }
  });

  it("records revision, parent, and terminal history while leaving descendants unchanged", () => {
    const { store, create, tick } = setup(); create("root"); create("child", "root"); tick();
    store.updateQuestion("root", { harness: "pi", ownerId: "agent" }, { action: "revise", expectedRevision: 1, question: { prompt: "Revised root?" } });
    store.updateQuestion("root", { harness: "pi", ownerId: "agent" }, { action: "reparent", expectedRevision: 2, parentQuestionId: null });
    const answer = store.answer("root", { expectedRevision: 3, selectedValues: ["yes"] });
    expect(answer).toMatchObject({ affectedDescendantIds: ["child"], descendantGuidance: expect.stringMatching(/revise|supersede|cancel/i) });
    expect(store.get("child")).toMatchObject({ status: "pending", parentQuestionId: "root" });
    expect(store.getQuestionHistory("root")).toMatchObject({ events: [
      expect.objectContaining({ type: "revision", revision: 2, actor: { harness: "pi", ownerId: "agent" }, at: expect.any(String) }),
      expect.objectContaining({ type: "parent_changed", revision: 3 }),
      expect.objectContaining({ type: "answered", revision: 3 })
    ], revisions: [
      expect.objectContaining({ revision: 1, question: { prompt: "root?" }, actor: { harness: "pi", ownerId: "agent" } }),
      expect.objectContaining({ revision: 2, question: { prompt: "Revised root?" } }),
      expect.objectContaining({ revision: 3, question: { prompt: "Revised root?" } })
    ] });
    expect(store.getQuestionHistory("root")).not.toHaveProperty("answer");
  });

  it("records browser, session, and expiry terminal events with stable actors and timestamps", () => {
    const { db, store, create } = setup();
    create("browser-cancel");
    store.cancel("browser-cancel", { rationale: "No longer needed" });
    expect(store.getQuestionHistory("browser-cancel").revisions).toEqual([
      expect.objectContaining({ revision: 1, question: { prompt: "browser-cancel?" } })
    ]);
    expect(store.getQuestionHistory("browser-cancel").events).toContainEqual(expect.objectContaining({
      type: "cancelled", actor: { harness: "pi", ownerId: "agent" }, at: expect.any(String)
    }));

    create("session-cancel");
    store.cancelPendingForSession("session", "Session ended");
    expect(store.getQuestionHistory("session-cancel").events).toContainEqual(expect.objectContaining({
      type: "cancelled", actor: { harness: "pi", ownerId: "agent" }, at: expect.any(String)
    }));

    create("expiry");
    db.prepare("UPDATE ask_requests SET expires_at='2000-01-01T00:00:00.000Z' WHERE request_id='expiry'").run();
    store.expireDue();
    expect(store.getQuestionHistory("expiry").events).toContainEqual(expect.objectContaining({
      type: "expired", actor: { harness: "postbox", ownerId: "expiry" }, at: expect.any(String)
    }));
  });

  it("rejects reparenting across owner boundaries", () => {
    const { store, create, sessions } = setup();
    create("child");
    sessions.register("other-connection", { machine: { machineId: "machine", hostname: "host" }, project: { projectId: "project", name: "repo", cwd: "/repo" },
      session: { sessionId: "other-session", cwd: "/repo", semanticState: "working", owner: { harness: "pi", ownerId: "other-agent" } } });
    store.create({ requestId: "foreign-parent", sessionId: "other-session", mode: "single",
      question: { prompt: "foreign-parent?" }, options: [{ value: "yes", label: "Yes" }],
      context: { codebaseContext: "Postbox", problemContext: "Different owner" } });
    expect(() => store.updateQuestion("child", { harness: "pi", ownerId: "agent" }, {
      action: "reparent", expectedRevision: 1, parentQuestionId: "foreign-parent"
    })).toThrowError(expect.objectContaining({ code: "wrong_owner" }));
  });
});
