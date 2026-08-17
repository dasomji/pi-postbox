import { describe, expect, it } from "vitest";
import * as protocol from "./index.js";
import { ExtensionClientMessageSchema } from "./ws.js";

const context = { codebaseContext: "Postbox monorepo", problemContext: "Reduce repeated tool context." };
const batchMessage = {
  type: "ask.batch.create",
  requestId: "batch-1",
  payload: {
    sessionId: "session-1",
    defaults: { context },
    questions: [{
      localRef: "root",
      requestId: "question-root",
      mode: "single",
      question: { prompt: "Choose a rollout?" },
      options: [{ value: "staged", label: "Staged" }]
    }]
  }
} as const;

describe("output-reduction protocol", () => {
  it("carries required batch context defaults without repeating them on every Question", () => {
    expect(ExtensionClientMessageSchema.parse(batchMessage)).toEqual(batchMessage);
    expect(() => ExtensionClientMessageSchema.parse({
      ...batchMessage,
      payload: { sessionId: "session-1", questions: batchMessage.payload.questions }
    })).toThrow();
  });

  it("supports compact-by-default Question reads with an explicit full view", () => {
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
        options: [{ value: "yes", label: "Yes" }],
        context
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

  it("supports event-oriented history by default with an explicit full view", () => {
    const compact = {
      type: "question.history.get",
      requestId: "history-events",
      payload: { questionId: "question-root" }
    } as const;
    const full = {
      ...compact,
      requestId: "history-full",
      payload: { ...compact.payload, view: "full" }
    } as const;
    expect(ExtensionClientMessageSchema.parse(compact)).toEqual(compact);
    expect(ExtensionClientMessageSchema.parse(full)).toEqual(full);
    expect(() => ExtensionClientMessageSchema.parse({
      ...compact,
      payload: { ...compact.payload, view: "snapshots" }
    })).toThrow();
  });

  it("authorizes owner discovery through a caller-derived finite scope", () => {
    const message = {
      type: "owner.list",
      requestId: "owners-feature",
      payload: { sessionId: "session-1", scope: "feature" }
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
