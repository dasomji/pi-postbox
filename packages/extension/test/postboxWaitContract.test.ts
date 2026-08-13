import { describe, expect, it } from "vitest";

describe("wait_for_postbox adapter capacity contract", () => {
  it("retains each configured runnable slot until its waiting child wakes or is cancelled", async () => {
    const slots = 2;
    let occupied = 0;
    const waitForPostbox = (signal: AbortSignal, wake?: Promise<string>) => new Promise<string>((resolve, reject) => {
      signal.addEventListener("abort", () => reject(Object.assign(new Error("cancelled"), { name: "AbortError" })), { once: true });
      void wake?.then(resolve);
    });
    const runChild = (signal: AbortSignal, wake?: Promise<string>) => {
      if (occupied === slots) throw new Error("runnable capacity exhausted");
      occupied += 1;
      return waitForPostbox(signal, wake).finally(() => { occupied -= 1; });
    };
    let wakeFirst!: (value: string) => void;
    const firstWake = new Promise<string>((resolve) => { wakeFirst = resolve; });
    const controllers = Array.from({ length: slots }, () => new AbortController());
    const running = [runChild(controllers[0]!.signal, firstWake), runChild(controllers[1]!.signal)];
    expect(running).toHaveLength(slots);
    expect(() => runChild(new AbortController().signal)).toThrow("capacity exhausted");
    wakeFirst("woke");
    await expect(running[0]).resolves.toBe("woke");
    expect(occupied).toBe(1);
    controllers[1]!.abort();
    await expect(running[1]).rejects.toMatchObject({ name: "AbortError" });
    expect(occupied).toBe(0);
  });
});
