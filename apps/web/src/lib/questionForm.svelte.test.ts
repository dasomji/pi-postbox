// @vitest-environment jsdom
import { createHealthResponse, type AskRequestSnapshot } from "@pi-postbox/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Each test imports a fresh form and its shared store, including private transport state.
let store: typeof import("./store.svelte").store;
let createQuestionForm: typeof import("./questionForm.svelte").createQuestionForm;
const REQUEST: AskRequestSnapshot = {
  requestId: "offline-question", sessionId: "session-one", revision: 1, ownerRevision: 1,
  creator: { harness: "pi", ownerId: "owner" }, owner: { harness: "pi", ownerId: "owner" },
  images: [], mode: "single", question: { prompt: "Which path?" },
  options: [{ value: "a", label: "Path A" }], status: "pending", createdAt: "2026-07-17T12:00:00.000Z"
};

beforeEach(async () => {
  vi.resetModules();
  ({ store } = await import("./store.svelte"));
  ({ createQuestionForm } = await import("./questionForm.svelte"));
  store.connection = { status: "unavailable", message: "Offline" };
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("Question form delivery boundary", () => {
  it("refuses direct Submit and Cancel offline without posting or losing the draft", async () => {
    const fetcher = vi.fn(async () => Response.json({}));
    vi.stubGlobal("fetch", fetcher);
    const form = createQuestionForm(REQUEST);
    form.toggle("a");
    form.note = "Keep this answer";
    form.submit();
    form.cancel();
    await Promise.resolve();
    expect(fetcher).not.toHaveBeenCalled();
    expect(form.selected).toEqual(["a"]);
    expect(form.note).toBe("Keep this answer");
    expect(form.busy).toBe(false);
    expect(form.error).toContain("offline or reconnecting");
  });

  it("clears an offline action error after recovery while preserving the draft", () => {
    const form = createQuestionForm(REQUEST);
    form.toggle("a");
    form.note = "Keep this answer";
    form.submit();
    expect(form.error).toContain("offline or reconnecting");
    store.connection = { status: "connected", health: createHealthResponse({ startedAtMs: 1_000 }) };
    store.syncing = false;
    expect(form.error).toBeUndefined();
    expect(form.canSubmit).toBe(true);
    expect(form.selected).toEqual(["a"]);
    expect(form.note).toBe("Keep this answer");
  });
});
