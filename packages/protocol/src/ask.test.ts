import { describe, expect, it } from "vitest";
import { AskCreatePayloadSchema, AskResultSchema, StateSnapshotSchema } from "./index.js";

describe("ask_postbox protocol", () => {
  it("accepts a single-choice ask payload and rejects empty options", () => {
    const payload = AskCreatePayloadSchema.parse({
      requestId: "ask-1",
      sessionId: "session-1",
      mode: "single",
      question: { prompt: "Choose a framework" },
      options: [{ value: "fastify", label: "Fastify" }]
    });

    expect(payload.options[0]?.value).toBe("fastify");
    expect(() =>
      AskCreatePayloadSchema.parse({
        requestId: "ask-2",
        sessionId: "session-1",
        mode: "multi",
        question: { prompt: "Choose options" },
        options: []
      })
    ).toThrow();
  });

  it("normalizes answered, cancelled, expired, and unavailable terminal results", () => {
    expect(
      AskResultSchema.parse({
        status: "answered",
        requestId: "ask-1",
        selectedValues: ["a", "b"],
        note: "ship it",
        rationale: "covers the use case",
        resolvedAt: "2026-06-03T00:00:00.000Z"
      })
    ).toMatchObject({ status: "answered", selectedValues: ["a", "b"] });

    expect(
      AskResultSchema.parse({
        status: "cancelled",
        requestId: "ask-1",
        resolvedAt: "2026-06-03T00:00:00.000Z"
      })
    ).toMatchObject({ status: "cancelled" });

    expect(
      AskResultSchema.parse({
        status: "expired",
        requestId: "ask-1",
        rationale: "No answer before timeout",
        resolvedAt: "2026-06-03T00:00:00.000Z"
      })
    ).toMatchObject({ status: "expired", requestId: "ask-1" });

    expect(
      AskResultSchema.parse({
        status: "unavailable",
        requestId: "ask-1",
        rationale: "Server unavailable",
        resolvedAt: "2026-06-03T00:00:00.000Z"
      })
    ).toMatchObject({ status: "unavailable", requestId: "ask-1" });
  });

  it("allows state snapshots to include pending request cards", () => {
    const snapshot = StateSnapshotSchema.parse({
      sessions: [],
      requests: [
        {
          requestId: "ask-1",
          sessionId: "session-1",
          mode: "single",
          question: { prompt: "What next?" },
          options: [{ value: "continue", label: "Continue" }],
          status: "pending",
          createdAt: "2026-06-03T00:00:00.000Z"
        }
      ],
      timestamp: "2026-06-03T00:00:01.000Z"
    });

    expect(snapshot.requests).toHaveLength(1);
  });

  it("preserves rich interviewer handoff context and fork references in request snapshots", () => {
    const payload = AskCreatePayloadSchema.parse({
      requestId: "ask-rich",
      sessionId: "session-1",
      mode: "single",
      question: {
        prompt: "Which persistence strategy should we use?",
        context: "The server must survive restarts without losing decisions.",
        relevance: "This choice defines the storage boundary for v1.",
        decisionImpact: "It affects migrations, deployment, and future history queries."
      },
      options: [
        {
          value: "sqlite",
          label: "SQLite",
          description: "Use a local SQLite database.",
          meaning: "Best fit for a personal Tailscale service.",
          context: "Keeps deployment simple and supports history queries."
        }
      ],
      context: {
        codebaseContext: "Fastify app with shared Zod protocol schemas.",
        problemContext: "Need durable request records without streaming chats.",
        additionalInfo: [
          { kind: "code", title: "Schema seam", content: "AskCreatePayloadSchema", language: "ts" },
          { kind: "diagram", title: "Flow", content: "Pi -> Server -> Browser -> Pi" }
        ]
      },
      forkReference: {
        agentSessionId: "native-session-1",
        agentSessionPath: "/tmp/pi-session.jsonl",
        leafId: "leaf-123",
        cwd: "/repo",
        model: "gpt-5.5"
      }
    });

    expect(payload.question.relevance).toContain("storage boundary");
    expect(payload.options[0]?.meaning).toContain("personal Tailscale");
    expect(payload.context?.additionalInfo?.[0]).toMatchObject({ kind: "code", language: "ts" });
    expect(payload.forkReference).toMatchObject({ leafId: "leaf-123", model: "gpt-5.5" });

    const snapshot = StateSnapshotSchema.parse({
      sessions: [],
      requests: [
        {
          ...payload,
          status: "pending",
          createdAt: "2026-06-03T00:00:00.000Z"
        }
      ],
      timestamp: "2026-06-03T00:00:01.000Z"
    });

    expect(snapshot.requests[0]?.context?.codebaseContext).toContain("Fastify");
    expect(snapshot.requests[0]?.forkReference?.agentSessionPath).toBe("/tmp/pi-session.jsonl");
  });
});
