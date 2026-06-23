import {
  ACTIVE_LOCAL_METADATA_DIRECTORY,
  ACTIVE_LOCAL_METADATA_FILENAMES,
  createHealthResponse,
  type ActiveLocalRole,
  type ActiveLocalTargetIdentity
} from "@pi-postbox/protocol";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const tempDirs: string[] = [];
const NOW_MS = Date.parse("2026-06-23T12:00:00.000Z");
const TTL_MS = 60_000;
const DEV_INSTANCE_ID = "11111111-1111-4111-8111-111111111111";
const PRODUCTION_INSTANCE_ID = "22222222-2222-4222-8222-222222222222";

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("active-local extension target resolver", () => {
  it("keeps an explicit non-loopback PI_POSTBOX_URL authoritative and disables active-local recovery", async () => {
    const env = await tempConfigEnv({ PI_POSTBOX_URL: "https://postbox.tailnet.example:32187" });
    await writeMetadata(env, {
      role: "dev",
      instanceId: DEV_INSTANCE_ID,
      url: "http://127.0.0.1:3500/",
      updatedAt: new Date(NOW_MS).toISOString()
    });
    const health = healthFetch({
      "http://127.0.0.1:3500/healthz": healthResponse({ role: "dev", instanceId: DEV_INSTANCE_ID, url: "http://127.0.0.1:3500/" })
    });

    const result = await resolveActiveLocalTarget({ env, fetch: health.fetch, nowMs: NOW_MS, ttlMs: TTL_MS });

    expect(result).toMatchObject({
      status: "selected",
      target: {
        source: "explicit-remote",
        url: "https://postbox.tailnet.example:32187",
        activeLocalPollingEnabled: false
      }
    });
    expect(health.fetch).not.toHaveBeenCalled();
  });

  it("does not treat DNS hostnames beginning with 127 as recoverable loopback configuration", async () => {
    const env = await tempConfigEnv({ PI_POSTBOX_URL: "http://127.evil.example:32187/" });
    await writeMetadata(env, {
      role: "dev",
      instanceId: DEV_INSTANCE_ID,
      url: "http://127.0.0.1:3500/",
      updatedAt: new Date(NOW_MS).toISOString()
    });
    const health = healthFetch({
      "http://127.0.0.1:3500/healthz": healthResponse({ role: "dev", instanceId: DEV_INSTANCE_ID, url: "http://127.0.0.1:3500/" })
    });

    const result = await resolveActiveLocalTarget({ env, fetch: health.fetch, nowMs: NOW_MS, ttlMs: TTL_MS });

    expect(result).toMatchObject({
      status: "selected",
      target: {
        source: "explicit-remote",
        url: "http://127.evil.example:32187/",
        activeLocalPollingEnabled: false
      }
    });
    expect(health.fetch).not.toHaveBeenCalled();
  });

  it("selects fresh healthy dev metadata over fresh healthy production when no URL is configured", async () => {
    const env = await tempConfigEnv();
    await writeMetadata(env, {
      role: "dev",
      instanceId: DEV_INSTANCE_ID,
      url: "http://127.0.0.1:3500/",
      updatedAt: new Date(NOW_MS).toISOString()
    });
    await writeMetadata(env, {
      role: "production",
      instanceId: PRODUCTION_INSTANCE_ID,
      url: "http://127.0.0.1:32187/",
      updatedAt: new Date(NOW_MS).toISOString()
    });
    const health = healthFetch({
      "http://127.0.0.1:3500/healthz": healthResponse({ role: "dev", instanceId: DEV_INSTANCE_ID, url: "http://127.0.0.1:3500/" }),
      "http://127.0.0.1:32187/healthz": healthResponse({
        role: "production",
        instanceId: PRODUCTION_INSTANCE_ID,
        url: "http://127.0.0.1:32187/"
      })
    });

    const result = await resolveActiveLocalTarget({ env, fetch: health.fetch, nowMs: NOW_MS, ttlMs: TTL_MS });

    expect(result).toMatchObject({
      status: "selected",
      target: { source: "active-local", role: "dev", url: "http://127.0.0.1:3500/" }
    });
  });

  it("falls back to fresh healthy production when dev metadata is stale or unhealthy", async () => {
    const env = await tempConfigEnv();
    await writeMetadata(env, {
      role: "dev",
      instanceId: DEV_INSTANCE_ID,
      url: "http://127.0.0.1:3500/",
      updatedAt: new Date(NOW_MS - TTL_MS - 1).toISOString()
    });
    await writeMetadata(env, {
      role: "production",
      instanceId: PRODUCTION_INSTANCE_ID,
      url: "http://127.0.0.1:32187/",
      updatedAt: new Date(NOW_MS).toISOString()
    });
    const health = healthFetch({
      "http://127.0.0.1:32187/healthz": healthResponse({
        role: "production",
        instanceId: PRODUCTION_INSTANCE_ID,
        url: "http://127.0.0.1:32187/"
      })
    });

    const result = await resolveActiveLocalTarget({ env, fetch: health.fetch, nowMs: NOW_MS, ttlMs: TTL_MS });

    expect(result).toMatchObject({
      status: "selected",
      target: { source: "active-local", role: "production", url: "http://127.0.0.1:32187/" }
    });
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "stale", role: "dev" }));
  });

  it("recovers a dead configured loopback URL by selecting fresh healthy production metadata", async () => {
    const env = await tempConfigEnv();
    await writeConfig(env, { serverUrl: "http://127.0.0.1:33375" });
    await writeMetadata(env, {
      role: "production",
      instanceId: PRODUCTION_INSTANCE_ID,
      url: "http://127.0.0.1:32187/",
      updatedAt: new Date(NOW_MS).toISOString()
    });
    const health = healthFetch({
      "http://127.0.0.1:32187/healthz": healthResponse({
        role: "production",
        instanceId: PRODUCTION_INSTANCE_ID,
        url: "http://127.0.0.1:32187/"
      })
    });

    const result = await resolveActiveLocalTarget({ env, fetch: health.fetch, nowMs: NOW_MS, ttlMs: TTL_MS });

    expect(result).toMatchObject({
      status: "selected",
      target: { source: "active-local", role: "production", url: "http://127.0.0.1:32187/" }
    });
  });

  it("uses a configured loopback URL only as a health-verified configured-loopback fallback when metadata is absent", async () => {
    const env = await tempConfigEnv({ PI_POSTBOX_URL: "http://127.0.0.1:33375" });
    const health = healthFetch({
      "http://127.0.0.1:33375/healthz": createHealthResponse({ startedAtMs: NOW_MS - 1_000, nowMs: NOW_MS })
    });

    const result = await resolveActiveLocalTarget({ env, fetch: health.fetch, nowMs: NOW_MS, ttlMs: TTL_MS });

    expect(result).toMatchObject({
      status: "selected",
      target: { source: "configured-loopback", url: "http://127.0.0.1:33375/" }
    });
  });

  it("rejects symlinked and oversized metadata with sanitized diagnostics", async () => {
    const env = await tempConfigEnv();
    const activeLocalDir = join(dirname(env.PI_POSTBOX_CONFIG_PATH!), ACTIVE_LOCAL_METADATA_DIRECTORY);
    await mkdir(activeLocalDir, { recursive: true });
    const victim = join(dirname(env.PI_POSTBOX_CONFIG_PATH!), "outside-dev.json");
    await writeFile(victim, JSON.stringify({ secret: "do-not-read" }));
    await symlink(victim, join(activeLocalDir, ACTIVE_LOCAL_METADATA_FILENAMES.dev));
    await writeFile(join(activeLocalDir, ACTIVE_LOCAL_METADATA_FILENAMES.production), "x".repeat(4_097));

    const result = await resolveActiveLocalTarget({ env, fetch: healthFetch({}).fetch, nowMs: NOW_MS, ttlMs: TTL_MS });

    expect(result).toMatchObject({ status: "unavailable" });
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "symlink", role: "dev", source: "dev.json" }));
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "too-large", role: "production", source: "production.json" }));
    for (const diagnostic of result.diagnostics) {
      expect(JSON.stringify(diagnostic)).not.toContain(dirname(env.PI_POSTBOX_CONFIG_PATH!));
      expect(JSON.stringify(diagnostic)).not.toContain("do-not-read");
    }
  });

  it("requires health localTarget identity to match metadata role, instance id, and normalized URL exactly", async () => {
    const env = await tempConfigEnv();
    await writeMetadata(env, {
      role: "dev",
      instanceId: DEV_INSTANCE_ID,
      url: "http://127.0.0.1:3500/",
      updatedAt: new Date(NOW_MS).toISOString()
    });
    await writeMetadata(env, {
      role: "production",
      instanceId: PRODUCTION_INSTANCE_ID,
      url: "http://127.0.0.1:32187/",
      updatedAt: new Date(NOW_MS).toISOString()
    });
    const health = healthFetch({
      "http://127.0.0.1:3500/healthz": healthResponse({
        role: "dev",
        instanceId: "33333333-3333-4333-8333-333333333333",
        url: "http://127.0.0.1:3500/"
      }),
      "http://127.0.0.1:32187/healthz": healthResponse({
        role: "production",
        instanceId: PRODUCTION_INSTANCE_ID,
        url: "http://127.0.0.1:32187/"
      })
    });

    const result = await resolveActiveLocalTarget({ env, fetch: health.fetch, nowMs: NOW_MS, ttlMs: TTL_MS });

    expect(result).toMatchObject({
      status: "selected",
      target: { source: "active-local", role: "production", url: "http://127.0.0.1:32187/" }
    });
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "health-identity-mismatch", role: "dev" }));
  });
});

async function resolveActiveLocalTarget(options: Record<string, unknown>): Promise<any> {
  const module = await import("../src/activeLocalTargetResolver.js");
  return module.resolveActiveLocalTarget(options);
}

async function tempConfigEnv(extra: NodeJS.ProcessEnv = {}): Promise<NodeJS.ProcessEnv> {
  const dir = await mkdtemp(join(tmpdir(), "pi-postbox-extension-resolver-"));
  tempDirs.push(dir);
  return { ...extra, PI_POSTBOX_CONFIG_PATH: join(dir, "config.json") };
}

async function writeConfig(env: NodeJS.ProcessEnv, config: { serverUrl?: string }): Promise<void> {
  await mkdir(dirname(env.PI_POSTBOX_CONFIG_PATH!), { recursive: true });
  await writeFile(env.PI_POSTBOX_CONFIG_PATH!, `${JSON.stringify(config, null, 2)}\n`);
}

async function writeMetadata(
  env: NodeJS.ProcessEnv,
  record: { role: ActiveLocalRole; instanceId: string; url: string; updatedAt: string }
): Promise<void> {
  const activeLocalDir = join(dirname(env.PI_POSTBOX_CONFIG_PATH!), ACTIVE_LOCAL_METADATA_DIRECTORY);
  await mkdir(activeLocalDir, { recursive: true });
  await writeFile(
    join(activeLocalDir, ACTIVE_LOCAL_METADATA_FILENAMES[record.role]),
    `${JSON.stringify({ version: 1, ...record }, null, 2)}\n`
  );
}

function healthResponse(localTarget: ActiveLocalTargetIdentity) {
  return createHealthResponse({ startedAtMs: NOW_MS - 1_000, nowMs: NOW_MS, localTarget });
}

function healthFetch(responses: Record<string, unknown>) {
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(init?.redirect).toBe("manual");
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (!(url in responses)) {
      throw new Error(`Unexpected health probe ${url}`);
    }
    return new Response(JSON.stringify(responses[url]), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  });
  return { fetch };
}
