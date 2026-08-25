import type { AskCreatePayload } from "@pi-postbox/protocol";
import { describe, expect, it } from "vitest";
import {
  askPostboxParameters,
  createAskPayload,
  executeAskPostbox,
  formatAskResult,
  type AskPostboxInput
} from "../src/tools/askPostbox.js";

describe("ask_postbox tool", () => {
  it("returns a pending Question receipt without waiting for the human Answer", async () => {
    let acknowledge!: () => void;
    const client = {
      createAsk: (payload: AskCreatePayload) => new Promise<never>((resolve) => {
        acknowledge = () => resolve({ questionId: payload.requestId, revision: 1, status: "pending" } as never);
      })
    };

    const result = await Promise.race([
      executeAskPostbox(
        {
          requestId: "question-async-1",
          question: "Ship the release?",
          ambiguity: "Whether the release is ready to ship.",
          options: [{ value: "ship", label: "Ship" }]
        },
        client,
        "pi-control-session"
      ),
      new Promise<"still-waiting">((resolve) => setTimeout(() => resolve("still-waiting"), 20))
    ]);
    expect(result).toBe("still-waiting");
    acknowledge();
    await expect(executeAskPostbox({
      requestId: "question-async-2", question: "Ship?", ambiguity: "Whether to ship now.", options: [{ value: "yes", label: "Yes" }]
    }, { createAsk: async (payload) => ({ questionId: payload.requestId, revision: 1, status: "pending" }) }, "pi-control-session")).resolves.toEqual({
      questionId: "question-async-2",
      revision: 1,
      status: "pending"
    });
  });

  it("does not expose or manufacture the removed urgency compatibility field", () => {
    const baseInput = {
      requestId: "ask-urgent",
      question: "Which request should be answered first?",
      ambiguity: "Which pending request should receive attention first.",
      options: [{ value: "this-one", label: "This one" }]
    };

    expect(askPostboxParameters.properties).not.toHaveProperty("urgency");
    expect(createAskPayload({ ...baseInput, urgency: "high" } as AskPostboxInput, "session-1")).not.toHaveProperty("urgency");
    expect(createAskPayload(baseInput, "session-1")).not.toHaveProperty("urgency");
  });

  it("does not expose the removed top-level handoff context", () => {
    expect(askPostboxParameters.oneOf[0].required).not.toContain("context");
    expect(askPostboxParameters.properties).not.toHaveProperty("context");
    expect(createAskPayload({
      requestId: "ask-without-context",
      question: "Choose deployment target",
      ambiguity: "Which deployment target should host Postbox.",
      options: [{ value: "local", label: "Local" }]
    }, "session-1")).not.toHaveProperty("context");
  });

  it("builds single-choice ask payloads for the active session", () => {
    const payload = createAskPayload(
      {
        requestId: "ask-1",
        question: "Choose deployment target",
        ambiguity: "Which deployment target should host Postbox.",
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
      question: { prompt: "Choose deployment target", ambiguity: "Which deployment target should host Postbox." }
    });
  });

  it("waits for the client ask result and returns concise normalized answer data", async () => {
    let sentPayload: AskCreatePayload | undefined;
    const client = {
      createAsk: async (payload: AskCreatePayload) => {
        sentPayload = payload;
        return { questionId: payload.requestId, revision: 1, status: "pending" as const };
      }
    };

    const result = await executeAskPostbox(
      {
        requestId: "ask-multi",
        mode: "multi",
        question: "Which metadata should be displayed?",
        ambiguity: "Which metadata is useful without cluttering the dashboard.",
        options: [
          { value: "branch", label: "Branch" },
          { value: "machine", label: "Machine" }
        ]
      },
      client,
      "session-1"
    );

    expect(sentPayload).toMatchObject({ requestId: "ask-multi", mode: "multi", sessionId: "session-1" });
    expect(result).toEqual({ questionId: "ask-multi", revision: 1, status: "pending" });
    expect(formatAskResult(result)).toContain("asynchronously");
  });

  it("accepts option detail and fork provenance while returning a compact result", async () => {
    let sentPayload: AskCreatePayload | undefined;
    const client = {
      createAsk: async (payload: AskCreatePayload) => {
        sentPayload = payload;
        return { questionId: payload.requestId, revision: 1, status: "pending" as const };
      }
    };

    const result = await executeAskPostbox(
      {
        requestId: "ask-rich",
        question: "Which storage should v1 use?",
        ambiguity: "Which storage provides durable records without unnecessary deployment complexity?",
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
            impact: "Simple durable local DB"
          }
        ]
      },
      client,
      "session-1"
    );

    expect(sentPayload).toMatchObject({
      question: {
        ambiguity: "Which storage provides durable records without unnecessary deployment complexity?"
      },
      options: [{ value: "sqlite", impact: "Simple durable local DB" }],
      forkReference: { leafId: "leaf-123" }
    });
    expect(result).toEqual({ questionId: "ask-rich", revision: 1, status: "pending" });
  });
});
