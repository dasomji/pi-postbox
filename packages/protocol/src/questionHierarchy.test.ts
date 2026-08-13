import { describe, expect, it } from "vitest";
import * as askProtocol from "./ask.js";

const draft = {
  localRef: "root",
  requestId: "question-root",
  mode: "single",
  urgency: "normal",
  question: { prompt: "Choose a rollout?" },
  options: [{ value: "blue", label: "Blue" }],
  context: { codebaseContext: "Deployment service", problemContext: "Choose a rollout." }
};

describe("ordered Question batch protocol", () => {
  it("uses the same strict draft contract for single and batch creation", () => {
    const protocol = askProtocol as Record<string, any>;
    const draftSchema = protocol.AskQuestionDraftSchema;
    const inputSchema = protocol.AskPostboxInputSchema;

    expect(draftSchema).toBeDefined();
    expect(inputSchema).toBeDefined();
    expect(draftSchema.safeParse({ ...draft, surprise: true }).success).toBe(false);
    expect(inputSchema.safeParse({ mode: "single", question: draft }).success).toBe(true);
    expect(inputSchema.safeParse({ mode: "batch", questions: [draft, { ...draft, localRef: "child", requestId: "question-child" }] }).success).toBe(true);
    expect(inputSchema.safeParse({ mode: "single", question: draft, questions: [draft] }).success).toBe(false);
    expect(inputSchema.safeParse({ mode: "batch", questions: [draft], question: draft }).success).toBe(false);
  });

  it("requires unique local references and an unambiguous parent reference", () => {
    const schema = (askProtocol as Record<string, any>).AskPostboxInputSchema;
    expect(schema).toBeDefined();
    expect(schema.safeParse({ mode: "batch", questions: [draft, { ...draft, requestId: "question-2" }] }).success).toBe(false);
    expect(schema.safeParse({ mode: "batch", questions: [draft, { ...draft, requestId: "question-2", parent: { questionId: "existing", localRef: "root" } }] }).success).toBe(false);
    expect(schema.safeParse({ mode: "batch", questions: [draft, { ...draft, localRef: "root", requestId: "question-2" }] }).success).toBe(false);
  });

  it("exposes hierarchy metadata, typed receipts, and affected descendant ids", () => {
    const protocol = askProtocol as Record<string, any>;
    expect(protocol.AskBatchReceiptSchema).toBeDefined();
    expect(protocol.AskBatchReceiptSchema.safeParse({
      status: "partial",
      items: [
        { localRef: "root", status: "created", questionId: "question-root", revision: 1 },
        { localRef: "child", status: "rejected", reason: { code: "forward_parent_reference", message: "Parent must precede child." } }
      ]
    }).success).toBe(true);
    expect(protocol.AskAnswerEventSchema).toBeDefined();
    expect(protocol.AskAnswerEventSchema.safeParse({ questionId: "question-root", affectedDescendantIds: ["question-child", "question-grandchild"] }).success).toBe(true);
  });
});
