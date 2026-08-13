import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("wait_for_postbox adapter capacity contract", () => {
  it("publishes an ID-free cancellable tool and documents that Pi waits retain a runnable-agent slot", () => {
    const extension = readFileSync(resolve("packages/extension/src/index.ts"), "utf8");
    const readme = readFileSync(resolve("README.md"), "utf8");
    expect(extension).toMatch(/name:\s*["']wait_for_postbox["']/);
    expect(extension).toMatch(/wait_for_postbox[\s\S]{0,800}additionalProperties:\s*false/);
    expect(extension).toMatch(/wait_for_postbox[\s\S]{0,1600}(AbortSignal|signal)/);
    expect(readme).toMatch(/wait_for_postbox[\s\S]{0,500}(retains|occupies)[\s\S]{0,120}(slot|capacity)/i);
    expect(readme).toMatch(/(cancel|abort)[\s\S]{0,200}(waiting child|wait_for_postbox)/i);
  });
});
