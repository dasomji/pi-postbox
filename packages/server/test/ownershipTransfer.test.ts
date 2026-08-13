import { afterEach, describe, expect, it } from "vitest";
import { openPostboxDatabase, type SqliteDatabase } from "../src/db/database.js";
import { RequestStore } from "../src/services/requestStore.js";
import { SessionStore } from "../src/services/sessionStore.js";

const CREATOR = { harness: "pi", ownerId: "creator" };
const SIBLING = { harness: "pi", ownerId: "sibling" };
const RECOVERY = { harness: "claude-code", ownerId: "recovery" };
const databases: SqliteDatabase[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));

function setup() {
  let now = Date.parse("2026-08-13T12:00:00.000Z");
  const db = openPostboxDatabase(":memory:"); databases.push(db);
  const sessions = new SessionStore(db, () => now, { staleAfterMs: 1_000, offlineAfterMs: 5_000 });
  const register = (sessionId: string, owner: typeof CREATOR, lineage?: Record<string, unknown>) => sessions.register(sessionId, {
    machine: { machineId: "machine", hostname: "host" }, project: { projectId: "project", name: "repo", cwd: "/repo" },
    session: { sessionId, cwd: "/repo", semanticState: "working", owner, lineage }
  } as any);
  register("creator-session", CREATOR);
  register("sibling-session", SIBLING, { harnessSessionId: "shared", parentOwnerId: CREATOR.ownerId, rootOwnerId: CREATOR.ownerId });
  register("recovery-session", RECOVERY);
  const store = new RequestStore(db, () => now) as any;
  store.create({ requestId: "question", sessionId: "creator-session", mode: "single", urgency: "normal",
    question: { prompt: "Recover this?" }, options: [{ value: "yes", label: "Yes" }],
    context: { codebaseContext: "Postbox", problemContext: "Owner recovery" } });
  return { db, sessions, store, advance: (ms: number) => { now += ms; } };
}

describe("deliberate Question ownership transfer and recovery", () => {
  it("transfers from the current live owner to one exact target and records immutable ownership audit", () => {
    const { store } = setup();
    store.transferQuestionOwner("question", CREATOR, SIBLING);
    expect(store.getQuestions({ questionIds: ["question"] })[0]).toMatchObject({ creator: CREATOR, owner: SIBLING });
    expect(store.getQuestionHistory("question").events).toContainEqual(expect.objectContaining({
      type: "owner_changed", previousOwner: CREATOR, owner: SIBLING, actor: CREATOR, at: expect.any(String)
    }));
  });

  it("allows takeover only when the expected owner is offline, never merely stale", () => {
    const { sessions, store, advance } = setup();
    advance(2_000);
    expect(sessions.getPostboxOwnerStatus([CREATOR])[0]?.presence).toBe("stale");
    expect(() => store.takeoverQuestionOwner("question", CREATOR, RECOVERY, sessions)).toThrowError(expect.objectContaining({ code: "owner_not_offline" }));
    advance(5_000);
    expect(sessions.getPostboxOwnerStatus([CREATOR])[0]?.presence).toBe("offline");
    expect(() => store.takeoverQuestionOwner("question", CREATOR, RECOVERY, sessions)).not.toThrow();
  });

  it("uses expected-owner compare-and-swap so exactly one racing takeover wins", () => {
    const { sessions, store, advance } = setup(); advance(10_000);
    const outcomes = [SIBLING, RECOVERY].map((candidate) => {
      try { store.takeoverQuestionOwner("question", CREATOR, candidate, sessions); return "won"; }
      catch { return "lost"; }
    });
    expect(outcomes.sort()).toEqual(["lost", "won"]);
  });

  it("does not grant siblings, parents, roots, or shared lineage owner-only authority or automatic succession", () => {
    const { store } = setup();
    expect(() => store.updateQuestion("question", SIBLING, { action: "cancel", expectedRevision: 1 })).toThrowError(expect.objectContaining({ code: "wrong_owner" }));
    expect(store.getQuestions({ questionIds: ["question"] })[0]).toMatchObject({ owner: CREATOR });
  });

  it("does not treat lineage, transcript residency, or native completion metadata as takeover authority", () => {
    const { db, sessions, store, advance } = setup();
    db.prepare("UPDATE sessions SET agent_session_path=?, semantic_state='idle' WHERE session_id='creator-session'")
      .run("/tmp/completed-session.jsonl");
    advance(2_000);
    expect(sessions.getPostboxOwnerStatus([CREATOR])[0]?.presence).toBe("stale");
    expect(() => store.takeoverQuestionOwner("question", CREATOR, SIBLING, sessions, {
      nativeCompleted: true, processResident: false, transcriptExists: true
    })).toThrowError(expect.objectContaining({ code: "owner_not_offline" }));
    expect(store.getQuestions({ questionIds: ["question"] })[0]).toMatchObject({ owner: CREATOR });
  });

  it("lets a recovery agent read an offline owner's Answer without taking ownership", () => {
    const { store, advance } = setup();
    store.answer("question", { expectedRevision: 1, selectedValues: ["yes"] });
    advance(10_000);
    expect(store.getAnswerForRecovery("question", RECOVERY)).toMatchObject({
      question: { questionId: "question" }, answer: { selectedValues: ["yes"] }
    });
    expect(store.getQuestions({ questionIds: ["question"] })[0]).toMatchObject({ creator: CREATOR, owner: CREATOR });
  });
});
