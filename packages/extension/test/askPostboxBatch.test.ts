import { describe, expect, it, vi } from "vitest";
import { askPostboxParameters, executeAskPostbox, formatAskResult } from "../src/tools/askPostbox.js";

const draft = {
  localRef: "root",
  requestId: "question-root",
  question: "Choose a rollout?",
  ambiguity: "Which rollout should be used?",
  options: [{ value: "blue", label: "Blue" }]
};

describe("ask_postbox ordered batches", () => {
  it("documents the hard hierarchy limits and exposes strict single/batch modes", () => {
    const schema = askPostboxParameters as Record<string, any>;
    expect(schema.oneOf).toHaveLength(2);
    expect(JSON.stringify(schema)).toMatch(/five (?:direct )?children/i);
    expect(JSON.stringify(schema)).toMatch(/four levels/i);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toBeUndefined();
    expect(schema.oneOf[0]).toMatchObject({ additionalProperties: false, required: ["question", "ambiguity", "options"] });
    expect(schema.oneOf[1]).toMatchObject({ additionalProperties: false, required: ["mode", "questions"] });
    expect(schema.oneOf[0].properties).not.toHaveProperty("questions");
    expect(schema.oneOf[0].properties).not.toHaveProperty("defaults");
    expect(schema.oneOf[1].properties).not.toHaveProperty("requestId");
    expect(schema.oneOf[1].properties).not.toHaveProperty("timeoutMs");
    expect(schema.properties).not.toHaveProperty("defaults");
    expect(schema.properties).not.toHaveProperty("context");
    expect(schema.properties.options.items.properties).not.toHaveProperty("context");
    expect(schema.properties.options.items.properties).not.toHaveProperty("meaning");
    expect(schema.properties.questions.items.properties.options.items.properties).not.toHaveProperty("context");
    expect(schema.properties.questions.items.required).toEqual(["localRef", "question", "ambiguity", "options"]);
    expect(schema.properties.questions.items.properties.parentQuestionId.type).toBe("string");
    expect(schema.properties.questions.items.properties.parentLocalRef.type).toBe("string");
    expect(schema.properties.parentQuestionId.type).toBe("string");
    expect(schema.properties).not.toHaveProperty("parentLocalRef");
    expect(schema.properties).not.toHaveProperty("parent");
    expect(schema.properties).not.toHaveProperty("forkReference");
    expect(schema.properties).not.toHaveProperty("expiresAt");
    expect(schema.oneOf[0].properties).not.toHaveProperty("forkReference");
    expect(schema.oneOf[0].properties).not.toHaveProperty("expiresAt");
    expect(schema.properties.questions.items.properties).not.toHaveProperty("forkReference");
    expect(schema.properties.questions.items.properties).not.toHaveProperty("expiresAt");
    expect(schema.properties).not.toHaveProperty("timeoutMs");
    expect(schema.properties.questions.items.properties).not.toHaveProperty("timeoutMs");
    expect(JSON.stringify(schema).length).toBeLessThan(5_100);
  });

  it("describes every single and nested batch field for the model", () => {
    const schema = askPostboxParameters as Record<string, any>;
    const expectDescriptions = (properties: Record<string, any>) => {
      for (const [name, field] of Object.entries(properties)) {
        expect(field.description, `${name} needs a model-facing description`).toEqual(expect.any(String));
      }
    };

    expectDescriptions(schema.properties);
    expectDescriptions(schema.properties.options.items.properties);
    expectDescriptions(schema.properties.questions.items.properties);
    expectDescriptions(schema.properties.questions.items.properties.options.items.properties);
    expectDescriptions(schema.oneOf[0].properties);
    expectDescriptions(schema.oneOf[1].properties);
    expect(schema.properties.ambiguity.description).toBe("What ambiguity is this question aiming to solve?");
    expect(schema.properties.options.items.properties.impact.description)
      .toBe("What impact and implications would this option have?");
  });

  it("rejects single-Question fields at the batch execution boundary instead of silently ignoring them", async () => {
    const createAskBatch = vi.fn();
    await expect((executeAskPostbox as any)({
      mode: "batch",
      requestId: "not-a-batch-idempotency-key",
      questions: [draft]
    }, { createAskBatch }, "session-1")).rejects.toThrow(/requestId.*batch|batch.*requestId/i);
    expect(createAskBatch).not.toHaveBeenCalled();
  });

  it("sends an ordered batch once and returns every created and rejected receipt", async () => {
    const input = {
      mode: "batch",
      questions: [draft, { ...draft, localRef: "child", requestId: "question-child", parentLocalRef: "root" }]
    };
    const receipt = {
      status: "partial",
      items: [
        { localRef: "root", status: "created", questionId: "question-root", revision: 1, disposition: "created" },
        { localRef: "child", status: "rejected", reason: { code: "child_limit_reached", message: "Parent already has five children." } }
      ]
    };
    const createAskBatch = vi.fn(async () => receipt);

    await expect((executeAskPostbox as any)(input, { createAskBatch }, "session-1")).resolves.toEqual(receipt);
    expect(createAskBatch).toHaveBeenCalledOnce();
    expect(createAskBatch.mock.calls[0]?.[0]).toMatchObject({
      sessionId: "session-1",
      questions: [
        expect.objectContaining({ localRef: "root", requestId: "question-root" }),
        expect.objectContaining({ localRef: "child" })
      ]
    });
    expect(JSON.parse(formatAskResult(receipt as any).replace(/^Postbox batch partial: /, ""))).toEqual([
      { localRef: "root", questionId: "question-root", revision: 1, disposition: "created" },
      { localRef: "child", disposition: "rejected", reason: "child_limit_reached" }
    ]);
  });

  it("returns compact ordered mappings for generated and caller-provided Question IDs", async () => {
    const { requestId: _requestId, ...withoutRequestId } = draft;
    const createAskBatch = vi.fn(async (payload: { questions: Array<{ localRef: string; requestId: string }> }) => ({
      status: "created" as const,
      items: payload.questions.map((question) => ({
        localRef: question.localRef,
        status: "created" as const,
        questionId: question.requestId,
        revision: 1,
        disposition: "created" as const
      }))
    }));

    const result = await (executeAskPostbox as any)({
      mode: "batch",
      questions: [
        { ...withoutRequestId, localRef: "generated" },
        { ...draft, localRef: "provided", requestId: "caller-question-id" }
      ]
    }, { createAskBatch }, "session-1");
    const generatedId = result.items[0].questionId as string;
    expect(generatedId).toMatch(/^ask_[0-9a-f-]{36}$/);
    expect(result.items.map((item: { localRef: string; questionId: string }) => [item.localRef, item.questionId])).toEqual([
      ["generated", generatedId],
      ["provided", "caller-question-id"]
    ]);

    const prefix = "Postbox batch created: ";
    const formatted = formatAskResult(result);
    expect(formatted.startsWith(prefix)).toBe(true);
    expect(JSON.parse(formatted.slice(prefix.length))).toEqual([
      { localRef: "generated", questionId: generatedId, revision: 1, disposition: "created" },
      { localRef: "provided", questionId: "caller-question-id", revision: 1, disposition: "created" }
    ]);
    expect(formatted.length).toBeLessThan(400);
  });

  it("retains internal absolute-expiry and fork-provenance compatibility outside the model-facing schema", async () => {
    const createAsk = vi.fn(async (payload) => ({ questionId: payload.requestId, revision: 1, status: "pending" as const }));
    await (executeAskPostbox as any)({ ...draft, parentQuestionId: "existing-parent",
      expiresAt: "2026-08-19T12:00:00.000Z",
      forkReference: { agentSessionId: "session-source", leafId: "leaf-source" } }, { createAsk }, "session-1");
    expect(createAsk).toHaveBeenCalledWith(expect.objectContaining({
      parentQuestionId: "existing-parent",
      expiresAt: "2026-08-19T12:00:00.000Z",
      forkReference: { agentSessionId: "session-source", leafId: "leaf-source" }
    }), undefined);
  });
});
