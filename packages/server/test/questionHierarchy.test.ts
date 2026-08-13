import { describe, expect, it } from "vitest";
import { openPostboxDatabase } from "../src/db/database.js";
import { RequestStore } from "../src/services/requestStore.js";
import { SessionStore } from "../src/services/sessionStore.js";

function setup() {
  const db = openPostboxDatabase(":memory:");
  const now = Date.parse("2026-08-13T12:00:00.000Z");
  const sessions = new SessionStore(db, () => now, { staleAfterMs: 1_000, offlineAfterMs: 2_000 });
  sessions.register("connection", {
    machine: { machineId: "machine", hostname: "host" },
    project: { projectId: "project", name: "repo", cwd: "/repo" },
    session: { sessionId: "session", cwd: "/repo", semanticState: "working", owner: { harness: "pi", ownerId: "agent" } }
  });
  return { db, store: new RequestStore(db, () => now) as any };
}

const question = (localRef: string, parent?: unknown) => ({
  localRef, requestId: `question-${localRef}`, parent, mode: "single", urgency: "normal",
  question: { prompt: `Resolve ${localRef}?` }, options: [{ value: "yes", label: "Yes" }],
  context: { codebaseContext: "Postbox", problemContext: "Preserve a deterministic hierarchy." }
});

describe("Question hierarchy transaction", () => {
  it("commits a valid prefix, rejects a forward reference with a typed reason, and rejects every later item", () => {
    const { db, store } = setup();
    const receipt = store.createBatch("session", [
      question("root"),
      question("forward", { localRef: "later" }),
      question("later"),
      question("after")
    ]);

    expect(receipt.items).toEqual([
      expect.objectContaining({ localRef: "root", status: "created", questionId: "question-root" }),
      expect.objectContaining({ localRef: "forward", status: "rejected", reason: expect.objectContaining({ code: "forward_parent_reference" }) }),
      expect.objectContaining({ localRef: "later", status: "rejected", reason: expect.objectContaining({ code: "batch_aborted" }) }),
      expect.objectContaining({ localRef: "after", status: "rejected", reason: expect.objectContaining({ code: "batch_aborted" }) })
    ]);
    expect(db.prepare("SELECT question_id FROM questions ORDER BY created_at").all()).toEqual([{ question_id: "question-root" }]);
    db.close();
  });

  it("enforces five direct children and four levels without leaving a partial violating item", () => {
    const { db, store } = setup();
    const children = Array.from({ length: 6 }, (_, index) => question(`child-${index + 1}`, { localRef: "root" }));
    const receipt = store.createBatch("session", [question("root"), ...children]);
    expect(receipt.items.at(-1)).toMatchObject({ status: "rejected", reason: { code: "child_limit_reached" } });
    expect(db.prepare("SELECT COUNT(*) AS count FROM questions").get()).toEqual({ count: 6 });

    const depthReceipt = store.createBatch("session", [
      question("level-1"), question("level-2", { localRef: "level-1" }), question("level-3", { localRef: "level-2" }),
      question("level-4", { localRef: "level-3" }), question("level-5", { localRef: "level-4" })
    ]);
    expect(depthReceipt.items.at(-1)).toMatchObject({ status: "rejected", reason: { code: "depth_limit_reached" } });
    db.close();
  });

  it("nudges a single fourth child or level-four ask, suppresses batch nudges, and reports all open descendants on answer", () => {
    const { db, store } = setup();
    store.createBatch("session", [question("root"), question("one", { localRef: "root" }), question("two", { localRef: "root" }), question("three", { localRef: "root" })]);
    expect(store.createOne("session", question("four", { questionId: "question-root" }))).toMatchObject({ nudge: expect.stringMatching(/fourth direct child/i) });
    expect(store.createBatch("session", [question("five", { questionId: "question-root" })]).items[0].nudge).toBeUndefined();

    const event = store.answer("question-root", { selectedValues: ["yes"] });
    expect(event.affectedDescendantIds).toEqual(expect.arrayContaining(["question-one", "question-two", "question-three", "question-four", "question-five"]));
    expect(db.prepare("SELECT status FROM questions WHERE question_id = 'question-one'").get()).toEqual({ status: "pending" });
    db.close();
  });
});
