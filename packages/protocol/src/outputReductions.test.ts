import { describe, expect, it } from "vitest";
import * as protocol from "./index.js";
import { ExtensionClientMessageSchema } from "./ws.js";

const batchMessage = {
  type: "ask.batch.create",
  requestId: "batch-1",
  payload: {
    sessionId: "session-1",
    questions: [{
      localRef: "root",
      requestId: "question-root",
      mode: "single",
      question: { prompt: "Choose a rollout?", ambiguity: "Which rollout should be used?" },
      options: [{ value: "staged", label: "Staged" }]
    }]
  }
} as const;

describe("output-reduction protocol", () => {
  it("carries compact batch Questions without shared defaults", () => {
    expect(ExtensionClientMessageSchema.parse(batchMessage)).toEqual(batchMessage);
    expect(() => ExtensionClientMessageSchema.parse({
      ...batchMessage,
      payload: { ...batchMessage.payload, defaults: {} }
    })).toThrow();
  });

  it("supports compact-by-default Question reads with an explicit full view and bounded IDs", () => {
    const compact = {
      type: "questions.get",
      requestId: "details-compact",
      payload: { questionIds: ["question-root"] }
    } as const;
    const full = {
      ...compact,
      requestId: "details-full",
      payload: { ...compact.payload, view: "full" }
    } as const;
    expect(ExtensionClientMessageSchema.parse(compact)).toEqual(compact);
    expect(ExtensionClientMessageSchema.parse(full)).toEqual(full);
    expect(() => ExtensionClientMessageSchema.parse({
      ...compact,
      payload: { ...compact.payload, view: "everything" }
    })).toThrow();
    expect(() => ExtensionClientMessageSchema.parse({
      ...compact,
      payload: { questionIds: Array.from({ length: 21 }, (_, index) => `question-${index}`) }
    })).toThrow();
  });

  it("represents history as an initial snapshot, content-only revisions, and non-content events", () => {
    const schema = (protocol as Record<string, any>).QuestionEventHistorySchema;
    expect(schema).toBeDefined();
    const history = schema.parse({
      questionId: "question-root",
      initial: {
        revision: 1,
        actor: { harness: "pi", ownerId: "agent" },
        at: "2026-08-15T12:00:00.000Z",
        question: { prompt: "Original?" },
        options: [{ value: "yes", label: "Yes" }]
      },
      revisions: [{
        revision: 2,
        actor: { harness: "pi", ownerId: "agent" },
        at: "2026-08-15T12:01:00.000Z",
        question: { prompt: "Revised?" }
      }],
      events: [{
        type: "parent_changed",
        revision: 3,
        actor: { harness: "pi", ownerId: "agent" },
        at: "2026-08-15T12:02:00.000Z",
        parentQuestionId: null
      }]
    });
    expect(history.revisions[0]).not.toHaveProperty("options");
    expect(history.events.map((event: { type: string }) => event.type)).not.toContain("revision");
  });

  it("bounds and paginates compact Question status discovery", () => {
    const message = {
      type: "question.status.list",
      requestId: "status-page",
      payload: { sessionId: "session-1", scope: "feature", pageSize: 50, cursor: "opaque" }
    } as const;
    expect(ExtensionClientMessageSchema.parse(message)).toEqual(message);
    expect(() => ExtensionClientMessageSchema.parse({
      ...message,
      payload: { ...message.payload, pageSize: 51 }
    })).toThrow();
  });

  it("supports bounded paged history with event-oriented and full views", () => {
    const compact = {
      type: "question.history.get",
      requestId: "history-events",
      payload: { questionId: "question-root", pageSize: 50 }
    } as const;
    const full = {
      ...compact,
      requestId: "history-full",
      payload: { ...compact.payload, view: "full", cursor: "opaque" }
    } as const;
    expect(ExtensionClientMessageSchema.parse(compact)).toEqual(compact);
    expect(ExtensionClientMessageSchema.parse(full)).toEqual(full);
    expect(() => ExtensionClientMessageSchema.parse({
      ...compact,
      payload: { ...compact.payload, view: "snapshots" }
    })).toThrow();
    expect(() => ExtensionClientMessageSchema.parse({
      ...compact,
      payload: { ...compact.payload, pageSize: 51 }
    })).toThrow();
  });

  it("authorizes bounded owner discovery through a caller-derived finite scope", () => {
    const message = {
      type: "owner.list",
      requestId: "owners-feature",
      payload: { sessionId: "session-1", scope: "feature", includeInactive: true, pageSize: 100, cursor: "opaque" }
    } as const;
    expect(ExtensionClientMessageSchema.parse(message)).toEqual(message);
    for (const payload of [
      { sessionId: "session-1", scope: "global" },
      { sessionId: "session-1", scope: "feature", featureId: "arbitrary" }
    ]) {
      expect(() => ExtensionClientMessageSchema.parse({ ...message, payload })).toThrow();
    }

    const schema = (protocol as Record<string, any>).PostboxOwnerSummaryListSchema;
    expect(schema).toBeDefined();
    const result = schema.parse([{
      owner: { harness: "pi", ownerId: "agent-b" },
      presence: "live",
      activeQuestionCount: 0,
      unreadAnswerCount: 1
    }]);
    expect(Object.keys(result[0]).sort()).toEqual([
      "activeQuestionCount", "owner", "presence", "unreadAnswerCount"
    ]);
    expect(() => ExtensionClientMessageSchema.parse({
      type: "owner.status.get",
      requestId: "too-many-owners",
      payload: { owners: Array.from({ length: 21 }, (_, index) => ({ harness: "pi", ownerId: `agent-${index}` })) }
    })).toThrow();
    expect(() => ExtensionClientMessageSchema.parse({
      ...message,
      payload: { ...message.payload, pageSize: 101 }
    })).toThrow();
  });

  it("defines explicit current Answer and lifecycle evidence for full Question reads", () => {
    const schema = (protocol as Record<string, any>).QuestionResolutionSchema;
    expect(schema).toBeDefined();
    expect(schema.parse({
      kind: "answer",
      answerId: "answer-root",
      questionRevision: 2,
      answer: ["sqlite"],
      note: "Keep it local",
      resolvedAt: "2026-08-17T12:01:00.000Z",
      firstRead: { reader: { harness: "pi", ownerId: "agent" }, readAt: "2026-08-17T12:02:00.000Z" }
    })).toMatchObject({ kind: "answer", answer: ["sqlite"] });
    expect(schema.parse({
      kind: "lifecycle",
      status: "superseded",
      replacementQuestionId: "question-next",
      resolvedAt: "2026-08-17T12:01:00.000Z"
    })).toMatchObject({ kind: "lifecycle", status: "superseded" });
    expect(schema.safeParse({
      kind: "answer",
      answerId: "answer-root",
      questionRevision: 2,
      answer: ["sqlite"],
      rationale: "legacy",
      resolvedAt: "2026-08-17T12:01:00.000Z",
      firstRead: null
    }).success).toBe(false);
  });

  it("accepts only the compact normal Answer fields", () => {
    const compact = {
      questionId: "question-root",
      answerId: "answer-root",
      answer: ["sqlite"],
      note: "Keep it local"
    } as const;
    expect(protocol.AnswerReadResultSchema.parse(compact)).toEqual(compact);
    expect(Object.keys(compact).sort()).toEqual(["answer", "answerId", "note", "questionId"]);
    expect(() => protocol.AnswerReadResultSchema.parse({
      alreadyRead: false,
      question: {
        questionId: "question-root",
        revision: 1,
        mode: "single",
        question: { prompt: "Database?" },
        options: [{ value: "sqlite", label: "SQLite" }],
        createdAt: "2026-08-17T12:00:00.000Z",
        resolvedAt: "2026-08-17T12:01:00.000Z"
      },
      answer: {
        answerId: "answer-root",
        questionRevision: 1,
        status: "answered",
        selectedValues: ["sqlite"],
        createdAt: "2026-08-17T12:01:00.000Z"
      },
      firstRead: { reader: { harness: "pi", ownerId: "agent" }, readAt: "2026-08-17T12:01:01.000Z" }
    })).toThrow();
  });

  it("treats an unresolved Answer read as a normal compact result", () => {
    const pending = { type: "pending", status: "pending", questionId: "question-root" } as const;
    expect(protocol.AnswerReadResultSchema.parse(pending)).toEqual(pending);
    expect(protocol.ExtensionServerMessageSchema.parse({
      type: "answer.result",
      requestId: "answer-pending",
      payload: pending
    })).toEqual({
      type: "answer.result",
      requestId: "answer-pending",
      payload: pending
    });
  });
});
