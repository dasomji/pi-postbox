import { describe, expect, it } from "vitest";
import { createWaitForPostboxTool } from "../src/index.js";
import { AdapterRunnableSlotLimiter, ownerFromNativeIdentity } from "../src/adapterContract.js";

describe("wait_for_postbox adapter capacity contract", () => {
  it("retains each configured runnable slot until its waiting child wakes or is cancelled", async () => {
    const limiter = new AdapterRunnableSlotLimiter(2);
    const waitForPostbox = (signal: AbortSignal, wake?: Promise<string>) => new Promise<Record<string, unknown>>((resolve, reject) => {
      signal.addEventListener("abort", () => reject(Object.assign(new Error("cancelled"), { name: "AbortError" })), { once: true });
      void wake?.then((event) => resolve({ type: "lifecycle", event }));
    });
    const runChild = (signal: AbortSignal, wake?: Promise<string>) => {
      const tool = createWaitForPostboxTool((toolSignal) => waitForPostbox(toolSignal!, wake));
      return limiter.run(() => tool.execute("child", {}, signal));
    };
    let wakeFirst!: (value: string) => void;
    const firstWake = new Promise<string>((resolve) => { wakeFirst = resolve; });
    const controllers = Array.from({ length: limiter.capacity }, () => new AbortController());
    const running = [runChild(controllers[0]!.signal, firstWake), runChild(controllers[1]!.signal)];
    expect(running).toHaveLength(limiter.capacity);
    expect(() => runChild(new AbortController().signal)).toThrow("capacity exhausted");
    wakeFirst("woke");
    await expect(running[0]).resolves.toMatchObject({ details: { type: "lifecycle", event: "woke" } });
    expect(limiter.occupiedSlots).toBe(1);
    controllers[1]!.abort();
    await expect(running[1]).rejects.toMatchObject({ name: "AbortError" });
    expect(limiter.occupiedSlots).toBe(0);
  });

  it("maps exact native authority identifiers without borrowing broader session provenance", () => {
    expect(ownerFromNativeIdentity({ harness: "pi", sessionUuid: "pi-session-uuid" })).toEqual({ harness: "pi", ownerId: "pi-session-uuid" });
    expect(ownerFromNativeIdentity({ harness: "claude-code", agentId: "agent-7", sessionId: "claude-run" })).toEqual({ harness: "claude-code", ownerId: "agent-7" });
    expect(ownerFromNativeIdentity({ harness: "codex", threadId: "thread-9", sessionId: "codex-run" })).toEqual({ harness: "codex", ownerId: "thread-9" });
  });
});
