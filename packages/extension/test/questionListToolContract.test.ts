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
    const expectedOwner = {
      type: "object",
      additionalProperties: false,
      required: ["harness", "ownerId"],
      description: "Exact owner identity; normally omit and use scope.",
      properties: {
        harness: { type: "string", minLength: 1, description: "Agent harness that owns the Question." },
        ownerId: { type: "string", minLength: 1, description: "Harness-neutral owner identifier." }
      }
    };
    for (const name of ["list_questions", "list_question_status"]) {
      const tool = tools.get(name);
      expect(tool?.description).toMatch(/defaults to Questions owned by the current Pi session/i);
      expect(tool?.parameters.properties.scope).toEqual(expectedScope);
      expect(tool?.parameters.properties.owner).toEqual(expectedOwner);
      expect(tool?.parameters.properties).not.toHaveProperty("global");
      expect(tool?.parameters.properties).not.toHaveProperty("repository");
      expect(tool?.parameters.properties).not.toHaveProperty("worktree");
      expect(tool?.parameters.properties).not.toHaveProperty("feature");
    }
    expect(tools.get("list_questions")?.parameters.properties.pageSize).toMatchObject({
      type: "integer", minimum: 1, maximum: 100
    });
    expect(tools.get("list_question_status")?.parameters.properties.pageSize).toMatchObject({
      type: "integer", minimum: 1, maximum: 50
    });
  });
});
