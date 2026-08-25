import { afterEach, describe, expect, it } from "vitest";
import postboxExtension from "../src/index.js";
import {
  WRITE_QUESTION_ACTIONS,
  normalizeWriteQuestionResult,
  toAskPostboxInput,
  toQuestionUpdateRequest,
  writeQuestionParameters
} from "../src/tools/writeQuestion.js";

const shutdownHandlers: Array<(event: unknown, ctx: Record<string, unknown>) => unknown> = [];

afterEach(async () => {
  await Promise.all(shutdownHandlers.splice(0).map((handler) => Promise.resolve(handler(
    { reason: "quit" },
    { cwd: process.cwd() }
  ))));
});

describe("Question write tool contract", () => {
  it("replaces ask_postbox and update_question with one compact flat interface", () => {
    const tools = new Map<string, any>();
    postboxExtension({
      on(event, handler) {
        if (event === "session_shutdown") shutdownHandlers.push(handler);
      },
      registerTool(definition: unknown) {
        const tool = definition as { name: string };
        tools.set(tool.name, definition);
      },
      registerCommand: () => undefined
    });

    expect(tools.has("write_question")).toBe(true);
    expect(tools.has("ask_postbox")).toBe(false);
    expect(tools.has("update_question")).toBe(false);

    const tool = tools.get("write_question");
    expect(tool.annotations).toEqual({ readOnlyHint: false });
    expect(tool.promptGuidelines.join(" ")).toMatch(/create.*durable persistence.*questionId.*revision.*ownerRevision/i);
    expect(tool.promptGuidelines.join(" ")).toMatch(/do not poll.*get_answer.*list_question_status.*list_questions/i);
    expect(tool.promptGuidelines.join(" ")).toMatch(/only blocker.*wait_for_postbox.*once/i);
    expect(tool.parameters).toBe(writeQuestionParameters);
    expect(tool.parameters).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["action"]
    });
    expect(tool.parameters).not.toHaveProperty("oneOf");
    expect(tool.parameters.properties.action.enum).toEqual(WRITE_QUESTION_ACTIONS);
    expect(tool.parameters.properties).not.toHaveProperty("update");
    expect(Object.keys(tool.parameters.properties)).toEqual(expect.arrayContaining([
      "questionId", "question", "ambiguity", "options", "questions",
      "expectedRevision", "expectedOwnerRevision", "replacementQuestionId",
      "parentQuestionId", "expectedOwner", "owner"
    ]));
    expect(JSON.stringify(tool.parameters).length).toBeLessThan(4_000);
  });

  it("maps flat create and revise calls onto the existing strict internal commands", () => {
    expect(toAskPostboxInput({
      action: "create",
      question: "Ship now?",
      ambiguity: "Whether speed outweighs staged-risk reduction.",
      options: [{ value: "yes", label: "Ship" }],
      requestId: "question-create"
    })).toEqual({
      question: "Ship now?",
      ambiguity: "Whether speed outweighs staged-risk reduction.",
      options: [{ value: "yes", label: "Ship" }],
      requestId: "question-create"
    });

    expect(toQuestionUpdateRequest({
      action: "revise",
      questionId: "question-create",
      expectedRevision: 1,
      expectedOwnerRevision: 1,
      question: "Ship this release now?",
      ambiguity: "Whether speed outweighs the current release risk."
    })).toEqual({
      questionId: "question-create",
      update: {
        action: "revise",
        expectedRevision: 1,
        expectedOwnerRevision: 1,
        question: {
          prompt: "Ship this release now?",
          ambiguity: "Whether speed outweighs the current release risk."
        }
      }
    });
  });

  it("rejects fields belonging to a different action before dispatch", () => {
    expect(() => toQuestionUpdateRequest({
      action: "cancel",
      questionId: "question-create",
      expectedRevision: 1,
      expectedOwnerRevision: 1,
      question: "Unexpected content"
    })).toThrow(/cancel does not accept question/i);

    expect(() => toAskPostboxInput({
      action: "create",
      question: "Ship?",
      ambiguity: "Whether to ship.",
      options: [{ value: "yes", label: "Yes" }],
      expectedRevision: 1
    })).toThrow(/create does not accept expectedRevision/i);
  });

  it("returns a reusable current Question handle for single and batch creation", () => {
    expect(normalizeWriteQuestionResult("create", {
      questionId: "question-create",
      revision: 2,
      ownerRevision: 3,
      status: "pending",
      disposition: "idempotent"
    })).toEqual({
      action: "create",
      questionId: "question-create",
      revision: 2,
      ownerRevision: 3,
      status: "pending",
      disposition: "idempotent"
    });

    expect(normalizeWriteQuestionResult("create_batch", {
      status: "created",
      items: [{
        localRef: "first",
        status: "created",
        questionId: "question-first",
        revision: 1,
        ownerRevision: 1,
        questionStatus: "pending",
        disposition: "created"
      }]
    })).toEqual({
      action: "create_batch",
      batchStatus: "created",
      items: [{
        localRef: "first",
        questionId: "question-first",
        revision: 1,
        ownerRevision: 1,
        status: "pending",
        disposition: "created"
      }]
    });
  });
});
