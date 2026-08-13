import { describe, expect, it } from "vitest";
import * as Protocol from "./index.js";

describe("content-free Question telemetry contract", () => {
  it("records only lengths, aggregate sizes, batch/count dimensions, and Answer response sizes", () => {
    const schema = (Protocol as any).QuestionTelemetryEventSchema;
    expect(schema, "QuestionTelemetryEventSchema must be published for adapters and the server").toBeDefined();
    const event = schema.parse({ operation: "question.batch.create", questionLength: 42, questionContextLength: 12,
      relevanceLength: 13, decisionImpactLength: 14, optionValueLength: 15, optionLabelLength: 16,
      optionDescriptionLength: 17, optionMeaningLength: 18, optionContextLength: 19, noteLength: 4,
      rationaleLength: 5, contextSerializedBytes: 180, optionsSerializedBytes: 320,
      requestSerializedBytes: 400, batchSerializedBytes: 900, batchSize: 3, responseCharacterCount: 91, selectedIdCount: 2,
      answerResponseBytes: 144 });
    expect(event).toMatchObject({ operation: "question.batch.create", questionLength: 42, questionContextLength: 12,
      relevanceLength: 13, decisionImpactLength: 14, optionLabelLength: 16, optionMeaningLength: 18,
      requestSerializedBytes: 400, batchSerializedBytes: 900, batchSize: 3, answerResponseBytes: 144 });
    for (const contentField of ["question", "prompt", "context", "options", "answer", "note", "rationale", "transcript"]) {
      expect(schema.safeParse({ ...event, [contentField]: "private content" }).success, contentField).toBe(false);
    }
  });
});
