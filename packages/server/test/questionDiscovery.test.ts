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
    question: { prompt, context, relevance: "relevance", decisionImpact: "impact" },
    options: [{ value: "yes", label: "Yes", description: "description", meaning: "meaning", context: "option context" }],
    context: { codebaseContext: context, problemContext: "problem" }
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
  it("defaults to 25 active Questions in the caller's repository, worktree, and feature and paginates without leaking fields", () => {
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
    requests.answer("answered-current", { selectedValues: ["yes"], note: "secret answer", rationale: "secret rationale" });

    const discovery = requests as RequestStore & {
      listQuestions(input: unknown): { questions: unknown[]; nextCursor?: string };
    };
    const first = discovery.listQuestions({ caller });
    expect(first.questions).toHaveLength(25);
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(first.questions[0]).toEqual({ questionId: "current-00", question: "Complete question 0" });
    for (const item of first.questions) expect(Object.keys(item as object).sort()).toEqual(["question", "questionId"]);

    const second = discovery.listQuestions({ caller, cursor: first.nextCursor });
    expect(second).toEqual({
      questions: [
        { questionId: "current-25", question: "Complete question 25" },
        { questionId: "current-26", question: "Complete question 26" }
      ]
    });
  });

  it("uses a query-bound keyset cursor that remains stable when earlier Questions are inserted", () => {
    const { db, requests, create, caller } = setup();
    for (let index = 0; index < 3; index += 1) create("current", `cursor-${index}`, `Question ${index}`);
    const first = requests.listQuestions({ caller, pageSize: 2 });
    db.prepare("DELETE FROM question_revisions WHERE question_id = ?").run("cursor-0");
    db.prepare("DELETE FROM questions WHERE question_id = ?").run("cursor-0");
    db.prepare("DELETE FROM ask_requests WHERE request_id = ?").run("cursor-0");
    const second = requests.listQuestions({ caller, pageSize: 2, cursor: first.nextCursor });
    expect(second.questions.map((question) => question.questionId)).toEqual(["cursor-2"]);
    expect(() => requests.listQuestions({ caller: { ...caller, feature: "other" }, pageSize: 2, cursor: first.nextCursor })).toThrow(/another query/i);
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

  it("returns complete latest Question data for every explicit ID without Answer content or truncating large payloads", () => {
    const { requests, create } = setup();
    const largeContext = "large-context-".repeat(1_000);
    for (let index = 0; index < 31; index += 1) create("current", `detail-${index}`, `Question ${index}`, index === 30 ? largeContext : `context-${index}`);
    requests.answer("detail-0", { selectedValues: ["yes"], note: "must not leak", rationale: "also secret" });
    const discovery = requests as RequestStore & { getQuestions(input: { questionIds: string[] }): unknown[] };

    const details = discovery.getQuestions({ questionIds: Array.from({ length: 31 }, (_, index) => `detail-${index}`) }) as Array<Record<string, unknown>>;
    expect(details).toHaveLength(31);
    expect(details[30]).toMatchObject({
      questionId: "detail-30",
      revision: 1,
      question: { prompt: "Question 30", context: largeContext },
      options: [{ value: "yes", label: "Yes", description: "description", meaning: "meaning", context: "option context" }],
      context: { codebaseContext: largeContext, problemContext: "problem" }
    });
    expect(JSON.stringify(details)).not.toContain("must not leak");
    expect(JSON.stringify(details)).not.toContain("also secret");
    expect(details[0]).toMatchObject({ answerId: expect.any(String), answerRead: false });
    expect(details[0]).not.toHaveProperty("answer");
    expect(details[0]).not.toHaveProperty("selectedValues");
    expect((details[30].question as { context: string }).context).toHaveLength(largeContext.length);
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
