import { PROTOCOL_VERSION, ServerProfileMetadataRecordSchema } from "@pi-postbox/protocol";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPostboxApp } from "../src/app.js";
import {
  DEFAULT_POSTBOX_PORT,
  collectPostboxServerStatus,
  createCliPostboxApp,
  describePostboxPortSelection,
  listenWithPortFallback,
  parseCliOptions
} from "../src/cli.js";

const apps: Array<{ close(): Promise<void> }> = [];
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("pi-postbox-server profile CLI", () => {
  it("uses stable production defaults with package and content-specific runtime identity", () => {
    expect(parseCliOptions([], {})).toMatchObject({
      command: "serve",
      host: "127.0.0.1",
      port: DEFAULT_POSTBOX_PORT,
      profile: { kind: "production", id: "production" },
      databasePath: join(process.env.HOME!, ".pi-postbox", "postbox.sqlite"),
      metadataPath: join(process.env.HOME!, ".pi-postbox", "active-local", "server.json"),
      tailscaleEnabled: true,
      version: "0.2.4",
      buildId: expect.stringMatching(/^0\.2\.4\+sha256\.[a-f0-9]{16}$/)
    });
  });

  it("passes the CLI package version and build fingerprint into health", async () => {
    const options = parseCliOptions(["--database=:memory:", "--no-tailscale"], {});
    const app = await createCliPostboxApp(options);
    apps.push(app);

    expect((await app.inject({ method: "GET", url: "/healthz" })).json()).toMatchObject({
      version: options.version,
      buildId: options.buildId,
      protocolVersion: PROTOCOL_VERSION
    });
  });

  it("derives isolated development resources, a dynamic port, and enabled Tailscale", () => {
    const stateHome = "/tmp/test-state";
    const profileId = "development:0123456789abcdef";
    expect(parseCliOptions(["--profile", profileId], { XDG_STATE_HOME: stateHome })).toMatchObject({
      profile: { kind: "development", id: profileId },
      port: 0,
      profileStateDir: join(stateHome, "pi-postbox", "dev", "0123456789abcdef"),
      databasePath: join(stateHome, "pi-postbox", "dev", "0123456789abcdef", "postbox.sqlite"),
      tailscaleEnabled: true
    });
  });

  it("accepts explicit profile state/database/build overrides and rejects obsolete roles", () => {
    expect(parseCliOptions([
      "--profile=development:0123456789abcdef",
      "--profile-state-dir=/tmp/profile",
      "--database=:memory:",
      "--build-id=test-build",
      "--port=43123"
    ], {})).toMatchObject({
      profileStateDir: "/tmp/profile",
      metadataPath: "/tmp/profile/active-local/server.json",
      databasePath: ":memory:",
      buildId: "test-build",
      port: 43123
    });
    expect(() => parseCliOptions(["--profile", "dev"], {})).toThrow("Invalid server profile");
  });

  it("keeps bounded session lifecycle options", () => {
    expect(parseCliOptions([
      "--session-hide-offline-after-ms", "8000",
      "--session-retention-ms", "9000"
    ], {})).toMatchObject({ sessionHideOfflineAfterMs: 8000, sessionRetentionMs: 9000 });
    expect(() => parseCliOptions(["--session-retention-ms", "0"], {})).toThrow();
  });

  it("falls back from an occupied preferred port without touching its listener", async () => {
    const blocker = await createPostboxApp({ databasePath: ":memory:" });
    apps.push(blocker);
    const occupiedAddress = await blocker.listen({ host: "127.0.0.1", port: 0 });
    const occupiedPort = Number(new URL(occupiedAddress).port);
    const fixture = await developmentFixture();
    const app = await createPostboxApp({ databasePath: ":memory:", profile: fixture.profile, buildId: "test-build" });
    apps.push(app);

    const address = await listenWithPortFallback(app, {
      host: "127.0.0.1",
      port: occupiedPort,
      profile: fixture.profile,
      metadataPath: fixture.metadataPath,
      buildId: "test-build",
      heartbeatIntervalMs: 0
    });

    expect(Number(new URL(address).port)).not.toBe(occupiedPort);
    expect(describePostboxPortSelection(occupiedPort, address)).toContain("fallback port");
    expect((await blocker.inject({ method: "GET", url: "/healthz" })).statusCode).toBe(200);
  });

  it("publishes profile metadata matching authoritative health identity", async () => {
    const fixture = await developmentFixture();
    const app = await createPostboxApp({ databasePath: ":memory:", profile: fixture.profile, buildId: "test-build" });
    apps.push(app);
    const address = await listenWithPortFallback(app, {
      host: "127.0.0.1",
      port: 0,
      profile: fixture.profile,
      metadataPath: fixture.metadataPath,
      buildId: "test-build",
      instanceId: "33333333-3333-4333-8333-333333333333",
      heartbeatIntervalMs: 0
    });

    const metadata = ServerProfileMetadataRecordSchema.parse(JSON.parse(await readFile(fixture.metadataPath, "utf8")));
    const health = (await app.inject({ method: "GET", url: "/healthz" })).json();
    expect(metadata.url).toBe(`${address}/`);
    expect(health).toMatchObject({
      profile: fixture.profile,
      buildId: "test-build",
      protocolVersion: PROTOCOL_VERSION,
      instance: {
        profile: fixture.profile,
        instanceId: metadata.instanceId,
        url: metadata.url,
        buildId: "test-build"
      }
    });
  });

  it("status inspects only the requested profile", async () => {
    const development = await developmentFixture();
    const app = await createPostboxApp({ databasePath: ":memory:", profile: development.profile, buildId: "test-build" });
    apps.push(app);
    const address = await listenWithPortFallback(app, {
      host: "127.0.0.1",
      port: 0,
      profile: development.profile,
      metadataPath: development.metadataPath,
      buildId: "test-build",
      heartbeatIntervalMs: 0
    });

    const inspectTailscale = vi.fn(async () => ({
      state: "served" as const,
      localUrl: `${address}/`,
      profile: development.profile,
      tailnetUrl: "https://coolify.tailnet.ts.net:41657",
      httpsPort: 41657
    }));
    const report = await collectPostboxServerStatus({}, {
      profile: development.profile,
      metadataPath: development.metadataPath,
      inspectTailscale
    });

    expect(report).toMatchObject({
      profile: development.profile,
      localUrl: `${address}/`,
      tailnetUrl: "https://coolify.tailnet.ts.net:41657",
      availability: "running",
      health: "ok"
    });
    expect(report.diagnostics).not.toContain(expect.stringContaining("production"));
    expect(inspectTailscale).toHaveBeenCalledWith({ localUrl: `${address}/`, profile: development.profile });
  });
});

async function developmentFixture() {
  const root = await mkdtemp(join(tmpdir(), "pi-postbox-cli-profile-"));
  tempDirs.push(root);
  return {
    profile: { kind: "development" as const, id: "development:0123456789abcdef" },
    metadataPath: join(root, "active-local", "server.json")
  };
}
