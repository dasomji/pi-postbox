import { createServer, type Server } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPostboxApp } from "../src/app.js";
import { isCliEntrypoint, listenWithPortFallback, parseCliOptions } from "../src/cli.js";

const apps: Array<{ close: () => Promise<void> }> = [];
const servers: Server[] = [];

async function occupyLocalPort(): Promise<number> {
  const server = createServer();
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("failed to reserve local port");
  return address.port;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        })
    )
  );
});

describe("pi-postbox-server CLI", () => {
  it("uses one-command local defaults with a stable user database path", () => {
    expect(parseCliOptions([], {})).toMatchObject({
      host: "127.0.0.1",
      port: 3000,
      databasePath: join(homedir(), ".pi-postbox", "postbox.sqlite")
    });
  });

  it("keeps flag and environment overrides for host, port, and database", () => {
    expect(
      parseCliOptions(["--host", "localhost", "--port", "3333", "--database", ":memory:"], {
        PI_POSTBOX_HOST: "0.0.0.0",
        PI_POSTBOX_PORT: "4444",
        PI_POSTBOX_DATABASE: "/tmp/from-env.sqlite"
      })
    ).toMatchObject({ host: "localhost", port: 3333, databasePath: ":memory:" });

    expect(
      parseCliOptions([], {
        PI_POSTBOX_HOST: "localhost",
        PI_POSTBOX_PORT: "4444",
        PI_POSTBOX_DATABASE: "/tmp/from-env.sqlite"
      })
    ).toMatchObject({ host: "localhost", port: 4444, databasePath: "/tmp/from-env.sqlite" });
  });

  it("accepts equals-form flags for direct and lizardtail-launched usage", () => {
    expect(
      parseCliOptions(
        [
          "--host=localhost",
          "--port=3333",
          "--database=:memory:",
          "--ui-dist-dir=/tmp/ui",
          "--ask-timeout-ms=5000",
          "--history-retention-max-age-ms=6000",
          "--history-retention-max-records=7"
        ],
        {}
      )
    ).toMatchObject({
      host: "localhost",
      port: 3333,
      databasePath: ":memory:",
      uiDistDir: "/tmp/ui",
      askTimeoutMs: 5000,
      historyRetentionMaxAgeMs: 6000,
      historyRetentionMaxRecords: 7
    });
  });

  it("recognizes npm bin symlinks as CLI entrypoints", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-postbox-cli-test-"));
    try {
      const target = join(dir, "cli.js");
      const link = join(dir, "pi-postbox-server");
      await writeFile(target, "#!/usr/bin/env node\n");
      await symlink(target, link);

      expect(isCliEntrypoint(pathToFileURL(target).href, link)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not fall back when listening fails for reasons other than a busy port", async () => {
    const failure = Object.assign(new Error("host unavailable"), { code: "EADDRNOTAVAIL" });
    const app = { listen: vi.fn().mockRejectedValue(failure) } as unknown as FastifyInstance;

    await expect(listenWithPortFallback(app, { host: "203.0.113.1", port: 3000 })).rejects.toBe(failure);
  });

  it("falls back to another local port when the preferred port is already in use", async () => {
    const preferredPort = await occupyLocalPort();
    const app = await createPostboxApp({ databasePath: ":memory:" });
    apps.push(app);

    const address = await listenWithPortFallback(app, { host: "127.0.0.1", port: preferredPort });
    const actualPort = new URL(address).port;

    expect(address).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(Number(actualPort)).not.toBe(preferredPort);

    const response = await fetch(`${address}/healthz`);
    expect(response.status).toBe(200);
  });
});
