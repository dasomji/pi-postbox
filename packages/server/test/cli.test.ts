import {
  ACTIVE_LOCAL_METADATA_DIRECTORY,
  ACTIVE_LOCAL_METADATA_FILENAMES,
  ActiveLocalMetadataRecordSchema,
  HealthResponseSchema
} from "@pi-postbox/protocol";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPostboxApp } from "../src/app.js";
import {
  describePostboxPortSelection,
  collectPostboxServerStatus,
  isCliEntrypoint,
  listenWithPortFallback,
  parseCliOptions
} from "../src/cli.js";

const apps: Array<{ close: () => Promise<void> }> = [];
const servers: Server[] = [];
const tempDirs: string[] = [];

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

async function getUnusedLocalPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  if (!address || typeof address === "string") throw new Error("failed to allocate local port");
  return address.port;
}

async function makeConfigDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pi-postbox-cli-config-"));
  tempDirs.push(dir);
  return dir;
}

function metadataPath(configDir: string, role: "dev" | "production"): string {
  return join(configDir, ACTIVE_LOCAL_METADATA_DIRECTORY, ACTIVE_LOCAL_METADATA_FILENAMES[role]);
}

async function readMetadataRecord(configDir: string, role: "dev" | "production") {
  return ActiveLocalMetadataRecordSchema.parse(JSON.parse(await readFile(metadataPath(configDir, role), "utf8")));
}

async function writeStatusMetadata(
  configDir: string,
  role: "dev" | "production",
  record: { url: string; instanceId: string; updatedAt?: string }
): Promise<void> {
  await mkdir(join(configDir, ACTIVE_LOCAL_METADATA_DIRECTORY), { recursive: true });
  await writeFile(
    metadataPath(configDir, role),
    JSON.stringify({ version: 1, role, url: record.url, instanceId: record.instanceId, updatedAt: record.updatedAt ?? new Date().toISOString() })
  );
}

function healthBody(localTarget?: { role: "dev" | "production"; instanceId: string; url: string }): Record<string, unknown> {
  return {
    ok: true,
    service: "pi-postbox",
    version: "0.1.0",
    protocolVersion: "0.1.0",
    uptimeMs: 1,
    timestamp: new Date().toISOString(),
    ...(localTarget ? { localTarget } : {})
  };
}

async function startHealthServer(bodyForUrl: (url: string) => unknown): Promise<{ url: string; close: () => Promise<void> }> {
  const server: HttpServer = createHttpServer((request, response) => {
    if (request.url !== "/healthz") {
      response.writeHead(404).end();
      return;
    }

    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(bodyForUrl(url)));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("failed to start health server");
  const url = `http://127.0.0.1:${address.port}/`;

  return {
    url,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
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
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("pi-postbox-server CLI", () => {
  it("uses one-command local defaults with a stable user database path, production role, and Tailscale auto-exposure enabled", () => {
    expect(parseCliOptions([], {})).toMatchObject({
      command: "serve",
      host: "127.0.0.1",
      port: 32187,
      activeLocalRole: "production",
      tailscaleEnabled: true,
      databasePath: join(homedir(), ".pi-postbox", "postbox.sqlite")
    });
  });

  it("supports explicit Tailscale Serve opt-out by flag or environment", () => {
    expect(parseCliOptions(["--no-tailscale"], {})).toMatchObject({
      command: "serve",
      tailscaleEnabled: false
    });

    expect(parseCliOptions([], { PI_POSTBOX_TAILSCALE: "off" })).toMatchObject({
      command: "serve",
      tailscaleEnabled: false
    });
  });

  it("parses offline status commands with stable human and JSON modes instead of starting the server", () => {
    expect(parseCliOptions(["status"], {})).toMatchObject({
      command: "status",
      statusJson: false,
      tailscaleEnabled: true
    });

    expect(parseCliOptions(["status", "--json"], {})).toMatchObject({
      command: "status",
      statusJson: true,
      tailscaleEnabled: true
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
          "--active-local-role=dev",
          "--database=:memory:",
          "--ui-dist-dir=/tmp/ui",
          "--ask-timeout-ms=5000",
          "--history-retention-max-age-ms=6000",
          "--history-retention-max-records=7",
          "--session-hide-offline-after-ms=8000",
          "--session-retention-ms=9000"
        ],
        {}
      )
    ).toMatchObject({
      host: "localhost",
      port: 3333,
      activeLocalRole: "dev",
      databasePath: ":memory:",
      uiDistDir: "/tmp/ui",
      askTimeoutMs: 5000,
      historyRetentionMaxAgeMs: 6000,
      historyRetentionMaxRecords: 7,
      sessionHideOfflineAfterMs: 8000,
      sessionRetentionMs: 9000
    });
  });

  it("parses session cleanup durations from the environment with flag precedence", () => {
    expect(
      parseCliOptions(
        ["--session-hide-offline-after-ms=1000", "--session-retention-ms", "2000"],
        {
          PI_POSTBOX_SESSION_HIDE_OFFLINE_AFTER_MS: "3000",
          PI_POSTBOX_SESSION_RETENTION_MS: "4000"
        }
      )
    ).toMatchObject({ sessionHideOfflineAfterMs: 1000, sessionRetentionMs: 2000 });

    expect(
      parseCliOptions([], {
        PI_POSTBOX_SESSION_HIDE_OFFLINE_AFTER_MS: "3000",
        PI_POSTBOX_SESSION_RETENTION_MS: "4000"
      })
    ).toMatchObject({ sessionHideOfflineAfterMs: 3000, sessionRetentionMs: 4000 });
  });

  it("rejects malformed or unsafe session cleanup durations", () => {
    for (const value of ["0", "30d", "1000.5", String(Number.MAX_SAFE_INTEGER)]) {
      expect(() => parseCliOptions(["--session-hide-offline-after-ms", value], {})).toThrow(
        new RegExp(`Invalid session hide-offline-after: ${value.replace(".", "\\.")}`)
      );
      expect(() => parseCliOptions(["--session-retention-ms", value], {})).toThrow(
        new RegExp(`Invalid session retention: ${value.replace(".", "\\.")}`)
      );
    }

    expect(() =>
      parseCliOptions([], { PI_POSTBOX_SESSION_RETENTION_MS: "30d" })
    ).toThrow(/Invalid session retention: 30d/);
  });

  it("validates active-local role defaults, env, flag override, and invalid values", () => {
    expect(parseCliOptions([], { PI_POSTBOX_ACTIVE_LOCAL_ROLE: "dev" })).toMatchObject({ activeLocalRole: "dev" });
    expect(
      parseCliOptions(["--active-local-role", "dev"], { PI_POSTBOX_ACTIVE_LOCAL_ROLE: "production" })
    ).toMatchObject({ activeLocalRole: "dev" });

    expect(() => parseCliOptions(["--active-local-role", "staging"], {})).toThrow(/Invalid active-local role: staging/);
    expect(() => parseCliOptions([], { PI_POSTBOX_ACTIVE_LOCAL_ROLE: "staging" })).toThrow(
      /Invalid active-local role: staging/
    );
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

  it("falls back to another local port when the preferred port is already in use and describes the non-canonical URL", async () => {
    const preferredPort = await occupyLocalPort();
    const app = await createPostboxApp({ databasePath: ":memory:" });
    apps.push(app);

    const address = await listenWithPortFallback(app, { host: "127.0.0.1", port: preferredPort });
    const actualPort = new URL(address).port;

    expect(address).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(Number(actualPort)).not.toBe(preferredPort);
    expect(describePostboxPortSelection(preferredPort, address)).toContain(
      `Preferred Postbox port ${preferredPort} is in use; using fallback port ${actualPort}`
    );
    expect(describePostboxPortSelection(44_444, "http://127.0.0.1:44444")).toContain(
      "Postbox is using non-default port 44444"
    );
    expect(describePostboxPortSelection(32_187, "http://127.0.0.1:32187")).toBeUndefined();

    const response = await fetch(`${address}/healthz`);
    expect(response.status).toBe(200);
  });

  it("publishes loopback metadata and health identity for the actual fallback port", async () => {
    const configDir = await makeConfigDir();
    const requestedPort = await occupyLocalPort();
    const app = await createPostboxApp({ databasePath: ":memory:" });
    apps.push(app);

    const address = await listenWithPortFallback(app, {
      host: "127.0.0.1",
      port: requestedPort,
      activeLocalRole: "production",
      env: { PI_POSTBOX_CONFIG_DIR: configDir }
    } as Parameters<typeof listenWithPortFallback>[1] & {
      activeLocalRole: "production";
      env: { PI_POSTBOX_CONFIG_DIR: string };
    });
    const record = await readMetadataRecord(configDir, "production");

    expect(Number(new URL(record.url).port)).not.toBe(requestedPort);
    expect(record.url).toBe(`${address}/`);

    const response = await fetch(`${address}/healthz`);
    expect(response.status).toBe(200);
    const health = HealthResponseSchema.parse(await response.json());
    expect(health.localTarget).toEqual({
      role: "production",
      instanceId: record.instanceId,
      url: record.url
    });
  });

  it("skips active-local publication for non-loopback listeners and omits health identity", async () => {
    const configDir = await makeConfigDir();
    const app = await createPostboxApp({ databasePath: ":memory:" });
    apps.push(app);

    const address = await listenWithPortFallback(app, {
      host: "0.0.0.0",
      port: 0,
      activeLocalRole: "production",
      env: { PI_POSTBOX_CONFIG_DIR: configDir }
    } as Parameters<typeof listenWithPortFallback>[1] & {
      activeLocalRole: "production";
      env: { PI_POSTBOX_CONFIG_DIR: string };
    });
    await expect(readFile(metadataPath(configDir, "production"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });

    const healthUrl = `${address.replace("0.0.0.0", "127.0.0.1")}/healthz`;
    const response = await fetch(healthUrl);
    expect(response.status).toBe(200);
    const health = HealthResponseSchema.parse(await response.json());
    expect(health.localTarget).toBeUndefined();
  });

  it("status falls back to healthy production when fresh dev metadata is unreachable", async () => {
    const configDir = await makeConfigDir();
    const productionInstanceId = "22222222-2222-4222-8222-222222222222";
    const production = await startHealthServer((url) => healthBody({ role: "production", instanceId: productionInstanceId, url }));
    const inspectTailscale = vi.fn(async ({ localUrl, role }) => ({
      state: "served" as const,
      localUrl,
      role,
      httpsPort: Number(new URL(localUrl).port),
      tailnetUrl: `https://postbox.tailnet.example:${new URL(localUrl).port}`,
      diagnostic: "fake Tailscale status"
    }));

    try {
      await writeStatusMetadata(configDir, "dev", {
        url: `http://127.0.0.1:${await getUnusedLocalPort()}/`,
        instanceId: "11111111-1111-4111-8111-111111111111"
      });
      await writeStatusMetadata(configDir, "production", { url: production.url, instanceId: productionInstanceId });

      const report = await collectPostboxServerStatus({ PI_POSTBOX_CONFIG_DIR: configDir }, { inspectTailscale });

      expect(report).toMatchObject({ localUrl: production.url, role: "production", availability: "running", health: "ok" });
      expect(report.remoteConfig).toBe(`export PI_POSTBOX_URL=https://postbox.tailnet.example:${new URL(production.url).port}`);
      expect(report.diagnostics).toContain("dev: health-unreachable");
      expect(inspectTailscale).toHaveBeenCalledTimes(1);
      expect(inspectTailscale).toHaveBeenCalledWith({ localUrl: production.url, role: "production" });
    } finally {
      await production.close();
    }
  });

  it("status rejects port-reused active-local metadata when health identity does not match", async () => {
    const configDir = await makeConfigDir();
    const devInstanceId = "33333333-3333-4333-8333-333333333333";
    const productionInstanceId = "44444444-4444-4444-8444-444444444444";
    const dev = await startHealthServer((url) =>
      healthBody({ role: "dev", instanceId: "55555555-5555-4555-8555-555555555555", url })
    );
    const production = await startHealthServer((url) => healthBody({ role: "production", instanceId: productionInstanceId, url }));
    const inspectTailscale = vi.fn(async ({ localUrl, role }) => ({
      state: "unavailable" as const,
      localUrl,
      role,
      diagnostic: "fake inspect-only status"
    }));

    try {
      await writeStatusMetadata(configDir, "dev", { url: dev.url, instanceId: devInstanceId });
      await writeStatusMetadata(configDir, "production", { url: production.url, instanceId: productionInstanceId });

      const report = await collectPostboxServerStatus({ PI_POSTBOX_CONFIG_DIR: configDir }, { inspectTailscale });

      expect(report).toMatchObject({ localUrl: production.url, role: "production", availability: "running", health: "ok" });
      expect(report.diagnostics).toContain("dev: health-identity-mismatch");
      expect(inspectTailscale).toHaveBeenCalledTimes(1);
      expect(inspectTailscale).toHaveBeenCalledWith({ localUrl: production.url, role: "production" });
    } finally {
      await Promise.all([dev.close(), production.close()]);
    }
  });

  it("status rejects non-Postbox health responses and does not inspect Tailscale without a healthy target", async () => {
    const configDir = await makeConfigDir();
    const reused = await startHealthServer(() => ({ ok: true, service: "other-service" }));
    const inspectTailscale = vi.fn();

    try {
      await writeStatusMetadata(configDir, "dev", {
        url: reused.url,
        instanceId: "66666666-6666-4666-8666-666666666666"
      });

      const report = await collectPostboxServerStatus({ PI_POSTBOX_CONFIG_DIR: configDir }, { inspectTailscale });

      expect(report).toMatchObject({ availability: "unavailable", health: "unreachable" });
      expect(report.localUrl).toBeUndefined();
      expect(report.diagnostics).toContain("dev: health-service-mismatch");
      expect(inspectTailscale).not.toHaveBeenCalled();
    } finally {
      await reused.close();
    }
  });
});
