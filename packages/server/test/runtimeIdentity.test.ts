import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRuntimeBuildId } from "../src/runtimeIdentity.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("server runtime build identity", () => {
  it("is deterministic for identical runtime content and changes with executable bytes", async () => {
    const runtimeDir = await mkdtemp(join(tmpdir(), "postbox-runtime-identity-"));
    tempDirs.push(runtimeDir);
    await mkdir(join(runtimeDir, "nested"));
    await writeFile(join(runtimeDir, "cli.js"), "export const value = 1;\n");
    await writeFile(join(runtimeDir, "nested", "app.js"), "export const app = true;\n");

    const first = createRuntimeBuildId("1.2.3", runtimeDir);
    expect(first).toMatch(/^1\.2\.3\+sha256\.[a-f0-9]{16}$/);
    expect(createRuntimeBuildId("1.2.3", runtimeDir)).toBe(first);

    await writeFile(join(runtimeDir, "nested", "app.js"), "export const app = false;\n");
    expect(createRuntimeBuildId("1.2.3", runtimeDir)).not.toBe(first);
  });
});
