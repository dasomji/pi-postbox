import { describe, expect, it } from "vitest";
import {
  QuestionChatActivationResponseSchema,
  QuestionChatSnapshotSchema,
  QuestionChatSourceSchema
} from "./chat.js";

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
