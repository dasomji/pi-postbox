import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createPostboxNavigationGuard } from "../src/index.js";

describe("Pi lifecycle preservation contract", () => {
  it("queries the exact owner and supports no-count, decline, accept, and error fail-open paths", async () => {
    const owner = { harness: "pi", ownerId: "owner-1" };
    const calls: unknown[] = [];
    const guard = (counts: { activeQuestionCount: number; unreadAnswerCount: number }, confirmation = true) =>
      createPostboxNavigationGuard({ owner,
        query: async (type, payload) => { calls.push({ type, payload }); return [counts]; },
        confirm: async () => confirmation });
    await expect(guard({ activeQuestionCount: 0, unreadAnswerCount: 0 })()).resolves.toBeUndefined();
    await expect(guard({ activeQuestionCount: 1, unreadAnswerCount: 0 }, false)()).resolves.toEqual({ cancel: true });
    await expect(guard({ activeQuestionCount: 0, unreadAnswerCount: 1 }, true)()).resolves.toBeUndefined();
    expect(calls[0]).toEqual({ type: "owner.status.get", payload: { owners: [owner] } });
    await expect(createPostboxNavigationGuard({ owner, query: async () => { throw new Error("offline"); }, confirm: async () => false })()).resolves.toBeUndefined();
    await expect(createPostboxNavigationGuard({ owner, query: async () => [{ activeQuestionCount: 1 }], confirm: async () => { throw new Error("UI closed"); } })()).resolves.toBeUndefined();
  });

  it("keeps ordinary Question creation non-blocking and isolates local ask_user from explicit Postbox waiting", async () => {
    const askSource = await readFile(new URL("../src/tools/askPostbox.ts", import.meta.url), "utf8");
    const lifecycleSource = await readFile(new URL("../src/lifecycle.ts", import.meta.url), "utf8");
    const extensionSource = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
    expect(askSource).not.toMatch(/waitForPostbox|waiting_for_postbox/);
    expect(lifecycleSource).toMatch(/ask_user[\s\S]*blocked/);
    expect(extensionSource).toMatch(/wait_for_postbox[\s\S]*waiting_for_postbox/);
    expect(extensionSource).toMatch(/herdr/i);
  });

  it("preserves reload identity while shutdown clears only ephemeral adapter resources", async () => {
    const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
    expect(source).toMatch(/preserveFallbackIdentityForReload/);
    expect(source).toMatch(/client\?\.stop\(\)/);
    expect(source).not.toMatch(/session_shutdown[\s\S]{0,1600}cancelPending|session_shutdown[\s\S]{0,1600}delete.*Answer/i);
  });
});
