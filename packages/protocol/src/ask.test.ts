import { describe, expect, it } from "vitest";
import {
  AskAnswerPayloadSchema,
  AskCancelPayloadSchema,
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
      question: { prompt: "Which path?", ambiguity: "Whether to ship now or stage first." },
      options: [{ value: "ship", label: "Ship", provenance: "chat" }]
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
        impact: "A reversible rollout."
      })
    ).toMatchObject({ label: "Stage first", impact: "A reversible rollout." });
    expect(() => ProposeAnswerPayloadSchema.parse({ label: "Valid", context: "Removed option context." })).toThrow();
    expect(() => AskOptionSchema.parse({ value: "valid", label: "Valid", context: "Removed option context." })).toThrow();
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

  it("rejects the removed priority field", () => {
    const basePayload = {
      requestId: "ask-urgency",
      sessionId: "session-1",
      mode: "single",
      question: { prompt: "Which request should be answered first?", ambiguity: "Which pending decision is most urgent." },
      options: [{ value: "this-one", label: "This one" }]
    } as const;

    expect(() => AskCreatePayloadSchema.strict().parse({ ...basePayload, urgency: "high" })).toThrow();
    expect(AskCreatePayloadSchema.parse(basePayload)).not.toHaveProperty("urgency");

    const legacySnapshot = StateSnapshotSchema.parse({
      sessions: [],
      requests: [{ ...basePayload, revision: 1, creator: { harness: "pi", ownerId: "owner" },
        owner: { harness: "pi", ownerId: "owner" }, status: "pending", createdAt: "2026-06-03T00:00:00.000Z" }],
      timestamp: "2026-06-03T00:00:01.000Z"
    });
    expect(legacySnapshot.requests[0]).not.toHaveProperty("urgency");
  });

  it("rejects removed top-level handoff context on newly created asks", () => {
    const basePayload = {
      requestId: "ask-without-context",
      sessionId: "session-1",
      mode: "single",
      question: { prompt: "Choose a framework", ambiguity: "Which framework best fits the v1 server." },
      options: [{ value: "fastify", label: "Fastify" }]
    } as const;

    expect(AskCreatePayloadSchema.parse(basePayload)).not.toHaveProperty("context");
    expect(() => AskCreatePayloadSchema.parse({
      ...basePayload,
      context: { codebaseContext: "Fastify service.", problemContext: "Choose the server framework." }
    })).toThrow();
  });

  it("requires a non-blank ambiguity for newly created Questions", () => {
    const basePayload = {
      requestId: "ask-ambiguity-required",
      sessionId: "session-1",
      mode: "single",
      options: [{ value: "fastify", label: "Fastify" }]
    } as const;

    expect(() => AskCreatePayloadSchema.parse({ ...basePayload, question: { prompt: "Choose a framework" } })).toThrow();
    expect(() => AskCreatePayloadSchema.parse({ ...basePayload, question: { prompt: "Choose a framework", ambiguity: "  \n" } })).toThrow();
    expect(AskCreatePayloadSchema.parse({ ...basePayload, question: {
      prompt: "Choose a framework",
      ambiguity: "Whether Fastify is the right framework for v1."
    } }).question.ambiguity).toContain("Fastify");
  });

  it("accepts a single-choice ask payload and rejects empty options", () => {
    const payload = AskCreatePayloadSchema.parse({
      requestId: "ask-1",
      sessionId: "session-1",
      mode: "single",
      question: { prompt: "Choose a framework", ambiguity: "Which framework fits the Postbox server." },
      options: [{ value: "fastify", label: "Fastify" }]
    });

    expect(payload.options[0]?.value).toBe("fastify");
    expect(() =>
      AskCreatePayloadSchema.parse({
        requestId: "ask-2",
        sessionId: "session-1",
        mode: "multi",
        question: { prompt: "Choose options", ambiguity: "Which options are required." },
        options: []
      })
    ).toThrow();
  });

  it("accepts notes but rejects removed rationale fields on Answer and cancellation payloads", () => {
    expect(AskAnswerPayloadSchema.parse({ selectedValues: ["ship"], note: "Proceed" })).toEqual({
      selectedValues: ["ship"],
      note: "Proceed"
    });
    expect(() => AskAnswerPayloadSchema.parse({ selectedValues: ["ship"], rationale: "Because" })).toThrow();
    expect(AskCancelPayloadSchema.parse({ note: "No longer needed" })).toEqual({ note: "No longer needed" });
    expect(() => AskCancelPayloadSchema.parse({ rationale: "No longer needed" })).toThrow();
  });

  it("normalizes answered, cancelled, expired, and unavailable terminal results", () => {
    expect(
      AskResultSchema.parse({
        status: "answered",
        requestId: "ask-1",
        selectedValues: ["a", "b"],
        note: "ship it",
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
        note: "No answer before timeout",
        resolvedAt: "2026-06-03T00:00:00.000Z"
      })
    ).toMatchObject({ status: "expired", requestId: "ask-1", note: "No answer before timeout" });

    expect(
      AskResultSchema.parse({
        status: "unavailable",
        requestId: "ask-1",
        note: "Server unavailable",
        resolvedAt: "2026-06-03T00:00:00.000Z"
      })
    ).toMatchObject({ status: "unavailable", requestId: "ask-1", note: "Server unavailable" });
    expect(JSON.stringify(AskResultSchema.options)).not.toMatch(/rationale/i);
  });

  it("allows state snapshots to include pending request cards", () => {
    const snapshot = StateSnapshotSchema.parse({
      sessions: [],
      requests: [
        {
          requestId: "ask-1",
          sessionId: "session-1",
          revision: 1,
          creator: { harness: "pi", ownerId: "owner" },
          owner: { harness: "pi", ownerId: "owner" },
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

  it("preserves option impact and fork references in request snapshots", () => {
    const payload = AskCreatePayloadSchema.parse({
      requestId: "ask-rich",
      sessionId: "session-1",
      mode: "single",
      question: {
        prompt: "Which persistence strategy should we use?",
        ambiguity: "Which storage boundary will preserve decisions while keeping deployment simple?"
      },
      options: [
        {
          value: "sqlite",
          label: "SQLite",
          description: "Use a local SQLite database.",
          impact: "Best fit for a personal Tailscale service."
        }
      ],
      forkReference: {
        agentSessionId: "native-session-1",
        agentSessionPath: "/tmp/pi-session.jsonl",
        leafId: "leaf-123",
        cwd: "/repo",
        model: "gpt-5.5"
      }
    });

    expect(payload.question.ambiguity).toContain("storage boundary");
    expect(payload.options[0]?.impact).toContain("personal Tailscale");
    expect(payload.forkReference).toMatchObject({ leafId: "leaf-123", model: "gpt-5.5" });

    const snapshot = StateSnapshotSchema.parse({
      sessions: [],
      requests: [
        {
          ...payload,
          revision: 1,
          creator: { harness: "pi", ownerId: "owner" },
          owner: { harness: "pi", ownerId: "owner" },
          status: "pending",
          createdAt: "2026-06-03T00:00:00.000Z"
        }
      ],
      timestamp: "2026-06-03T00:00:01.000Z"
    });

    expect(snapshot.requests[0]).not.toHaveProperty("context");
    expect(snapshot.requests[0]?.forkReference?.agentSessionPath).toBe("/tmp/pi-session.jsonl");
  });
});
