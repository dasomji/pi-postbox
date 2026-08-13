import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Pi lifecycle preservation contract", () => {
  it("registers pre-switch and pre-fork confirmation guards using owner queue facts", async () => {
    const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
    expect(source).toContain('pi.on("session_before_switch"');
    expect(source).toContain('pi.on("session_before_fork"');
    expect(source).toMatch(/activeQuestionCount|openQuestionCount/);
    expect(source).toMatch(/unreadAnswerCount/);
    expect(source).toMatch(/ui\.confirm/);
    expect(source).toMatch(/return \{ cancel: true \}/);
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
