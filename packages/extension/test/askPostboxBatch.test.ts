import { describe, expect, it, vi } from "vitest";
import { askPostboxParameters, executeAskPostbox } from "../src/tools/askPostbox.js";

const draft = {
  localRef: "root",
  requestId: "question-root",
  question: "Choose a rollout?",
  options: [{ value: "blue", label: "Blue" }],
  context: { codebaseContext: "Deployment service", problemContext: "Choose a rollout." }
};

describe("ask_postbox ordered batches", () => {
  it("documents the hard hierarchy limits and exposes strict single/batch modes", () => {
    const schema = askPostboxParameters as Record<string, any>;
    expect(schema.oneOf).toHaveLength(2);
    expect(JSON.stringify(schema)).toMatch(/five (?:direct )?children/i);
    expect(JSON.stringify(schema)).toMatch(/four levels/i);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toBeUndefined();
    expect(schema.properties.questions.items.required).toEqual(["localRef", "question", "options", "context"]);
    expect(schema.properties.questions.items.properties.parent.oneOf).toHaveLength(2);
    expect(schema.properties.parent.required).toEqual(["questionId"]);
    expect(schema.properties.parent.properties.localRef).toBeUndefined();
    expect(schema.properties.questions.items.properties.forkReference).toEqual(schema.properties.forkReference);
  });

  it("sends an ordered batch once and returns every created and rejected receipt", async () => {
    const input = {
      mode: "batch",
      questions: [draft, { ...draft, localRef: "child", requestId: "question-child", parent: { localRef: "root" } }]
    };
    const receipt = {
      status: "partial",
      items: [
        { localRef: "root", status: "created", questionId: "question-root", revision: 1 },
        { localRef: "child", status: "rejected", reason: { code: "child_limit_reached", message: "Parent already has five children." } }
      ]
    };
    const createAskBatch = vi.fn(async () => receipt);

    await expect((executeAskPostbox as any)(input, { createAskBatch }, "session-1")).resolves.toEqual(receipt);
    expect(createAskBatch).toHaveBeenCalledOnce();
    expect(createAskBatch.mock.calls[0]?.[0].questions.map((item: any) => item.localRef)).toEqual(["root", "child"]);
  });

  it("maps a single existing parent Question ID and fork provenance into the create payload", async () => {
    const createAsk = vi.fn(async (payload) => ({ questionId: payload.requestId, revision: 1, status: "pending" as const }));
    await (executeAskPostbox as any)({ ...draft, parent: { questionId: "existing-parent" },
      forkReference: { agentSessionId: "session-source", leafId: "leaf-source" } }, { createAsk }, "session-1");
    expect(createAsk).toHaveBeenCalledWith(expect.objectContaining({
      parentQuestionId: "existing-parent",
      forkReference: { agentSessionId: "session-source", leafId: "leaf-source" }
    }), undefined);
  });
});
