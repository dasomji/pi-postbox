import { afterEach, describe, expect, it } from "vitest";
import { openPostboxDatabase, type SqliteDatabase } from "../src/db/database.js";
import { RequestStore } from "../src/services/requestStore.js";
import { SessionStore } from "../src/services/sessionStore.js";

const OWNER = { harness: "pi", ownerId: "owner" };
const NEXT = { harness: "pi", ownerId: "next" };
const databases: SqliteDatabase[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));

function setup(state: "working" | "idle" | "waiting_for_postbox" = "working") {
  let now = Date.parse("2026-08-13T12:00:00.000Z");
  const db = openPostboxDatabase(":memory:"); databases.push(db);
  const sessions = new SessionStore(db, () => now, { staleAfterMs: 1_000, offlineAfterMs: 5_000 });
  const register = (connection: string, sessionId: string, owner: typeof OWNER, semanticState = state) => sessions.register(connection, {
    machine: { machineId: "machine", hostname: "host" }, project: { projectId: "project", name: "repo", cwd: "/repo" },
    session: { sessionId, cwd: "/repo", semanticState, owner, agentSessionPath: `/tmp/${sessionId}.jsonl`, leafId: "leaf" }
  } as any);
  register("owner-connection", "owner-session", OWNER);
  register("next-connection", "next-session", NEXT, "idle");
  const store = new RequestStore(db, () => now) as any;
  const create = (id: string) => store.create({ requestId: id, sessionId: "owner-session", mode: "single", urgency: "normal",
    question: { prompt: `${id}?` }, options: [{ value: "yes", label: "Yes" }], context: { codebaseContext: "Postbox", problemContext: "Delivery" },
    forkReference: { agentSessionPath: "/tmp/owner-session.jsonl", leafId: "leaf" } });
  return { db, sessions, store, create, register, advance: (ms: number) => { now += ms; } };
}

describe("resilient proactive Answer delivery", () => {
  it("defers a busy owner until settled, then claims exactly one lightweight delivery", () => {
    const { sessions, store, create } = setup("working"); create("busy"); store.answer("busy", { expectedRevision: 1, selectedValues: ["yes"] });
    expect(store.claimProactiveAnswerNotifications(OWNER, "busy-connection", sessions)).toEqual([]);
    sessions.updateSession({ sessionId: "owner-session", semanticState: "idle" });
    expect(store.claimProactiveAnswerNotifications(OWNER, "busy-connection", sessions)).toEqual([expect.objectContaining({ questionId: "busy", answerId: expect.any(String) })]);
    expect(store.claimProactiveAnswerNotifications(OWNER, "busy-connection", sessions)).toEqual([]);
  });

  it("records delivery only after the adapter acknowledgement and keeps unread independently durable", () => {
    const { db, store, create } = setup("idle"); create("ack"); store.answer("ack", { expectedRevision: 1, selectedValues: ["yes"] });
    const [ping] = store.claimProactiveAnswerNotifications(OWNER, "connection-1") as any[];
    expect(db.prepare("SELECT owner_notification_delivered_at, first_reader_harness FROM answers WHERE answer_id=?").get(ping.answerId))
      .toEqual({ owner_notification_delivered_at: null, first_reader_harness: null });
    expect(store.acknowledgeOwnerNotification(ping.answerId, OWNER, "wrong-connection")).toBe(false);
    expect(store.acknowledgeOwnerNotification(ping.answerId, OWNER, "connection-1")).toBe(true);
    expect(store.acknowledgeOwnerNotification(ping.answerId, OWNER, "connection-1")).toBe(false);
  });

  it("defers offline delivery to the same exact owner reconnect without reviving a native agent", () => {
    const { sessions, store, create } = setup("idle"); create("offline"); sessions.disconnectConnection("owner-connection");
    store.answer("offline", { expectedRevision: 1, selectedValues: ["yes"] });
    expect(store.claimProactiveAnswerNotifications(OWNER, "offline", sessions)).toEqual([]);
    expect(store.claimProactiveAnswerNotifications(NEXT, "next", sessions)).toEqual([]);
    sessions.register("owner-reconnect", { machine: { machineId: "machine", hostname: "host" }, project: { projectId: "project", name: "repo", cwd: "/repo" },
      session: { sessionId: "owner-session", cwd: "/repo", semanticState: "idle", owner: OWNER } });
    expect(store.claimProactiveAnswerNotifications(OWNER, "owner-reconnect", sessions)).toHaveLength(1);
  });

  it("persists claims and lets only the owning connection release or acknowledge them", () => {
    const { db, store, create } = setup("idle"); create("claim"); store.answer("claim", { expectedRevision: 1, selectedValues: ["yes"] });
    const [ping] = store.claimProactiveAnswerNotifications(OWNER, "old") as any[];
    expect(db.prepare("SELECT owner_notification_claim_token, owner_notification_claimed_at FROM answers WHERE answer_id=?").get(ping.answerId))
      .toEqual({ owner_notification_claim_token: "old", owner_notification_claimed_at: "2026-08-13T12:00:00.000Z" });
    expect(store.releaseProactiveNotificationClaims(OWNER, "new")).toBe(0);
    expect(store.acknowledgeOwnerNotification(ping.answerId, OWNER, "new")).toBe(false);
    expect(store.releaseProactiveNotificationClaims(OWNER, "old")).toBe(1);
    expect(store.claimProactiveAnswerNotifications(OWNER, "new")).toHaveLength(1);
    expect(store.releaseProactiveNotificationClaims(OWNER, "old")).toBe(0);
    expect(store.acknowledgeOwnerNotification(ping.answerId, OWNER, "new")).toBe(true);
  });

  it("gives an explicit waiter the full Answer and suppresses the lightweight ping", async () => {
    const { store, create } = setup("waiting_for_postbox"); create("wait");
    const waiting = store.waitForPostbox({ owner: OWNER });
    store.answer("wait", { expectedRevision: 1, selectedValues: ["yes"] });
    await expect(waiting).resolves.toMatchObject({ type: "answer", question: { questionId: "wait" }, answer: { selectedValues: ["yes"] } });
    expect(store.pendingOwnerNotifications(OWNER)).toEqual([]);
  });

  it("keeps source-session/fork provenance and creator immutable across ownership changes", () => {
    const { store, create } = setup(); create("transfer"); store.transferQuestionOwner("transfer", OWNER, NEXT);
    expect(store.get("transfer")).toMatchObject({ sessionId: "owner-session", forkReference: { agentSessionPath: "/tmp/owner-session.jsonl", leafId: "leaf" } });
    expect(store.getQuestions({ questionIds: ["transfer"] })[0]).toMatchObject({ creator: OWNER, owner: NEXT });
  });

  it("never exposes private Chat transcript fields through durable state, discovery, Answer, or History", () => {
    const { store, create } = setup("idle"); create("chat");
    store.answer("chat", { expectedRevision: 1, selectedValues: ["yes"] });
    const surfaces = [store.list(), store.get("chat"), store.getQuestions({ questionIds: ["chat"] }),
      store.getAnswer("chat", OWNER), store.getQuestionHistory("chat")];
    for (const surface of surfaces) expect(JSON.stringify(surface)).not.toMatch(/transcript|messages|toolCalls|chat\.event/i);
  });
});
