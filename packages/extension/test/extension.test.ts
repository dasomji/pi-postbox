import {
  ACTIVE_LOCAL_METADATA_DIRECTORY,
  ACTIVE_LOCAL_METADATA_FILENAMES,
  createHealthResponse,
  type ActiveLocalRole,
  type ActiveLocalTargetIdentity
} from "@pi-postbox/protocol";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const postboxClientMock = vi.hoisted(() => ({
  options: [] as Array<{ serverUrl: string; resolveTarget?: () => unknown; activeLocalPollMs?: number }>,
  started: 0,
  stopped: 0
}));

vi.mock("../src/client/PostboxClient.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/client/PostboxClient.js")>();
  return {
    ...actual,
    PostboxClient: class {
      constructor(options: { serverUrl: string; resolveTarget?: () => unknown; activeLocalPollMs?: number }) {
        postboxClientMock.options.push(options);
      }

      start() {
        postboxClientMock.started += 1;
      }

      stop() {
        postboxClientMock.stopped += 1;
      }

      updateSemanticState() {
        return true;
      }

      shutdownSession() {
        return true;
      }

      listPendingAsks() {
        return [];
      }
    }
  };
});

import { toExtensionSocketUrl } from "../src/client/PostboxClient.js";
import { getMachineIdentity } from "../src/machineIdentity.js";
import { startRegistration } from "../src/index.js";
import { collectSessionMetadata } from "../src/sessionMetadata.js";

const dirs: string[] = [];
const servers: Server[] = [];
const NOW_MS = Date.parse("2026-06-23T12:00:00.000Z");
const TTL_MS = 60_000;
const DEV_INSTANCE_ID = "11111111-1111-4111-8111-111111111111";

afterEach(async () => {
  vi.useRealTimers();
  postboxClientMock.options.length = 0;
  postboxClientMock.started = 0;
  postboxClientMock.stopped = 0;
  await Promise.all(servers.splice(0).map(closeServer));
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

  it("does not let a deactivated no-client supervisor register later metadata", async () => {
    vi.useFakeTimers();
    const env = await tempConfigEnv();
    const targetUrl = "http://127.0.0.1:3500/";
    const health = healthFetch({
      "http://127.0.0.1:3500/healthz": healthResponse({ role: "dev", instanceId: DEV_INSTANCE_ID, url: targetUrl })
    });
    let active = true;
    const uiScope = {
      isActive: () => active,
      deactivate: () => {
        active = false;
      },
      notify: () => undefined,
      setStatus: () => undefined,
      setWidget: () => undefined
    };

    await startRegistration(
      { getSessionName: () => "Deactivated delayed recovery", on: () => undefined },
      { cwd: process.cwd(), sessionManager: { getSessionFile: () => "/tmp/session.jsonl", getLeafId: () => "leaf-1" } },
      env,
      uiScope,
      "fallback-deactivated",
      {
        resolveOptions: { fetch: health.fetch, nowMs: NOW_MS, ttlMs: TTL_MS },
        supervisor: { initialDelayMs: 25, maxDelayMs: 25 }
      }
    );

    uiScope.deactivate();
    await writeMetadata(env, {
      role: "dev",
      instanceId: DEV_INSTANCE_ID,
      url: targetUrl,
      updatedAt: new Date(NOW_MS).toISOString()
    });
    await vi.advanceTimersByTimeAsync(25);

    expect(postboxClientMock.started).toBe(0);
  });

  it("supervises no-client startup and registers once active-local metadata appears", async () => {
    vi.useFakeTimers();
    const env = await tempConfigEnv();
    const statuses: string[] = [];
    const targetUrl = "http://127.0.0.1:3500/";
    const health = healthFetch({
      "http://127.0.0.1:3500/healthz": healthResponse({ role: "dev", instanceId: DEV_INSTANCE_ID, url: targetUrl })
    });

    await startRegistration(
      { getSessionName: () => "Delayed active local recovery", on: () => undefined },
      {
        cwd: process.cwd(),
        ui: { setStatus: (_key, value) => statuses.push(value), notify: (message) => statuses.push(message) },
        sessionManager: { getSessionFile: () => "/tmp/session.jsonl", getLeafId: () => "leaf-1" }
      },
      env,
      undefined,
      "fallback-delayed",
      {
        resolveOptions: { fetch: health.fetch, nowMs: NOW_MS, ttlMs: TTL_MS },
        supervisor: { initialDelayMs: 25, maxDelayMs: 25 }
      }
    );

    expect(statuses).toContain("Postbox unavailable");
    expect(postboxClientMock.started).toBe(0);

    await writeMetadata(env, {
      role: "dev",
      instanceId: DEV_INSTANCE_ID,
      url: targetUrl,
      updatedAt: new Date(NOW_MS).toISOString()
    });
    await vi.advanceTimersByTimeAsync(25);
    await vi.waitFor(() => expect(postboxClientMock.started).toBe(1));

    expect(postboxClientMock.options.at(-1)).toMatchObject({ serverUrl: targetUrl });

    await vi.advanceTimersByTimeAsync(100);
    expect(postboxClientMock.started).toBe(1);
  });

  it("registers against fresh active-local metadata when no serverUrl is configured", async () => {
    const env = await tempConfigEnv();
    const server = await startHealthServer({ role: "dev", instanceId: DEV_INSTANCE_ID });
    await writeMetadata(env, {
      role: "dev",
      instanceId: DEV_INSTANCE_ID,
      url: server.url,
      updatedAt: new Date(NOW_MS).toISOString()
    });
    const statuses: string[] = [];

    await startRegistration(
      { getSessionName: () => "Active local recovery", on: () => undefined },
      {
        cwd: process.cwd(),
        ui: { setStatus: (_key, value) => statuses.push(value), notify: (message) => statuses.push(message) },
        sessionManager: { getSessionFile: () => "/tmp/session.jsonl", getLeafId: () => "leaf-1" }
      },
      env
    );

    expect(statuses).not.toContain("Postbox not configured");
    expect(postboxClientMock.options.at(-1)).toMatchObject({ serverUrl: server.url });
    expect(postboxClientMock.started).toBe(1);
  });

  it("passes an active-local retarget resolver hook to eligible local Postbox clients", async () => {
    const env = await tempConfigEnv();
    const server = await startHealthServer({ role: "dev", instanceId: DEV_INSTANCE_ID });
    await writeMetadata(env, {
      role: "dev",
      instanceId: DEV_INSTANCE_ID,
      url: server.url,
      updatedAt: new Date(NOW_MS).toISOString()
    });

    await startRegistration(
      { getSessionName: () => "Active local retarget hook", on: () => undefined },
      {
        cwd: process.cwd(),
        ui: { setStatus: () => undefined, notify: () => undefined },
        sessionManager: { getSessionFile: () => "/tmp/session.jsonl", getLeafId: () => "leaf-1" }
      },
      env,
      undefined,
      "fallback-retarget-hook"
    );

    const options = postboxClientMock.options.at(-1);
    expect(options).toMatchObject({ serverUrl: server.url });
    expect(options?.resolveTarget).toEqual(expect.any(Function));
    await expect(options?.resolveTarget?.()).resolves.toMatchObject({
      status: "selected",
      target: { url: server.url, activeLocalPollingEnabled: true, source: "active-local" }
    });
  });

  it("does not pass a retarget resolver hook for explicit remote Postbox clients", async () => {
    const env = await tempConfigEnv({ PI_POSTBOX_URL: "https://postbox.tailnet.example/" });
    await startRegistration(
      { getSessionName: () => "Explicit remote no retarget", on: () => undefined },
      {
        cwd: process.cwd(),
        ui: { setStatus: () => undefined, notify: () => undefined },
        sessionManager: { getSessionFile: () => "/tmp/session.jsonl", getLeafId: () => "leaf-1" }
      },
      env,
      undefined,
      "fallback-remote"
    );

    expect(postboxClientMock.options.at(-1)).toMatchObject({ serverUrl: "https://postbox.tailnet.example/" });
    expect(postboxClientMock.options.at(-1)?.resolveTarget).toBeUndefined();
  });
});

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

async function startHealthServer(localTarget: Omit<ActiveLocalTargetIdentity, "url">): Promise<{ url: string }> {
  const server = createServer((request, response) => {
    if (request.url !== "/healthz") {
      response.writeHead(404);
      response.end();
      return;
    }

    const address = server.address();
    if (!address || typeof address === "string") {
      response.writeHead(500);
      response.end();
      return;
    }

    const url = `http://127.0.0.1:${address.port}/`;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify(
        createHealthResponse({ startedAtMs: NOW_MS - 1_000, nowMs: NOW_MS, localTarget: { ...localTarget, url } })
      )
    );
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP server address");
  return { url: `http://127.0.0.1:${address.port}/` };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
