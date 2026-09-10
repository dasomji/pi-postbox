import { describe, expect, it } from "vitest";
import { AskCreatePayloadSchema, AskRequestSnapshotSchema, QuestionImagesSchema, QuestionRevisionSnapshotSchema, StagedQuestionImagesSchema, LocalQuestionImageSchema } from "./index.js";

describe("bounded Question image protocol", () => {
  it("keeps model paths distinct from staged wire references and public metadata", () => {
    const local = { path: "/private/file.png", alt: "Evidence" };
    expect(LocalQuestionImageSchema.safeParse(local).success).toBe(true);
    expect(StagedQuestionImagesSchema.safeParse([local]).success).toBe(false);
    expect(QuestionImagesSchema.safeParse([local]).success).toBe(false);
    expect(LocalQuestionImageSchema.safeParse({ ...local, alt: " \n " }).success).toBe(false);
    expect(LocalQuestionImageSchema.safeParse({ ...local, caption: "a".repeat(2001) }).success).toBe(false);
    const reference = { uploadId: "12345678-1234-4123-8123-123456789abc", alt: "Evidence" };
    expect(StagedQuestionImagesSchema.safeParse(Array(9).fill(reference)).success).toBe(false);
  });
  it("defaults pre-image current and revision snapshots to empty galleries", () => {
    const owner = { harness: "pi", ownerId: "test" };
    const content = { question: { prompt: "A question" }, options: [{ value: "yes", label: "Yes" }] };
    expect(QuestionRevisionSnapshotSchema.parse({ ...content, revision: 1, actor: owner, at: "2026-09-07T00:00:00.000Z" }).images).toEqual([]);
    expect(AskRequestSnapshotSchema.parse({ ...content, requestId: "q", sessionId: "s", revision: 1, creator: owner, owner, mode: "single", status: "pending", createdAt: "2026-09-07T00:00:00.000Z" }).images).toEqual([]);
  });
});
