import { describe, expect, it } from "vitest";
import {
  AskCreatePayloadSchema,
  AskOptionSchema,
  AskResultSchema,
  ProposeAnswerPayloadSchema,
  ProposeAnswerResultSchema,
  StateSnapshotSchema
} from "./index.js";

describe("ask_postbox protocol", () => {
  it("keeps Chat provenance authoritative while accepting only bounded proposal fields", () => {
    const createPayload = {
      requestId: "ask-provenance",
      sessionId: "session-1",
      mode: "single",
      question: { prompt: "Which path?" },
      options: [{ value: "ship", label: "Ship", provenance: "chat" }],
      context: {
        codebaseContext: "Fastify service.",
        problemContext: "Choose a release path."
      }
    } as const;

    expect(() => AskCreatePayloadSchema.parse(createPayload)).toThrow();
    expect(AskOptionSchema.parse({ value: "chat_opaque", label: "Stage first", provenance: "chat" })).toEqual({
      value: "chat_opaque",
      label: "Stage first",
      provenance: "chat"
    });
    expect(AskOptionSchema.parse({ value: "ship", label: "Ship" })).toEqual({ value: "ship", label: "Ship" });

    expect(
      ProposeAnswerPayloadSchema.parse({
        label: "Stage first",
        description: "Deploy to a small cohort.",
        meaning: "A reversible rollout.",
        context: "The release pipeline supports cohorts."
      })
    ).toMatchObject({ label: "Stage first", meaning: "A reversible rollout." });
    expect(() => ProposeAnswerPayloadSchema.parse({ label: "x".repeat(2_001) })).toThrow();
    expect(() => ProposeAnswerPayloadSchema.parse({ label: "Valid", provenance: "chat" })).toThrow();
    expect(() => ProposeAnswerPayloadSchema.parse({ label: "Valid", value: "spoofed" })).toThrow();
    expect(() =>
      ProposeAnswerResultSchema.parse({ status: "appended", option: { value: "chat_opaque", label: "Stage first" } })
    ).toThrow();
    expect(
      ProposeAnswerResultSchema.parse({
        status: "appended",
        option: { value: "chat_opaque", label: "Stage first", provenance: "chat" }
      })
    ).toMatchObject({ status: "appended", option: { provenance: "chat" } });
  });

  it("accepts finite urgency levels and defaults legacy asks to normal urgency", () => {
    const basePayload = {
      requestId: "ask-urgency",
      sessionId: "session-1",
      mode: "single",
      question: { prompt: "Which request should be answered first?" },
      options: [{ value: "this-one", label: "This one" }],
      context: {
        codebaseContext: "A Postbox inbox with multiple pending decisions.",
        problemContext: "Order attention cards consistently by urgency and age."
      }
    } as const;

    expect(AskCreatePayloadSchema.parse({ ...basePayload, urgency: "high" }).urgency).toBe("high");
    expect(AskCreatePayloadSchema.parse(basePayload).urgency).toBe("normal");
    expect(() => AskCreatePayloadSchema.parse({ ...basePayload, urgency: "immediate" })).toThrow();

    const legacySnapshot = StateSnapshotSchema.parse({
      sessions: [],
      requests: [{ ...basePayload, status: "pending", createdAt: "2026-06-03T00:00:00.000Z" }],
      timestamp: "2026-06-03T00:00:01.000Z"
    });
    expect(legacySnapshot.requests[0]?.urgency).toBe("normal");
  });

  it("requires non-blank interviewer context for newly created asks", () => {
    const basePayload = {
      requestId: "ask-context-required",
      sessionId: "session-1",
      mode: "single",
      question: { prompt: "Choose a framework" },
      options: [{ value: "fastify", label: "Fastify" }]
    } as const;

    expect(() => AskCreatePayloadSchema.parse(basePayload)).toThrow();
    expect(() =>
      AskCreatePayloadSchema.parse({
        ...basePayload,
        context: { codebaseContext: "   ", problemContext: "Choose the server framework for v1." }
      })
    ).toThrow();
    expect(() =>
      AskCreatePayloadSchema.parse({
        ...basePayload,
        context: { codebaseContext: "Fastify service.", problemContext: "\n\t" }
      })
    ).toThrow();

    expect(
      AskCreatePayloadSchema.parse({
        ...basePayload,
        context: {
          codebaseContext: "Fastify service with shared Zod schemas.",
          problemContext: "Choose the server framework for v1."
        }
      }).context
    ).toEqual({
      codebaseContext: "Fastify service with shared Zod schemas.",
      problemContext: "Choose the server framework for v1."
    });
  });

  it("accepts a single-choice ask payload and rejects empty options", () => {
    const payload = AskCreatePayloadSchema.parse({
      requestId: "ask-1",
      sessionId: "session-1",
      mode: "single",
      question: { prompt: "Choose a framework" },
      options: [{ value: "fastify", label: "Fastify" }],
      context: {
        codebaseContext: "TypeScript workspace with a shared protocol package.",
        problemContext: "Choose a framework for the Postbox server."
      }
    });

    expect(payload.options[0]?.value).toBe("fastify");
    expect(() =>
      AskCreatePayloadSchema.parse({
        requestId: "ask-2",
        sessionId: "session-1",
        mode: "multi",
        question: { prompt: "Choose options" },
        options: [],
        context: {
          codebaseContext: "TypeScript workspace with a shared protocol package.",
          problemContext: "Choose options for the Postbox server."
        }
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
    expect(snapshot.requests[0]?.context).toBeUndefined();
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
