import { describe, expect, it } from "vitest";
import { AnswerReadResultSchema, AskRequestSnapshotSchema } from "./index.js";

describe("lifecycle-only Question resolutions", () => {
  it.each([
    { type: "lifecycle", status: "cancelled", questionId: "question", note: "Obsolete", resolvedAt: "2026-08-15T12:01:00.000Z" },
    { type: "lifecycle", status: "expired", questionId: "question", note: "The response deadline passed.", resolvedAt: "2026-08-15T12:01:00.000Z" },
    { type: "lifecycle", status: "superseded", questionId: "question", replacementQuestionId: "replacement", resolvedAt: "2026-08-15T12:01:00.000Z" }
  ])("accepts a compact explicit $status get_answer result without repeated Question content", (result) => {
    expect(AnswerReadResultSchema.parse(result)).toEqual(result);
    expect(result).not.toHaveProperty("question");
    expect(result).not.toHaveProperty("answerId");
    expect(result).not.toHaveProperty("answer");
    expect(result).not.toHaveProperty("answerRead");
    expect(result).not.toHaveProperty("rationale");
  });

  it("forbids Answer metadata on lifecycle-only snapshots", () => {
    const snapshot = {
      requestId: "question",
      sessionId: "session",
      revision: 2,
      ownerRevision: 1,
      creator: { harness: "pi", ownerId: "agent" },
      owner: { harness: "pi", ownerId: "agent" },
      mode: "single" as const,
      question: { prompt: "Still needed?" },
      options: [{ value: "yes", label: "Yes" }],
      status: "superseded",
      createdAt: "2026-08-15T12:00:00.000Z",
      resolvedAt: "2026-08-15T12:01:00.000Z",
      parentQuestionId: "parent"
    };
    expect(AskRequestSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(AskRequestSnapshotSchema.safeParse({ ...snapshot, answerId: "not-a-human-answer", answerRead: true }).success).toBe(false);
  });
});
