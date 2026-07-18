import { describe, expect, it } from "vitest";
import {
  QUESTION_CHAT_STARTERS,
  QuestionChatActivationResponseSchema,
  QuestionChatEventSchema,
  QuestionChatSendHttpResponseSchema,
  QuestionChatSendPayloadSchema,
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
        error: { code, message: "Chat is unavailable." }
      })
    ).toMatchObject({ status: "unavailable", error: { code } });
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
});
