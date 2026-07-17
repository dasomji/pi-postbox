import type { AskCreatePayload, AskResult } from "@pi-postbox/protocol";
import { describe, expect, it } from "vitest";
import {
  askPostboxParameters,
  createAskPayload,
  executeAskPostbox,
  formatAskResult,
  type AskPostboxInput
} from "../src/tools/askPostbox.js";

describe("ask_postbox tool", () => {
  it("reports which required interviewer context field is missing or blank", () => {
    const baseInput = {
      requestId: "ask-invalid-context",
      question: "Choose deployment target",
      options: [{ value: "local", label: "Local" }]
    };

    expect(() =>
      createAskPayload(
        { ...baseInput, context: { problemContext: "Choose where the Postbox Server should run." } } as AskPostboxInput,
        "session-1"
      )
    ).toThrow("ask_postbox requires non-blank codebaseContext");
    expect(() =>
      createAskPayload(
        { ...baseInput, context: { codebaseContext: "Node.js Postbox Server.", problemContext: "  \n" } },
        "session-1"
      )
    ).toThrow("ask_postbox requires non-blank problemContext");
    expect(askPostboxParameters.required).toContain("context");
    expect(askPostboxParameters.properties.context.required).toEqual(["codebaseContext", "problemContext"]);
  });

  it("builds single-choice ask payloads for the active session", () => {
    const payload = createAskPayload(
      {
        requestId: "ask-1",
        question: "Choose deployment target",
        context: {
          codebaseContext: "TypeScript extension that sends asks through the shared protocol.",
          problemContext: "Choose where the Postbox Server should be deployed."
        },
        options: [
          { value: "local", label: "Local" },
          { value: "remote", label: "Remote" }
        ]
      },
      "session-1"
    );

    expect(payload).toMatchObject({
      requestId: "ask-1",
      sessionId: "session-1",
      mode: "single",
      question: { prompt: "Choose deployment target" }
    });
  });

  it("waits for the client ask result and returns concise normalized answer data", async () => {
    let sentPayload: AskCreatePayload | undefined;
    const client = {
      ask: async (payload: AskCreatePayload): Promise<AskResult> => {
        sentPayload = payload;
        return {
          status: "answered",
          requestId: payload.requestId,
          selectedValues: ["branch", "machine"],
          note: "Show both",
          rationale: "Disambiguates worktrees",
          resolvedAt: "2026-06-03T00:00:00.000Z"
        };
      }
    };

    const result = await executeAskPostbox(
      {
        requestId: "ask-multi",
        mode: "multi",
        question: "Which metadata should be displayed?",
        context: {
          codebaseContext: "TypeScript extension and Svelte dashboard.",
          problemContext: "Choose which session metadata the dashboard should display."
        },
        options: [
          { value: "branch", label: "Branch" },
          { value: "machine", label: "Machine" }
        ]
      },
      client,
      "session-1"
    );

    expect(sentPayload).toMatchObject({ requestId: "ask-multi", mode: "multi", sessionId: "session-1" });
    expect(result).toEqual({
      status: "answered",
      requestId: "ask-multi",
      selectedValues: ["branch", "machine"],
      note: "Show both",
      rationale: "Disambiguates worktrees",
      resolvedAt: "2026-06-03T00:00:00.000Z"
    });
    expect(formatAskResult(result)).toContain("branch, machine");
  });

  it("accepts rich handoff input while stripping rich context from the final tool result", async () => {
    let sentPayload: AskCreatePayload | undefined;
    const client = {
      ask: async (payload: AskCreatePayload): Promise<AskResult> => {
        sentPayload = payload;
        return {
          status: "answered",
          requestId: payload.requestId,
          selectedValues: ["sqlite"],
          note: "Use SQLite",
          rationale: "Durable and simple",
          resolvedAt: "2026-06-03T00:00:00.000Z",
          context: payload.context,
          forkReference: payload.forkReference
        } as AskResult;
      }
    };

    const result = await executeAskPostbox(
      {
        requestId: "ask-rich",
        question: "Which storage should v1 use?",
        questionContext: "Server needs durable request records.",
        relevance: "This affects the persistence seam.",
        decisionImpact: "It controls migration and history design.",
        context: {
          codebaseContext: "Fastify + SQLite server package.",
          problemContext: "Remote asks must preserve decision context for a future interviewer.",
          additionalInfo: [{ kind: "code", title: "Route", content: "POST /api/requests/:id/answer", language: "ts" }]
        },
        forkReference: {
          agentSessionId: "native-session-1",
          agentSessionPath: "/tmp/session.jsonl",
          leafId: "leaf-123",
          cwd: "/repo",
          model: "gpt-5.5"
        },
        options: [
          {
            value: "sqlite",
            label: "SQLite",
            meaning: "Simple durable local DB",
            context: "Matches the Tailscale-only v1 deployment."
          }
        ]
      },
      client,
      "session-1"
    );

    expect(sentPayload).toMatchObject({
      question: {
        context: "Server needs durable request records.",
        relevance: "This affects the persistence seam.",
        decisionImpact: "It controls migration and history design."
      },
      options: [{ value: "sqlite", meaning: "Simple durable local DB" }],
      context: { codebaseContext: "Fastify + SQLite server package." },
      forkReference: { leafId: "leaf-123" }
    });
    expect(result).toEqual({
      status: "answered",
      requestId: "ask-rich",
      selectedValues: ["sqlite"],
      note: "Use SQLite",
      rationale: "Durable and simple",
      resolvedAt: "2026-06-03T00:00:00.000Z"
    });
  });
});
