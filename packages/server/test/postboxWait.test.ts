import { afterEach, describe, expect, it } from "vitest";
import { openPostboxDatabase, type SqliteDatabase } from "../src/db/database.js";
import { RequestStore } from "../src/services/requestStore.js";
import { SessionStore } from "../src/services/sessionStore.js";

const OWNER = { harness: "pi", ownerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } as const;
const databases: SqliteDatabase[] = [];

afterEach(() => databases.splice(0).forEach((database) => database.close()));

function setup() {
  let now = Date.parse("2026-08-13T12:00:00.000Z");
  const db = openPostboxDatabase(":memory:");
  databases.push(db);
  const sessions = new SessionStore(db, () => now, { staleAfterMs: 30_000, offlineAfterMs: 120_000 });
  sessions.register("connection", {
    machine: { machineId: "machine", hostname: "host" },
    project: { projectId: "project", name: "repo", cwd: "/repo" },
    session: { sessionId: "session", cwd: "/repo", semanticState: "working", owner: OWNER }
  });
  const requests = new RequestStore(db, () => now);
  const create = (id: string, parentQuestionId?: string) => requests.create({
    requestId: id, sessionId: "session", mode: "single", parentQuestionId,
    question: { prompt: `Question ${id}?` }, options: [{ value: "yes", label: "Yes" }],
    context: { codebaseContext: "Postbox", problemContext: "Wait for an owner-wide decision." },
    expiresAt: new Date(now + 30_000).toISOString()
  });
  type WaitResult = Record<string, unknown>;
  const waitable = requests as RequestStore & {
    waitForPostbox(input: {
      owner: typeof OWNER;
      signal?: AbortSignal;
      publishSemanticState?: (state: string) => void;
    }): Promise<WaitResult>;
    activeWaitCount(owner: typeof OWNER): number;
  };
  return { db, sessions, requests, waitable, create, advance: (ms: number) => { now += ms; } };
}

describe("owner-wide explicit Postbox wait", () => {
  it("takes no Question IDs and immediately atomically reads an existing unread Answer", async () => {
    const { requests, waitable, create } = setup();
    create("ready");
    requests.answer("ready", { expectedRevision: 1, selectedValues: ["yes"], note: "Proceed", rationale: "Approved" });

    const result = await waitable.waitForPostbox({ owner: OWNER });
    expect(result).toMatchObject({
      type: "answer",
      alreadyRead: false,
      question: { questionId: "ready", question: { prompt: "Question ready?" } },
      answer: { selectedValues: ["yes"], note: "Proceed", rationale: "Approved" }
    });
    expect(requests.listQuestionStatus({
      caller: { owner: OWNER, repository: "", worktree: "", feature: "" }, global: true,
      readState: "read", includeTerminal: true
    })).toEqual([expect.objectContaining({ questionId: "ready", answerRead: true })]);
  });

  it("publishes waiting_for_postbox, suspends once per owner, and wakes with an Answer", async () => {
    const { requests, waitable, create } = setup();
    create("pending");
    const states: string[] = [];
    const first = waitable.waitForPostbox({ owner: OWNER, publishSemanticState: (state) => states.push(state) });
    await Promise.resolve();
    expect(states).toEqual(["waiting_for_postbox"]);
    expect(waitable.activeWaitCount(OWNER)).toBe(1);
    await expect(waitable.waitForPostbox({ owner: OWNER })).rejects.toMatchObject({ code: "wait_already_active" });

    requests.answer("pending", { expectedRevision: 1, selectedValues: ["yes"] });
    await expect(first).resolves.toMatchObject({ type: "answer", question: { questionId: "pending" } });
    expect(waitable.activeWaitCount(OWNER)).toBe(0);
  });

  it("chooses an ancestor before its descendant, then otherwise the oldest Answer", async () => {
    const { requests, waitable, create, advance } = setup();
    create("old-unrelated");
    create("ancestor");
    create("descendant", "ancestor");
    requests.answer("descendant", { expectedRevision: 1, selectedValues: ["yes"] });
    advance(1_000);
    requests.answer("old-unrelated", { expectedRevision: 1, selectedValues: ["yes"] });
    advance(1_000);
    requests.answer("ancestor", { expectedRevision: 1, selectedValues: ["yes"] });

    await expect(waitable.waitForPostbox({ owner: OWNER })).resolves.toMatchObject({ question: { questionId: "ancestor" } });
    await expect(waitable.waitForPostbox({ owner: OWNER })).resolves.toMatchObject({ question: { questionId: "descendant" } });
    await expect(waitable.waitForPostbox({ owner: OWNER })).resolves.toMatchObject({ question: { questionId: "old-unrelated" } });
  });

  it("wakes with compact lifecycle data and reports no_actionable_questions", async () => {
    const { requests, waitable, create } = setup();
    create("cancelled");
    const waiting = waitable.waitForPostbox({ owner: OWNER });
    await Promise.resolve();
    requests.cancel("cancelled", { note: "Obsolete" });
    await expect(waiting).resolves.toEqual({ type: "lifecycle", questionId: "cancelled", event: "cancelled" });
    await expect(waitable.waitForPostbox({ owner: OWNER })).resolves.toEqual({ type: "no_actionable_questions" });
  });

  it("wakes waits for expiry and session-wide cancellation without consuming a later answer", async () => {
    const { requests, waitable, create, advance } = setup();
    create("expires");
    const expiring = waitable.waitForPostbox({ owner: OWNER });
    advance(60_000);
    requests.expireDue();
    await expect(expiring).resolves.toEqual({ type: "lifecycle", questionId: "expires", event: "expired" });

    create("shutdown");
    const shutdown = waitable.waitForPostbox({ owner: OWNER });
    requests.cancelPendingForSession("session", "Session replaced");
    await expect(shutdown).resolves.toEqual({ type: "lifecycle", questionId: "shutdown", event: "cancelled" });
  });

  it("aborting or disconnecting clears only the ephemeral wait and preserves durable Questions and Answers", async () => {
    const { db, sessions, waitable, create } = setup();
    create("durable");
    const controller = new AbortController();
    const waiting = waitable.waitForPostbox({ owner: OWNER, signal: controller.signal });
    await Promise.resolve();
    sessions.disconnectConnection("connection");
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    expect(waitable.activeWaitCount(OWNER)).toBe(0);
    expect(db.prepare("SELECT status FROM questions WHERE question_id = ?").get("durable")).toEqual({ status: "pending" });
    expect(db.prepare("SELECT COUNT(*) AS count FROM answers").get()).toEqual({ count: 0 });
  });

  it("does not let an aborting wait consume a racing late Answer", async () => {
    const { requests, waitable, create } = setup();
    create("race");
    const controller = new AbortController();
    const abandoned = waitable.waitForPostbox({ owner: OWNER, signal: controller.signal });
    controller.abort();
    requests.answer("race", { expectedRevision: 1, selectedValues: ["yes"] });
    await expect(abandoned).rejects.toMatchObject({ name: "AbortError" });
    await expect(waitable.waitForPostbox({ owner: OWNER })).resolves.toMatchObject({ type: "answer", question: { questionId: "race" } });
  });

  it("wakes the displaced owner through the explicit transfer seam and frees the new owner to wait", async () => {
    const { requests, waitable, create, sessions } = setup();
    create("transfer");
    const nextOwner = { harness: "pi", ownerId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
    sessions.register("next-connection", { machine: { machineId: "machine", hostname: "host" }, project: { projectId: "project", name: "repo", cwd: "/repo" },
      session: { sessionId: "next-session", cwd: "/repo", semanticState: "working", owner: nextOwner } });
    const displaced = waitable.waitForPostbox({ owner: OWNER });
    requests.transferQuestionOwner("transfer", OWNER, nextOwner);
    await expect(displaced).resolves.toEqual({ type: "lifecycle", questionId: "transfer", event: "transferred", owner: nextOwner });
    expect(waitable.activeWaitCount(OWNER)).toBe(0);
    expect(requests.getQuestions({ questionIds: ["transfer"] })[0]).toMatchObject({ owner: nextOwner });
    const nextWait = waitable.waitForPostbox({ owner: nextOwner });
    expect(waitable.activeWaitCount(nextOwner)).toBe(1);
    requests.cancel("transfer");
    await expect(nextWait).resolves.toMatchObject({ type: "lifecycle", event: "cancelled" });
  });
});
