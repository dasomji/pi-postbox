import type { QuestionChatSnapshot } from "@pi-postbox/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { activateContextQuestionChat, connectQuestionChatEvents, probeQuestionChatSnapshot } from "./postboxApi";

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
  it("uses a distinct explicit confirmed request for context-only activation", async () => {
    const contextSnapshot = { ...SNAPSHOT, forkKind: "context-only" as const };
    const fetchMock = vi.fn(async () => jsonResponse({ status: "ready", snapshot: contextSnapshot }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(activateContextQuestionChat("question/context")).resolves.toEqual({
      status: "ready",
      snapshot: contextSnapshot
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/requests/question%2Fcontext/chat/context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmed: true })
    });
  });

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

  it("returns typed extension_offline discovery instead of reconstructing browser history", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      status: "unavailable",
      error: { code: "extension_offline", message: "The originating extension is offline." }
    }, 503)));
    await expect(probeQuestionChatSnapshot("question-offline")).resolves.toEqual({
      status: "unavailable",
      error: { code: "extension_offline", message: "The originating extension is offline." }
    });
  });

  it("reports an established event stream becoming stale", async () => {
    let source!: { onopen: (() => void) | null; onerror: (() => void) | null; onmessage: ((event: MessageEvent) => void) | null };
    class FakeEventSource {
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      constructor() {
        source = this;
      }
      close(): void {}
    }
    vi.stubGlobal("EventSource", FakeEventSource);
    const events: unknown[] = [];
    const connection = connectQuestionChatEvents("question-offline", (event) => events.push(event));
    source.onopen?.();
    await connection.ready;
    source.onerror?.();
    expect(events).toEqual([{ requestId: "question-offline", type: "transport", state: "offline" }]);
  });
});
