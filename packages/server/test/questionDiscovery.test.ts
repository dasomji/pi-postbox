import { afterEach, describe, expect, it } from "vitest";
import { openPostboxDatabase, type SqliteDatabase } from "../src/db/database.js";
import { RequestStore } from "../src/services/requestStore.js";
import { SessionStore } from "../src/services/sessionStore.js";

const databases: SqliteDatabase[] = [];
const NOW = Date.parse("2026-08-13T12:00:00.000Z");
const OWNER = { harness: "pi", ownerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } as const;
const OTHER_OWNER = { harness: "pi", ownerId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" } as const;

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function setup() {
  const db = openPostboxDatabase(":memory:");
  databases.push(db);
  const sessions = new SessionStore(db, () => NOW, { staleAfterMs: 30_000, offlineAfterMs: 120_000 });
  const requests = new RequestStore(db, () => NOW);
  const register = (
    sessionId: string,
    owner: { harness: "pi"; ownerId: string },
    repository = "dasomji/pi-postbox",
    worktree = "/worktrees/current",
    feature = "feature/discovery"
  ) => sessions.register(`connection-${sessionId}`, {
    machine: { machineId: "machine-1", hostname: "host" },
    project: {
      projectId: `project-${sessionId}`,
      name: "pi-postbox",
      repoName: repository,
      cwd: worktree,
      gitRoot: worktree,
      worktreePath: worktree,
      branch: feature
    },
    session: { sessionId, cwd: worktree, worktreePath: worktree, branch: feature, semanticState: "working", owner }
  });
  register("current", OWNER);
  register("other-owner", OTHER_OWNER);

  const create = (sessionId: string, questionId: string, prompt: string, context = "context") => requests.create({
    requestId: questionId,
    sessionId,
    mode: "single",
    question: { prompt, ambiguity: context },
    options: [{ value: "yes", label: "Yes", description: "description", impact: "impact" }]
  });

  const caller = {
    owner: OWNER,
    repository: "dasomji/pi-postbox",
    worktree: "/worktrees/current",
    feature: "feature/discovery"
  };
  return { db, sessions, requests, register, create, caller };
}

describe("token-cheap Question discovery", () => {
  it("returns 25 active Questions from an explicit feature scope and paginates without leaking fields", () => {
    const { requests, register, create, caller } = setup();
    for (let index = 0; index < 27; index += 1) {
      create("current", `current-${String(index).padStart(2, "0")}`, `Complete question ${index}`);
    }
    register("other-feature", OWNER, "dasomji/pi-postbox", "/worktrees/current", "feature/other");
    register("other-worktree", OWNER, "dasomji/pi-postbox", "/worktrees/other", "feature/discovery");
    register("other-repository", OWNER, "someone/else", "/worktrees/current", "feature/discovery");
    create("other-feature", "excluded-feature", "wrong feature");
    create("other-worktree", "excluded-worktree", "wrong worktree");
    create("other-repository", "excluded-repository", "wrong repository");
    create("current", "answered-current", "terminal question");
    requests.answer("answered-current", { selectedValues: ["yes"], note: "secret answer" });

    const discovery = requests as RequestStore & {
      listQuestions(input: unknown): { questions: unknown[]; nextCursor?: string };
    };
    const first = discovery.listQuestions({ caller, scope: "feature" });
    expect(first.questions).toHaveLength(25);
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(first.questions[0]).toEqual({ questionId: "current-00", question: "Complete question 0" });
    for (const item of first.questions) expect(Object.keys(item as object).sort()).toEqual(["question", "questionId"]);

    const second = discovery.listQuestions({ caller, scope: "feature", cursor: first.nextCursor });
    expect(second).toEqual({
      questions: [
        { questionId: "current-25", question: "Complete question 25" },
        { questionId: "current-26", question: "Complete question 26" }
      ]
    });
  });

  it("defaults both list tools to the current owner and broadens only through an explicit scope", () => {
    const { requests, register, create, caller } = setup();
    create("current", "mine", "My question");
    create("other-owner", "same-feature", "Other owner in this feature");
    register("other-feature", OTHER_OWNER, "dasomji/pi-postbox", "/worktrees/current", "feature/other");
    create("other-feature", "same-worktree", "Other feature in this worktree");
    register("other-worktree", OTHER_OWNER, "dasomji/pi-postbox", "/worktrees/other", "feature/other");
    create("other-worktree", "same-repository", "Other worktree in this repository");
    register("other-repository", OTHER_OWNER, "someone/else", "/worktrees/elsewhere", "feature/elsewhere");
    create("other-repository", "global-question", "Question outside this repository");

    expect(requests.listQuestions({ caller }).questions.map((question) => question.questionId)).toEqual(["mine"]);
    expect(requests.listQuestions({ caller, scope: "feature" }).questions.map((question) => question.questionId))
      .toEqual(["mine", "same-feature"]);
    expect(requests.listQuestions({ caller, scope: "worktree" }).questions.map((question) => question.questionId))
      .toEqual(["mine", "same-feature", "same-worktree"]);
    expect(requests.listQuestions({ caller, scope: "repository" }).questions.map((question) => question.questionId))
      .toEqual(["mine", "same-feature", "same-repository", "same-worktree"]);
    expect(requests.listQuestions({ caller, scope: "global" }).questions.map((question) => question.questionId))
      .toEqual(["global-question", "mine", "same-feature", "same-repository", "same-worktree"]);

    expect(requests.listQuestionStatus({ caller })).toEqual([{ questionId: "mine", status: "pending" }]);
    expect(requests.listQuestionStatus({ caller, scope: "feature" }).map((question) => question.questionId))
      .toEqual(["mine", "same-feature"]);
  });

  it("uses a compact query-bound keyset cursor that remains stable when earlier Questions are inserted", () => {
    const { db, requests, create, caller } = setup();
    for (let index = 0; index < 3; index += 1) create("current", `cursor-${index}`, `Question ${index}`);
    const first = requests.listQuestions({ caller, pageSize: 2 });
    expect(first.nextCursor?.length).toBeLessThan(120);
    expect(first.nextCursor).not.toContain("cursor-1");
    db.prepare("DELETE FROM question_revisions WHERE question_id = ?").run("cursor-0");
    db.prepare("DELETE FROM questions WHERE question_id = ?").run("cursor-0");
    db.prepare("DELETE FROM ask_requests WHERE request_id = ?").run("cursor-0");
    const second = requests.listQuestions({ caller, pageSize: 2, cursor: first.nextCursor });
    expect(second.questions.map((question) => question.questionId)).toEqual(["cursor-2"]);
    expect(() => requests.listQuestions({ caller: { ...caller, feature: "other" }, pageSize: 2, cursor: first.nextCursor })).toThrow(/another query/i);
    expect(() => requests.listQuestions({ caller, pageSize: 101 })).toThrow(/at most 100/i);
  });

  it("paginates compact status results with a query-bound 50-row maximum", () => {
    const { requests, create, caller } = setup();
    for (let index = 0; index < 4; index += 1) create("current", `status-${index}`, `Status ${index}`);

    const first = (requests as any).listQuestionStatusPage({ caller, pageSize: 2 });
    expect(first.statuses.map((status: { questionId: string }) => status.questionId)).toEqual(["status-0", "status-1"]);
    expect(first.nextCursor?.length).toBeLessThan(120);
    const second = (requests as any).listQuestionStatusPage({ caller, pageSize: 2, cursor: first.nextCursor });
    expect(second).toEqual({
      statuses: [
        { questionId: "status-2", status: "pending" },
        { questionId: "status-3", status: "pending" }
      ]
    });
    expect(() => (requests as any).listQuestionStatusPage({ caller, pageSize: 51 })).toThrow(/at most 50/i);
  });

  it("supports explicit owner, repository, worktree, feature, status, and global relevance filters", () => {
    const { requests, register, create, caller } = setup();
    register("recovery", OTHER_OWNER, "recovery/repo", "/worktrees/recovery", "feature/recovery");
    create("current", "mine", "My question");
    create("recovery", "theirs", "Their question");
    create("recovery", "theirs-answered", "Their answered question");
    requests.answer("theirs-answered", { selectedValues: ["yes"] });
    const discovery = requests as RequestStore & { listQuestions(input: unknown): { questions: unknown[] } };

    expect(discovery.listQuestions({ caller, owner: OTHER_OWNER, repository: "recovery/repo", worktree: "/worktrees/recovery", feature: "feature/recovery" }).questions)
      .toEqual([{ questionId: "theirs", question: "Their question" }]);
    expect(discovery.listQuestions({ caller, global: true, status: "answered" }).questions)
      .toEqual([{ questionId: "theirs-answered", question: "Their answered question" }]);
    expect(discovery.listQuestions({ caller, global: true }).questions)
      .toEqual(expect.arrayContaining([
        { questionId: "mine", question: "My question" },
        { questionId: "theirs", question: "Their question" }
      ]));
  });

  it("returns compact Question controls by default and complete content only when explicitly requested", () => {
    const { requests, create } = setup();
    create("current", "controlled", "Prompt that should stay out of the default view", "large private context");

    expect(requests.getQuestions({ questionIds: ["controlled"] })).toEqual([{
      questionId: "controlled",
      revision: 1,
      ownerRevision: 1,
      status: "pending",
      owner: OWNER,
      creator: OWNER,
      updatedAt: "2026-08-13T12:00:00.000Z"
    }]);
    expect(requests.getQuestions({ questionIds: ["controlled"], view: "full" })[0]).toMatchObject({
      question: { prompt: "Prompt that should stay out of the default view", ambiguity: "large private context" },
      options: [{ value: "yes", label: "Yes" }],

    });
  });

  it("returns complete latest Question data with non-consuming resolution evidence and no truncation", () => {
    const { requests, create, caller } = setup();
    const largeContext = "large-context-".repeat(1_000);
    for (let index = 0; index < 20; index += 1) create("current", `detail-${index}`, `Question ${index}`, index === 19 ? largeContext : `context-${index}`);
    requests.answer("detail-0", { selectedValues: ["yes"], note: "must not leak" });
    const discovery = requests as RequestStore & { getQuestions(input: { questionIds: string[]; view?: "control" | "full" }): unknown[] };

    const details = discovery.getQuestions({ questionIds: Array.from({ length: 20 }, (_, index) => `detail-${index}`), view: "full" }) as Array<Record<string, unknown>>;
    expect(details).toHaveLength(20);
    expect(details[19]).toMatchObject({
      questionId: "detail-19",
      revision: 1,
      question: { prompt: "Question 19", ambiguity: largeContext },
      options: [{ value: "yes", label: "Yes", description: "description", impact: "impact" }]
    });
    expect(details[0]).toMatchObject({
      answerId: expect.any(String),
      answerRead: false,
      resolution: {
        kind: "answer",
        answerId: expect.any(String),
        questionRevision: 1,
        answer: ["yes"],
        note: "must not leak",
        resolvedAt: "2026-08-13T12:00:00.000Z",
        firstRead: null
      }
    });
    expect(details[0]).not.toHaveProperty("answer");
    expect(details[0]).not.toHaveProperty("selectedValues");
    expect(JSON.stringify(details)).not.toContain("rationale");
    expect(requests.listQuestionStatus({ caller, scope: "owner", readState: "unread" }))
      .toEqual([expect.objectContaining({ questionId: "detail-0", answerRead: false })]);

    requests.getAnswer("detail-0", OWNER);
    expect(requests.getQuestions({ questionIds: ["detail-0"], view: "full" })[0]).toMatchObject({
      answerRead: true,
      resolution: {
        firstRead: { reader: OWNER, readAt: "2026-08-13T12:00:00.000Z" }
      }
    });
    expect((details[19].question as { ambiguity: string }).ambiguity).toHaveLength(largeContext.length);
    expect(() => requests.getQuestions({
      questionIds: Array.from({ length: 21 }, (_, index) => `detail-${index}`)
    })).toThrow(/at most 20/i);
  });

  it("round-trips batch hierarchy changes through complete Question details", () => {
    const { requests } = setup();
    const draft = (localRef: string, parent?: { localRef: string }) => ({
      localRef,
      requestId: `hierarchy-${localRef}`,
      ...(parent ? { parentLocalRef: parent.localRef } : {}),
      mode: "single" as const,
      question: { prompt: `Resolve ${localRef}?`, ambiguity: "Test ambiguity." },
      options: [{ value: "yes", label: "Yes" }],

    });
    expect(requests.createBatch("current", [
      draft("root"),
      draft("child", { localRef: "root" }),
      draft("grandchild", { localRef: "child" }),
      draft("alternate")
    ]).status).toBe("created");

    const initial = requests.getQuestions({
      questionIds: ["hierarchy-root", "hierarchy-child", "hierarchy-grandchild"]
    });
    expect(initial[0]).not.toHaveProperty("parentQuestionId");
    expect(initial[1]).toMatchObject({ parentQuestionId: "hierarchy-root" });
    expect(initial[2]).toMatchObject({ parentQuestionId: "hierarchy-child" });

    const reparented = requests.updateQuestion("hierarchy-child", OWNER, {
      action: "reparent",
      expectedRevision: 1,
      expectedOwnerRevision: 1,
      parentQuestionId: "hierarchy-alternate"
    });
    expect(reparented).toMatchObject({ revision: 2, parentQuestionId: "hierarchy-alternate" });
    expect(requests.getQuestions({ questionIds: ["hierarchy-child"] })[0]).toMatchObject({
      revision: 2,
      parentQuestionId: "hierarchy-alternate"
    });

    const detached = requests.updateQuestion("hierarchy-child", OWNER, {
      action: "reparent",
      expectedRevision: 2,
      expectedOwnerRevision: 1,
      parentQuestionId: null
    });
    const detachedResult = JSON.parse(JSON.stringify(detached)) as Record<string, unknown>;
    expect(detachedResult).toMatchObject({ revision: 3 });
    expect(detachedResult).not.toHaveProperty("parentQuestionId");
    const detachedDetail = requests.getQuestions({ questionIds: ["hierarchy-child"] })[0];
    expect(detachedDetail).toMatchObject({ revision: 3 });
    expect(detachedDetail).not.toHaveProperty("parentQuestionId");
  });

  it("lists only identifiers and status/read facts, defaulting to the caller's active Questions and unread Answers", () => {
    const { requests, create, caller } = setup();
    create("current", "pending", "Text that must never appear");
    create("current", "unread", "Unread text that must never appear");
    create("current", "read", "Read text that must never appear");
    requests.answer("unread", { selectedValues: ["yes"], note: "unread secret" });
    requests.answer("read", { selectedValues: ["yes"], note: "read secret" });
    requests.getAnswer("read", OWNER);
    const discovery = requests as RequestStore & { listQuestionStatus(input: unknown): unknown[] };

    const status = discovery.listQuestionStatus({ caller });
    expect(status).toEqual([
      { questionId: "pending", status: "pending" },
      { questionId: "unread", status: "answered", answerId: expect.any(String), answerRead: false }
    ]);
    for (const item of status) {
      expect(Object.keys(item as object).sort()).toEqual(
        (item as { status: string }).status === "pending"
          ? ["questionId", "status"]
          : ["answerId", "answerRead", "questionId", "status"]
      );
    }
    expect(JSON.stringify(status)).not.toMatch(/Text|secret|question\"/i);
    expect(discovery.listQuestionStatus({ caller, global: true, readState: "read", includeTerminal: true }))
      .toEqual([{ questionId: "read", status: "answered", answerId: expect.any(String), answerRead: true }]);
  });
});

describe("exact Postbox owner status", () => {
  it("returns compact exact-owner presence and counts, including an owner with zero Questions", () => {
    const { sessions, create } = setup();
    create("current", "pending", "Pending");
    create("current", "unread", "Unread");
    // Answer through the independently persisted decision records; owner status must aggregate them.
    const db = databases[databases.length - 1];
    const answerId = "answer-unread";
    db.prepare("UPDATE questions SET status = 'answered', resolved_at = ?, updated_at = ? WHERE question_id = ?").run(new Date(NOW).toISOString(), new Date(NOW).toISOString(), "unread");
    db.prepare(`INSERT INTO answers (answer_id, question_id, question_revision, status, selected_values_json, created_at)
      VALUES (?, ?, 1, 'answered', '[]', ?)`).run(answerId, "unread", new Date(NOW).toISOString());
    const presence = sessions as SessionStore & {
      getPostboxOwnerStatus(owners: ReadonlyArray<{ harness: string; ownerId: string }>): unknown[];
    };
    const result = presence.getPostboxOwnerStatus([OWNER, OTHER_OWNER]);
    expect(result).toEqual([
      {
        owner: OWNER,
        presence: "live",
        semanticState: "working",
        lastHeartbeatAt: "2026-08-13T12:00:00.000Z",
        activeQuestionCount: 1,
        unreadAnswerCount: 1
      },
      {
        owner: OTHER_OWNER,
        presence: "live",
        semanticState: "working",
        lastHeartbeatAt: "2026-08-13T12:00:00.000Z",
        activeQuestionCount: 0,
        unreadAnswerCount: 0
      }
    ]);
    for (const item of result) expect(Object.keys(item as object).sort()).toEqual([
      "activeQuestionCount", "lastHeartbeatAt", "owner", "presence", "semanticState", "unreadAnswerCount"
    ]);
  });
});
