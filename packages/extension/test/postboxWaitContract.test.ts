import { describe, expect, it } from "vitest";

describe("wait_for_postbox adapter capacity contract", () => {
  it("retains each configured runnable slot until its waiting child wakes or is cancelled", async () => {
    const slots = 2;
    const controllers = Array.from({ length: slots }, () => new AbortController());
    const running = controllers.map(({ signal }, index) => new Promise<string>((resolve, reject) => {
      signal.addEventListener("abort", () => reject(Object.assign(new Error("cancelled"), { name: "AbortError" })), { once: true });
      if (index === 0) queueMicrotask(() => resolve("woke"));
    }));
    expect(running).toHaveLength(slots);
    await expect(running[0]).resolves.toBe("woke");
    controllers[1]!.abort();
    await expect(running[1]).rejects.toMatchObject({ name: "AbortError" });
  });
});
