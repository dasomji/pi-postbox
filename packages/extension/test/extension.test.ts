import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { toExtensionSocketUrl } from "../src/client/PostboxClient.js";
import { getMachineIdentity } from "../src/machineIdentity.js";
import { startRegistration } from "../src/index.js";
import { collectSessionMetadata } from "../src/sessionMetadata.js";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempConfigEnv(extra: NodeJS.ProcessEnv = {}): Promise<NodeJS.ProcessEnv> {
  const dir = await mkdtemp(join(tmpdir(), "pi-postbox-extension-"));
  dirs.push(dir);
  return { ...extra, PI_POSTBOX_CONFIG_PATH: join(dir, "config.json") };
}

describe("Pi Postbox extension registration", () => {
  it("creates and reuses a persistent generated machine id", async () => {
    const env = await tempConfigEnv();

    const first = await getMachineIdentity(env);
    const second = await getMachineIdentity(env);
    const config = JSON.parse(await readFile(env.PI_POSTBOX_CONFIG_PATH!, "utf8"));

    expect(first.machineId).toMatch(/^machine_/);
    expect(second.machineId).toBe(first.machineId);
    expect(config.machineId).toBe(first.machineId);
  });

  it("maps configured HTTP URLs to the extension WebSocket endpoint", () => {
    expect(toExtensionSocketUrl("http://127.0.0.1:3000/")).toBe("ws://127.0.0.1:3000/api/extension/ws");
    expect(toExtensionSocketUrl("https://postbox.example/base")).toBe("wss://postbox.example/api/extension/ws");
  });

  it("uses a per-session fallback identity when Pi has no session file", () => {
    const api = { getSessionName: () => "Ephemeral session" };
    const ctx = { cwd: "/repo" };

    const first = collectSessionMetadata(api, ctx, undefined, undefined, "fallback-one");
    const firstReconnect = collectSessionMetadata(api, ctx, undefined, undefined, "fallback-one");
    const replacement = collectSessionMetadata(api, ctx, undefined, undefined, "fallback-two");

    expect(first.sessionId).toBe(firstReconnect.sessionId);
    expect(replacement.sessionId).not.toBe(first.sessionId);
  });

  it("does not block or throw Pi startup when the server is unavailable", async () => {
    const env = await tempConfigEnv({ PI_POSTBOX_URL: "http://127.0.0.1:9" });
    const statuses: string[] = [];

    await expect(
      startRegistration(
        { getSessionName: () => "Presence test", on: () => undefined },
        {
          cwd: process.cwd(),
          ui: { setStatus: (_key, value) => statuses.push(value), notify: (message) => statuses.push(message) },
          sessionManager: { getSessionFile: () => "/tmp/session.jsonl", getLeafId: () => "leaf-1" }
        },
        env
      )
    ).resolves.toBeUndefined();

    expect(statuses).not.toContain("Postbox registration skipped");
  });
});
