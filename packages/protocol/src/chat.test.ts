import { describe, expect, it } from "vitest";
import {
  QUESTION_CHAT_STARTERS,
  QuestionChatActivationResponseSchema,
  QuestionChatContextActivationPayloadSchema,
  QuestionChatContextSourceSchema,
  QuestionChatEventSchema,
  QuestionChatSendHttpResponseSchema,
  QuestionChatSendPayloadSchema,
  QuestionChatStopPayloadSchema,
  QuestionChatStopResponseSchema,
  QuestionChatStreamEventSchema,
  QuestionChatSnapshotHttpResponseSchema,
  QuestionChatSnapshotSchema,
  QuestionChatSourceSchema
} from "./chat.js";
import { ExtensionClientMessageSchema, ExtensionServerMessageSchema } from "./ws.js";

describe("Question Chat activation protocol", () => {
  it("accepts a ready exact-fork snapshot with an empty transcript", () => {
    expect(
      QuestionChatActivationResponseSchema.parse({
        status: "ready",
        snapshot: {
          requestId: "ask-25",
          state: "ready",
          forkKind: "exact",
          model: { id: "anthropic/claude-sonnet-4", source: "originating" },
          messages: []
        }
      })
    ).toMatchObject({ status: "ready", snapshot: { messages: [] } });
  });

  it("rejects transcript content and unbounded source fields", () => {
    expect(() =>
      QuestionChatSnapshotSchema.parse({
        requestId: "ask-25",
        state: "ready",
        forkKind: "exact",
        model: { id: "pi-default", source: "pi-default", fallbackReason: "Origin model unavailable" },
        messages: [{ role: "assistant", text: "not in activation scope" }]
      })
    ).toThrow();

    expect(() =>
      QuestionChatSourceSchema.parse({ agentSessionPath: "x".repeat(4_001), leafId: "leaf", cwd: "/repo" })
    ).toThrow();
  });

  it.each([
    "request_missing",
    "request_not_pending",
    "extension_offline",
    "source_path_missing",
    "source_leaf_missing",
    "wrong_owner",
    "command_timeout",
    "runtime_failure"
  ])("accepts the typed %s availability error", (code) => {
    expect(
      QuestionChatActivationResponseSchema.parse({
        status: "unavailable",
        error: {
          code,
          message: "Chat is unavailable.",
          ...((code === "source_path_missing" || code === "source_leaf_missing")
            ? { contextFallback: { status: "available" } }
            : {})
        }
      })
    ).toMatchObject({ status: "unavailable", error: { code } });
  });

  it("requires finite context-only fallback disclosure on exact source failures", () => {
    expect(
      QuestionChatActivationResponseSchema.parse({
        status: "unavailable",
        error: {
          code: "source_path_missing",
          message: "The source is unavailable.",
          contextFallback: { status: "available" }
        }
      })
    ).toMatchObject({ error: { contextFallback: { status: "available" } } });
    expect(
      QuestionChatActivationResponseSchema.parse({
        status: "unavailable",
        error: {
          code: "source_leaf_missing",
          message: "The source leaf is unavailable.",
          contextFallback: { status: "unavailable", reason: "missing_problem_context" }
        }
      })
    ).toMatchObject({ error: { contextFallback: { reason: "missing_problem_context" } } });
    expect(() =>
      QuestionChatActivationResponseSchema.parse({
        status: "unavailable",
        error: { code: "source_path_missing", message: "Missing disclosure." }
      })
    ).toThrow();
  });

  it("defines a distinct confirmed context-only activation without source transcript coordinates", () => {
    expect(QuestionChatContextActivationPayloadSchema.parse({ confirmed: true })).toEqual({ confirmed: true });
    expect(() => QuestionChatContextActivationPayloadSchema.parse({ confirmed: false })).toThrow();

    const source = QuestionChatContextSourceSchema.parse({
      cwd: "/repo",
      model: "anthropic/claude-sonnet-4",
      mode: "single",
      question: { prompt: "Which design?", decisionImpact: "This selects the public API." },
      options: [{ value: "a", label: "A", description: "Prefer A." }],
      context: {
        codebaseContext: "A real Fastify server.",
        problemContext: "Choose the design.",
        additionalInfo: [{ kind: "text", title: "Constraint", content: "Keep it private." }]
      }
    });
    expect(source).not.toHaveProperty("agentSessionPath");
    expect(source).not.toHaveProperty("leafId");
    expect(source).not.toHaveProperty("transcript");
    expect(() => QuestionChatContextSourceSchema.parse({ ...source, context: { ...source.context, problemContext: " " } })).toThrow();
    expect(() => QuestionChatContextSourceSchema.parse({ ...source, transcript: [{ role: "assistant", text: "invented" }] })).toThrow();

    expect(
      ExtensionServerMessageSchema.parse({
        type: "chat.activate-context",
        requestId: "relay-context-1",
        payload: { requestId: "ask-29", ownerSessionId: "session-1", source }
      })
    ).toMatchObject({ type: "chat.activate-context", payload: { source: { model: "anthropic/claude-sonnet-4" } } });
    expect(() =>
      ExtensionServerMessageSchema.parse({
        type: "chat.activate-context",
        requestId: "x".repeat(201),
        payload: { requestId: "ask-29", ownerSessionId: "session-1", source }
      })
    ).toThrow();
    expect(
      QuestionChatActivationResponseSchema.parse({
        status: "ready",
        snapshot: {
          requestId: "ask-29",
          state: "ready",
          forkKind: "context-only",
          model: { id: "anthropic/claude-sonnet-4", source: "originating" },
          messages: []
        }
      })
    ).toMatchObject({ snapshot: { forkKind: "context-only" } });
  });
});

describe("Question Chat first-message protocol", () => {
  it("maps the three fixed starters to deterministic interviewer instructions", () => {
    expect(QUESTION_CHAT_STARTERS).toEqual([
      {
        id: "elaborate",
        label: "Elaborate",
        instruction: "Explain the asking agent's language and intent in this question."
      },
      {
        id: "pro-cons",
        label: "Pro–Cons",
        instruction: "Compare the relevant trade-offs of this decision at my current level."
      },
      {
        id: "teach-me",
        label: "Teach me",
        instruction: "Teach me the minimum foundational concepts I need to understand this question."
      }
    ]);
  });

  it("accepts a bounded client command ID and user message", () => {
    expect(
      QuestionChatSendPayloadSchema.parse({ clientCommandId: "browser_01JABC", message: "What does this mean?" })
    ).toEqual({ clientCommandId: "browser_01JABC", message: "What does this mean?" });
    expect(() => QuestionChatSendPayloadSchema.parse({ clientCommandId: "x".repeat(129), message: "hello" })).toThrow();
    expect(() => QuestionChatSendPayloadSchema.parse({ clientCommandId: "ok", message: "x".repeat(8_001) })).toThrow();
  });

  it("accepts only normalized visible lifecycle and assistant text events", () => {
    expect(
      QuestionChatEventSchema.parse({
        requestId: "ask-26",
        sequence: 4,
        type: "assistant.text.delta",
        messageId: "assistant-1",
        text: "Visible answer"
      })
    ).toMatchObject({ type: "assistant.text.delta", sequence: 4 });
    expect(() =>
      QuestionChatEventSchema.parse({ requestId: "ask-26", sequence: 5, type: "thinking.delta", text: "private" })
    ).toThrow();
    expect(() =>
      QuestionChatEventSchema.parse({ requestId: "ask-26", sequence: 6, type: "sdk.internal", payload: {} })
    ).toThrow();
  });

  it("keeps transient transport state separate from monotonic runtime sequence events", () => {
    expect(QuestionChatStreamEventSchema.parse({
      requestId: "ask-30",
      type: "transport",
      state: "offline"
    })).toEqual({ requestId: "ask-30", type: "transport", state: "offline" });
    expect(() => QuestionChatStreamEventSchema.parse({
      requestId: "ask-30",
      type: "transport",
      state: "offline",
      sequence: 99
    })).toThrow();
  });

  it("accepts a complete bounded transcript snapshot", () => {
    expect(
      QuestionChatSnapshotSchema.parse({
        requestId: "ask-26",
        state: "generating",
        forkKind: "exact",
        model: { id: "test/model", source: "originating" },
        sequence: 3,
        messages: [
          { id: "browser-1", role: "user", text: "Explain it", status: "final" },
          { id: "assistant-1", role: "assistant", text: "Here is **why**", status: "streaming" }
        ]
      }).messages
    ).toHaveLength(2);
  });

  it("defines finite correlated snapshot/send commands and normalized reverse events", () => {
    expect(
      ExtensionServerMessageSchema.parse({
        type: "chat.send",
        requestId: "relay-1",
        payload: {
          requestId: "ask-26",
          ownerSessionId: "session-1",
          command: { clientCommandId: "browser-1", message: "Explain this" }
        }
      })
    ).toMatchObject({ type: "chat.send" });
    expect(
      ExtensionClientMessageSchema.parse({
        type: "chat.event",
        payload: { requestId: "ask-26", sequence: 2, type: "lifecycle", state: "generating" }
      })
    ).toMatchObject({ type: "chat.event" });
    expect(() =>
      ExtensionClientMessageSchema.parse({
        type: "chat.event",
        payload: { requestId: "ask-26", sequence: 3, type: "thinking.delta", text: "secret" }
      })
    ).toThrow();
  });

  it("defines a one-manifest-at-a-time correlated recovery reconciliation", () => {
    expect(ExtensionClientMessageSchema.parse({
      type: "chat.recover.offer",
      requestId: "recover-1",
      payload: { requestId: "ask-30", ownerSessionId: "session-1", forkKind: "exact" }
    })).toMatchObject({ type: "chat.recover.offer", payload: { requestId: "ask-30" } });
    expect(ExtensionServerMessageSchema.parse({
      type: "chat.reconcile",
      requestId: "recover-1",
      payload: { requestId: "ask-30", forkKind: "exact", action: "recover", reason: "pending" }
    })).toMatchObject({ type: "chat.reconcile", payload: { action: "recover" } });
    expect(ExtensionClientMessageSchema.parse({
      type: "chat.reconciled",
      requestId: "recover-1",
      payload: {
        requestId: "ask-30",
        forkKind: "exact",
        result: {
          status: "recovered",
          snapshot: {
            requestId: "ask-30",
            state: "ready",
            forkKind: "exact",
            model: { id: "test/model", source: "originating" },
            sequence: 8,
            messages: []
          }
        }
      }
    })).toMatchObject({ type: "chat.reconciled", payload: { result: { status: "recovered" } } });
    expect(() => ExtensionClientMessageSchema.parse({
      type: "chat.recover.offer",
      requestId: "recover-many",
      payload: { entries: Array.from({ length: 1000 }, (_, index) => ({ requestId: `ask-${index}` })) }
    })).toThrow();
    expect(() => ExtensionServerMessageSchema.parse({
      type: "chat.reconcile",
      requestId: "contradiction",
      payload: { requestId: "ask-30", forkKind: "exact", action: "recover", reason: "terminal" }
    })).toThrow();
    expect(ExtensionClientMessageSchema.parse({
      type: "chat.recover.complete",
      requestId: "recover-complete",
      payload: { ownerSessionId: "session-1" }
    })).toMatchObject({ type: "chat.recover.complete" });
  });

  it("validates browser HTTP snapshot/send success and unavailable envelopes", () => {
    expect(
      QuestionChatSnapshotHttpResponseSchema.parse({ status: "ready", snapshot: {
        requestId: "ask-26",
        state: "ready",
        forkKind: "exact",
        model: { id: "test/model", source: "originating" },
        sequence: 0,
        messages: []
      } })
    ).toMatchObject({ status: "ready" });
    expect(
      QuestionChatSendHttpResponseSchema.parse({
        status: "unavailable",
        error: { code: "runtime_busy", message: "Wait for the current answer." }
      })
    ).toMatchObject({ status: "unavailable", error: { code: "runtime_busy" } });
  });

  it("distinguishes ordinary prompts from steering and defines idempotent Stop", () => {
    expect(
      QuestionChatSendHttpResponseSchema.parse({
        status: "accepted",
        clientCommandId: "browser-steer-1",
        mode: "steer"
      })
    ).toMatchObject({ mode: "steer" });
    expect(
      QuestionChatSendHttpResponseSchema.parse({ status: "accepted", clientCommandId: "legacy-extension" })
    ).toEqual({ status: "accepted", clientCommandId: "legacy-extension" });
    expect(QuestionChatStopPayloadSchema.parse({ clientCommandId: "browser-stop-1" })).toEqual({
      clientCommandId: "browser-stop-1"
    });
    expect(
      QuestionChatStopResponseSchema.parse({ status: "accepted", clientCommandId: "browser-stop-1" })
    ).toMatchObject({ status: "accepted" });
  });

  it.each(["stopping", "stopped", "interrupted"] as const)("accepts coherent %s lifecycle snapshots", (state) => {
    expect(
      QuestionChatSnapshotSchema.parse({
        requestId: "ask-27",
        state,
        forkKind: "exact",
        model: { id: "test/model", source: "originating" },
        sequence: 9,
        messages: [
          {
            id: "assistant-partial",
            role: "assistant",
            text: "Partial answer",
            status: state === "stopped" ? "stopped" : state === "interrupted" ? "interrupted" : "streaming"
          }
        ]
      })
    ).toMatchObject({ state });
  });

  it("marks a finished partial assistant message as stopped or interrupted", () => {
    expect(
      QuestionChatEventSchema.parse({
        requestId: "ask-27",
        sequence: 10,
        type: "message.finished",
        messageId: "assistant-partial",
        text: "Partial answer",
        status: "stopped"
      })
    ).toMatchObject({ status: "stopped" });
  });

  it("defines correlated stop commands on the extension WebSocket", () => {
    expect(
      ExtensionServerMessageSchema.parse({
        type: "chat.stop",
        requestId: "relay-stop-1",
        payload: {
          requestId: "ask-27",
          ownerSessionId: "session-1",
          command: { clientCommandId: "browser-stop-1" }
        }
      })
    ).toMatchObject({ type: "chat.stop" });
    expect(
      ExtensionClientMessageSchema.parse({
        type: "chat.stop.accepted",
        requestId: "relay-stop-1",
        payload: {
          requestId: "ask-27",
          response: { status: "accepted", clientCommandId: "browser-stop-1" }
        }
      })
    ).toMatchObject({ type: "chat.stop.accepted" });
    expect(() => ExtensionServerMessageSchema.parse({
      type: "chat.stop",
      requestId: "x".repeat(201),
      payload: {
        requestId: "ask-27",
        ownerSessionId: "session-1",
        command: { clientCommandId: "browser-stop-1" }
      }
    })).toThrow();
    expect(() => ExtensionClientMessageSchema.parse({
      type: "chat.stop.accepted",
      requestId: "relay-stop-1",
      payload: {
        requestId: "x".repeat(201),
        response: { status: "accepted", clientCommandId: "browser-stop-1" }
      }
    })).toThrow();
  });
});
