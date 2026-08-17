import { describe, expect, it } from "vitest";
import * as askProtocol from "./ask.js";

const draft = {
  localRef: "root",
  requestId: "question-root",
  mode: "single",
  question: { prompt: "Choose a rollout?" },
  options: [{ value: "blue", label: "Blue" }],
  context: { codebaseContext: "Deployment service", problemContext: "Choose a rollout." }
};

describe("ordered Question batch protocol", () => {
  it("keeps strict single drafts while allowing batch context to come from required defaults", () => {
    const protocol = askProtocol as Record<string, any>;
    const draftSchema = protocol.AskQuestionDraftSchema;
    const inputSchema = protocol.AskPostboxInputSchema;

    expect(draftSchema).toBeDefined();
    expect(inputSchema).toBeDefined();
    const defaults = { context: draft.context };
    const { context: _context, ...compactDraft } = draft;
    expect(draftSchema.safeParse({ ...draft, surprise: true }).success).toBe(false);
    expect(inputSchema.safeParse({ mode: "single", question: draft }).success).toBe(true);
    expect(inputSchema.safeParse({ mode: "batch", defaults, questions: [compactDraft, { ...compactDraft, localRef: "child", requestId: "question-child" }] }).success).toBe(true);
    expect(inputSchema.safeParse({ mode: "single", question: draft, questions: [draft] }).success).toBe(false);
    expect(inputSchema.safeParse({ mode: "batch", defaults, questions: [compactDraft], question: draft }).success).toBe(false);
  });

  it("requires unique local references and an unambiguous parent reference", () => {
    const schema = (askProtocol as Record<string, any>).AskPostboxInputSchema;
    expect(schema).toBeDefined();
    const defaults = { context: draft.context };
    expect(schema.safeParse({ mode: "batch", defaults, questions: [draft, { ...draft, requestId: "question-2" }] }).success).toBe(false);
    expect(schema.safeParse({ mode: "batch", defaults, questions: [draft, { ...draft, requestId: "question-2", parent: { questionId: "existing", localRef: "root" } }] }).success).toBe(false);
    expect(schema.safeParse({ mode: "batch", defaults, questions: [draft, { ...draft, localRef: "root", requestId: "question-2" }] }).success).toBe(false);
  });

  it("exposes hierarchy metadata, typed receipts, and affected descendant ids", () => {
    const protocol = askProtocol as Record<string, any>;
    expect(protocol.AskBatchReceiptSchema).toBeDefined();
    expect(protocol.AskBatchReceiptSchema.safeParse({
      status: "partial",
      items: [
        { localRef: "root", status: "created", questionId: "question-root", revision: 1, disposition: "created" },
        { localRef: "child", status: "rejected", reason: { code: "forward_parent_reference", message: "Parent must precede child." } }
      ]
    }).success).toBe(true);
    expect(protocol.AskBatchReceiptSchema.safeParse({
      status: "created",
      items: [{ localRef: "root", status: "created", questionId: "question-root", revision: 1 }]
    }).success).toBe(false);
    expect(protocol.AskAnswerEventSchema).toBeDefined();
    expect(protocol.AskAnswerEventSchema.safeParse({ questionId: "question-root", affectedDescendantIds: ["question-child", "question-grandchild"] }).success).toBe(true);

    const detail = {
      requestId: "question-child",
      sessionId: "session",
      revision: 1,
      ownerRevision: 1,
      creator: { harness: "pi", ownerId: "creator" },
      owner: { harness: "pi", ownerId: "owner" },
      mode: "single",
      question: { prompt: "Resolve child?" },
      options: [{ value: "yes", label: "Yes" }],
      status: "pending",
      createdAt: "2026-08-13T12:00:00.000Z",
      parentQuestionId: "question-root"
    };
    expect(protocol.AskRequestSnapshotSchema.safeParse(detail)).toMatchObject({
      success: true,
      data: { parentQuestionId: "question-root" }
    });
    const { parentQuestionId: _parentQuestionId, ...rootDetail } = detail;
    expect(protocol.AskRequestSnapshotSchema.safeParse(rootDetail).success).toBe(true);
  });
});
