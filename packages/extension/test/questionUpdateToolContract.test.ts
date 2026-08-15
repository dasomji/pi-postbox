import { afterEach, describe, expect, it } from "vitest";
import postboxExtension from "../src/index.js";

const shutdownHandlers: Array<(event: unknown, ctx: Record<string, unknown>) => unknown> = [];

afterEach(async () => {
  await Promise.all(shutdownHandlers.splice(0).map((handler) => Promise.resolve(handler(
    { reason: "quit" },
    { cwd: process.cwd() }
  ))));
});

describe("Question update concurrency tool contract", () => {
  it("requires separate content and owner revisions for every update action", () => {
    let updateTool: {
      description: string;
      parameters: { properties: { update: { oneOf: Array<{ required: string[]; properties: Record<string, unknown> }> } } };
    } | undefined;
    postboxExtension({
      on(event, handler) {
        if (event === "session_shutdown") shutdownHandlers.push(handler);
      },
      registerTool(definition: unknown) {
        const tool = definition as typeof updateTool & { name: string };
        if (tool?.name === "update_question") updateTool = tool;
      },
      registerCommand: () => undefined
    });

    expect(updateTool?.description).toMatch(/separate content and owner concurrency revisions/i);
    const variants = updateTool?.parameters.properties.update.oneOf ?? [];
    expect(variants).toHaveLength(6);
    for (const variant of variants) {
      expect(variant.required).toEqual(expect.arrayContaining(["expectedRevision", "expectedOwnerRevision"]));
      expect(variant.properties.expectedRevision).toMatchObject({ type: "integer", minimum: 1 });
      expect(variant.properties.expectedOwnerRevision).toMatchObject({ type: "integer", minimum: 1 });
    }
  });
});
