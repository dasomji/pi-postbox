import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readExtensionConfig } from "../src/config.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function configEnv(value: unknown): Promise<NodeJS.ProcessEnv> {
  const directory = await mkdtemp(join(tmpdir(), "postbox-config-test-"));
  directories.push(directory);
  const path = join(directory, "config.json");
  await writeFile(path, JSON.stringify(value));
  return { PI_POSTBOX_CONFIG_PATH: path };
}

describe("extension config parsing", () => {
  it("accepts the same boolean-ish autoWake strings as the environment variable", async () => {
    const env = await configEnv({ autoWake: "off" });

    await expect(readExtensionConfig(env)).resolves.toMatchObject({ autoWake: false });
  });

  it("warns for an invalid field while retaining valid fields", async () => {
    const env = await configEnv({
      serverUrl: "https://postbox.example/",
      autoWake: "sometimes"
    });
    const warn = vi.fn();

    const config = await readExtensionConfig(env, undefined, warn);

    expect(config).toEqual({ serverUrl: "https://postbox.example/" });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain("autoWake");
  });
});
