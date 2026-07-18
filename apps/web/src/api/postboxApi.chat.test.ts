import type { QuestionChatSnapshot } from "@pi-postbox/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { probeQuestionChatSnapshot } from "./postboxApi";

const SNAPSHOT: QuestionChatSnapshot = {
  requestId: "question/probe",
  state: "ready",
  forkKind: "exact",
  model: { id: "test/model", source: "originating" },
  sequence: 0,
  messages: []
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("Question Chat snapshot discovery", () => {
  it("returns a running snapshot without issuing an activation request", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ status: "ready", snapshot: SNAPSHOT }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(probeQuestionChatSnapshot(SNAPSHOT.requestId)).resolves.toEqual({
      status: "ready",
      snapshot: SNAPSHOT
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/requests/question%2Fprobe/chat");
  });

  it("treats chat_not_started as normal discovery and rejects invalid or non-OK ready bodies", async () => {
    const fetchMock = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(jsonResponse({
        status: "unavailable",
        error: { code: "chat_not_started", message: "Start Question Chat first." }
      }, 409))
      .mockResolvedValueOnce(jsonResponse({ status: "ready", snapshot: SNAPSHOT }, 500))
      .mockResolvedValueOnce(jsonResponse({ status: "ready", snapshot: { requestId: "broken" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(probeQuestionChatSnapshot("question-one")).resolves.toEqual({ status: "not-started" });
    await expect(probeQuestionChatSnapshot("question-one")).rejects.toThrow("probe failed with 500");
    await expect(probeQuestionChatSnapshot("question-one")).rejects.toThrow();
  });
});
