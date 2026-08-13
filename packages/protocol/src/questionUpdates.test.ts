import { describe, expect, it } from "vitest";
import * as protocol from "./index.js";

describe("Question update contract", () => {
  it("exposes only strict revision, cancellation, supersession, and reparent actions", () => {
    const schema = (protocol as Record<string, any>).UpdateQuestionPayloadSchema;
    expect(schema).toBeDefined();
    expect(schema.safeParse({ action: "revise", expectedRevision: 2, question: { prompt: "Updated?" } }).success).toBe(true);
    expect(schema.safeParse({ action: "cancel", expectedRevision: 2, rationale: "No longer relevant" }).success).toBe(true);
    expect(schema.safeParse({ action: "supersede", expectedRevision: 2, replacementQuestionId: "replacement" }).success).toBe(true);
    expect(schema.safeParse({ action: "reparent", expectedRevision: 2, parentQuestionId: "new-parent" }).success).toBe(true);
    expect(schema.safeParse({ action: "patch", expectedRevision: 2, status: "answered" }).success).toBe(false);
    expect(schema.safeParse({ action: "cancel", expectedRevision: 2, extra: true }).success).toBe(false);
    expect(schema.safeParse({ action: "revise", question: { prompt: "Missing concurrency guard" } }).success).toBe(false);
  });

  it("describes history as explicit actor and timestamp facts without Answer content", () => {
    const schema = (protocol as Record<string, any>).QuestionHistorySchema;
    expect(schema).toBeDefined();
    const result = schema.parse({ questionId: "question", events: [
      { type: "revision", revision: 2, actor: { harness: "pi", ownerId: "agent" }, at: "2026-08-13T12:00:00.000Z", changes: ["question.prompt"] },
      { type: "parent_changed", revision: 3, actor: { harness: "pi", ownerId: "agent" }, at: "2026-08-13T12:01:00.000Z", parentQuestionId: "parent" },
      { type: "superseded", revision: 4, actor: { harness: "pi", ownerId: "agent" }, at: "2026-08-13T12:02:00.000Z", replacementQuestionId: "replacement" }
    ] });
    expect(JSON.stringify(result)).not.toMatch(/selectedValues|note|rationale/i);
  });
});
