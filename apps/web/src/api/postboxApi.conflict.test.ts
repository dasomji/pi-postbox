import { afterEach, describe, expect, it, vi } from "vitest";
import { PostboxStaleRevisionError, postJson } from "./postboxApi";

afterEach(() => vi.unstubAllGlobals());

describe("Postbox mutation conflicts", () => {
  it("exposes stale_revision as a refreshable question update", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      error: "stale_revision",
      message: "Question revision is stale"
    }), { status: 409, headers: { "Content-Type": "application/json" } })));

    await expect(postJson("/api/requests/ask-1/answer", { expectedRevision: 1 }))
      .rejects.toBeInstanceOf(PostboxStaleRevisionError);
    await expect(postJson("/api/requests/ask-1/answer", { expectedRevision: 1 }))
      .rejects.toThrow(/updated/i);
  });
});
