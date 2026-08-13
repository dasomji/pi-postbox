import { afterEach, describe, expect, it, vi } from "vitest";
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
    expect(store.claimProactiveAnswerNotifications(OWNER, sessions)).toEqual([]);
    sessions.updateSession({ sessionId: "owner-session", semanticState: "idle" });
    expect(store.claimProactiveAnswerNotifications(OWNER, sessions)).toEqual([expect.objectContaining({ questionId: "busy", answerId: expect.any(String) })]);
    expect(store.claimProactiveAnswerNotifications(OWNER, sessions)).toEqual([]);
  });

  it("records delivery only after the adapter acknowledgement and keeps unread independently durable", () => {
    const { db, store, create } = setup("idle"); create("ack"); store.answer("ack", { expectedRevision: 1, selectedValues: ["yes"] });
    const [ping] = store.claimProactiveAnswerNotifications(OWNER) as any[];
    expect(db.prepare("SELECT owner_notification_delivered_at, first_reader_harness FROM answers WHERE answer_id=?").get(ping.answerId))
      .toEqual({ owner_notification_delivered_at: null, first_reader_harness: null });
    expect(store.acknowledgeOwnerNotification(ping.answerId, OWNER)).toBe(true);
    expect(store.acknowledgeOwnerNotification(ping.answerId, OWNER)).toBe(false);
  });

  it("defers offline delivery to the same exact owner reconnect without reviving a native agent", () => {
    const { sessions, store, create } = setup("idle"); create("offline"); sessions.disconnectConnection("owner-connection");
    store.answer("offline", { expectedRevision: 1, selectedValues: ["yes"] });
    expect(store.claimProactiveAnswerNotifications(OWNER, sessions)).toEqual([]);
    expect(store.claimProactiveAnswerNotifications(NEXT, sessions)).toEqual([]);
    sessions.register("owner-reconnect", { machine: { machineId: "machine", hostname: "host" }, project: { projectId: "project", name: "repo", cwd: "/repo" },
      session: { sessionId: "owner-session", cwd: "/repo", semanticState: "idle", owner: OWNER } });
    expect(store.claimProactiveAnswerNotifications(OWNER, sessions)).toHaveLength(1);
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

  it("offers a non-terminal Chat disposal hook for disconnect/takeover without mutating durable status", async () => {
    const { store, create } = setup(); create("chat");
    const dispose = vi.fn(async () => undefined);
    await store.disposePrivateQuestionChat("chat", "owner-disconnected", dispose);
    expect(dispose).toHaveBeenCalledWith("chat");
    expect(store.get("chat")).toMatchObject({ status: "pending" });
    expect(JSON.stringify(store.getQuestions({ questionIds: ["chat"] }))).not.toMatch(/transcript|messages|toolCalls/i);
  });
});
