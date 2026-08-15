import { afterEach, describe, expect, it } from "vitest";
import postboxExtension from "../src/index.js";

const shutdownHandlers: Array<(event: unknown, ctx: Record<string, unknown>) => unknown> = [];

afterEach(async () => {
  await Promise.all(shutdownHandlers.splice(0).map((handler) => Promise.resolve(handler(
    { reason: "quit" },
    { cwd: process.cwd() }
  ))));
});

describe("Question list tool scope contract", () => {
  it("defaults both list tools to the current owner and exposes deliberate widening scopes", () => {
    const tools = new Map<string, {
      description: string;
      parameters: { properties: Record<string, unknown> };
    }>();
    postboxExtension({
      on(event, handler) {
        if (event === "session_shutdown") shutdownHandlers.push(handler);
      },
      registerTool(definition: unknown) {
        const tool = definition as {
          name: string;
          description: string;
          parameters: { properties: Record<string, unknown> };
        };
        tools.set(tool.name, tool);
      },
      registerCommand: () => undefined
    });

    const expectedScope = {
      type: "string",
      enum: ["owner", "feature", "worktree", "repository", "global"],
      description: "Discovery breadth. Defaults to the current owner; broader values deliberately include other owners."
    };
    for (const name of ["list_questions", "list_question_status"]) {
      const tool = tools.get(name);
      expect(tool?.description).toMatch(/defaults to Questions owned by the current Pi session/i);
      expect(tool?.parameters.properties.scope).toEqual(expectedScope);
    }
  });
});
