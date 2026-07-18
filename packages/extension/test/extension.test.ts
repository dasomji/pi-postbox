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
  options: [] as Array<{
    serverUrl: string;
    registration?: { session: { sessionId: string } };
    resolveTarget?: () => unknown;
    activeLocalPollMs?: number;
    activeLocalPollingEnabled?: boolean;
    onLocalFallbackStatus?: (status: { requestId: string; serverUrl: string; message: string } | undefined) => void;
  }>,
  started: 0,
  stopped: 0
}));
const questionChatMock = vi.hoisted(() => ({
  cleanupAll: vi.fn<(ownerSessionId?: string) => Promise<void>>(async () => undefined),
  suspendAll: vi.fn<() => Promise<void>>(async () => undefined)
}));

vi.mock("../src/client/PostboxClient.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/client/PostboxClient.js")>();
  return {
    ...actual,
    PostboxClient: class {
      constructor(options: {
        serverUrl: string;
        registration?: { session: { sessionId: string } };
        resolveTarget?: () => unknown;
        activeLocalPollMs?: number;
        activeLocalPollingEnabled?: boolean;
        onLocalFallbackStatus?: (status: { requestId: string; serverUrl: string; message: string } | undefined) => void;
      }) {
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

      getStatusSnapshot() {
        return {
          connection: { state: "connected", activeUrl: "http://127.0.0.1:3500/", localUrl: "http://127.0.0.1:3500/", tailnetUrl: "https://coolify.tailnet.ts.net:3500" },
          openQuestionCount: 1,
          autostart: { enabled: true, startedByThisSession: false },
          diagnostics: []
        };
      }
    }
  };
});

vi.mock("../src/questionChatRuntime.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/questionChatRuntime.js")>();
  return {
    ...actual,
    PiQuestionChatRuntimeAdapter: class {},
    QuestionChatRuntimeRegistry: class {
      cleanupAll = questionChatMock.cleanupAll;
      suspendAll = questionChatMock.suspendAll;
    }
  };
});

import { toExtensionSocketUrl } from "../src/client/PostboxClient.js";
import { getMachineIdentity } from "../src/machineIdentity.js";
import postboxExtension, { startRegistration } from "../src/index.js";
import { collectSessionMetadata } from "../src/sessionMetadata.js";

const dirs: string[] = [];
const servers: Server[] = [];
const NOW_MS = Date.parse("2026-06-23T12:00:00.000Z");
const TTL_MS = 60_000;
const DEV_INSTANCE_ID = "11111111-1111-4111-8111-111111111111";

afterEach(async () => {
  resetExtensionModuleState();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  postboxClientMock.options.length = 0;
  postboxClientMock.started = 0;
  postboxClientMock.stopped = 0;
  questionChatMock.cleanupAll.mockReset();
  questionChatMock.cleanupAll.mockResolvedValue(undefined);
  questionChatMock.suspendAll.mockReset();
  questionChatMock.suspendAll.mockResolvedValue(undefined);
  await Promise.all(servers.splice(0).map(closeServer));
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempConfigEnv(extra: NodeJS.ProcessEnv = {}): Promise<NodeJS.ProcessEnv> {
  const dir = await mkdtemp(join(tmpdir(), "pi-postbox-extension-"));
  dirs.push(dir);
  return { ...extra, PI_POSTBOX_CONFIG_PATH: join(dir, "config.json") };
}

describe("Pi Postbox extension registration", () => {
  it("does not complete terminal session shutdown before Question Chat abort cleanup", async () => {
    let finishAbort!: () => void;
    questionChatMock.cleanupAll.mockImplementationOnce(
      () => new Promise<void>((resolve) => {
        finishAbort = resolve;
      })
    );
    const shutdownHandlers: Array<(event: unknown, ctx: Record<string, unknown>) => unknown> = [];
    postboxExtension({
      on(event, handler) {
        if (event === "session_shutdown") shutdownHandlers.push(handler);
      },
      registerTool: () => undefined,
      registerCommand: () => undefined
    });

    const shutdown = Promise.resolve(shutdownHandlers.at(-1)!({ reason: "quit" }, { cwd: process.cwd() }));
    let completed = false;
    void shutdown.then(() => {
      completed = true;
    });
    await Promise.resolve();

    expect(questionChatMock.cleanupAll).toHaveBeenCalledOnce();
    expect(completed).toBe(false);
    finishAbort();
    await shutdown;
    expect(completed).toBe(true);
  });

  it("suspends SDK Question Chat runtimes on reload without deleting their recovery manifests", async () => {
    const shutdownHandlers: Array<(event: unknown, ctx: Record<string, unknown>) => unknown> = [];
    postboxExtension({
      on(event, handler) {
        if (event === "session_shutdown") shutdownHandlers.push(handler);
      },
      registerTool: () => undefined,
      registerCommand: () => undefined
    });

    await shutdownHandlers.at(-1)!({ reason: "reload" }, { cwd: process.cwd() });
    expect(questionChatMock.suspendAll).toHaveBeenCalledOnce();
    expect(questionChatMock.cleanupAll).not.toHaveBeenCalled();
  });

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

  it("preserves a generated session identity across reload but rotates it on replacement", async () => {
    const server = await startHealthServer({ role: "dev", instanceId: DEV_INSTANCE_ID });
    vi.stubEnv("PI_POSTBOX_URL", server.url);
    const handlers = new Map<string, Array<(event: unknown, ctx: Record<string, any>) => unknown>>();
    const api = {
      getSessionName: () => "Ephemeral reload session",
      on(event: string, handler: (event: unknown, ctx: Record<string, any>) => unknown) {
        handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      },
      registerTool: () => undefined,
      registerCommand: () => undefined
    };
    const ctx = {
      cwd: process.cwd(),
      ui: { setStatus: () => undefined, notify: () => undefined, setWidget: () => undefined },
      sessionManager: { getSessionFile: () => undefined, getLeafId: () => undefined }
    };
    const emit = async (event: string, payload: unknown) => {
      await Promise.all((handlers.get(event) ?? []).map((handler) => handler(payload, ctx)));
    };

    postboxExtension(api);
    await emit("session_start", {});
    await vi.waitFor(() => expect(postboxClientMock.started).toBe(1));
    const originalOwner = postboxClientMock.options.at(-1)!.registration!.session.sessionId;

    await emit("session_shutdown", { reason: "reload" });
    await emit("session_start", {});
    await vi.waitFor(() => expect(postboxClientMock.started).toBe(2));
    expect(postboxClientMock.options.at(-1)!.registration!.session.sessionId).toBe(originalOwner);

    await emit("session_shutdown", { reason: "new" });
    await emit("session_start", {});
    await vi.waitFor(() => expect(postboxClientMock.started).toBe(3));
    expect(postboxClientMock.options.at(-1)!.registration!.session.sessionId).not.toBe(originalOwner);
  });

  it("shows the active Postbox URL in the footer while an ask is waiting", async () => {
    const env = await tempConfigEnv({ PI_POSTBOX_URL: "https://postbox.example/" });
    const statuses: Array<{ key: string; value: string }> = [];
    const widgets: string[][] = [];
    const handlers = new Map<string, Array<(event: unknown, ctx: any) => unknown>>();
    const api = {
      getSessionName: () => "Footer URL test",
      on: (event: string, handler: (event: unknown, ctx: any) => unknown) => {
        handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      },
      registerTool: () => undefined,
      registerCommand: () => undefined
    };
    postboxExtension(api);

    await startRegistration(
      api,
      {
        cwd: process.cwd(),
        ui: {
          setStatus: (key, value) => statuses.push({ key, value }),
          notify: () => undefined,
          setWidget: (_key, value) => widgets.push(value)
        },
        sessionManager: { getSessionFile: () => "/tmp/session.jsonl", getLeafId: () => "leaf-1" }
      },
      env,
      undefined,
      "footer-url",
      {
        resolveOptions: {
          fetch: healthFetch({
            "https://postbox.example/healthz": createHealthResponse({ startedAtMs: NOW_MS - 1_000, nowMs: NOW_MS })
          }).fetch,
          nowMs: NOW_MS,
          ttlMs: TTL_MS
        }
      }
    );

    postboxClientMock.options.at(-1)?.onLocalFallbackStatus?.({
      requestId: "ask-footer-url",
      serverUrl: "http://127.0.0.1:3500/",
      message: "Postbox waiting ask-footer-url. Open http://127.0.0.1:3500/ to answer."
    });

    await vi.waitFor(() => expect(statuses).toContainEqual({ key: "postbox-ask", value: "Postbox https://coolify.tailnet.ts.net:3500" }));
    expect(statuses).not.toContainEqual({ key: "postbox-ask", value: "Waiting ask-footer-url" });
    expect(widgets.at(-1)?.[0]).toContain("Open https://coolify.tailnet.ts.net:3500");

    const shutdownCtx = { cwd: process.cwd(), ui: { setStatus: () => undefined, notify: () => undefined, setWidget: () => undefined } };
    for (const handler of handlers.get("session_shutdown") ?? []) handler({}, shutdownCtx);
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
    await vi.advanceTimersByTimeAsync(100);
    await vi.waitFor(() => expect(postboxClientMock.started).toBe(1));

    expect(postboxClientMock.options.at(-1)).toMatchObject({ serverUrl: targetUrl });

    await vi.advanceTimersByTimeAsync(100);
    expect(postboxClientMock.started).toBe(1);
  });

  it("supervises no-client startup and registers a recovered explicit remote target", async () => {
    vi.useFakeTimers();
    const remoteUrl = "https://postbox.tailnet.example:32187/";
    const env = await tempConfigEnv({ PI_POSTBOX_URL: remoteUrl });
    const statuses: string[] = [];
    let remoteHealthy = false;
    const health = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.redirect).toBe("manual");
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      expect(url).toBe(new URL("healthz", remoteUrl).toString());
      if (!remoteHealthy) throw new Error("remote unavailable");
      return new Response(JSON.stringify(createHealthResponse({ startedAtMs: NOW_MS - 1_000, nowMs: NOW_MS })), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    });

    await startRegistration(
      { getSessionName: () => "Delayed explicit remote recovery", on: () => undefined },
      {
        cwd: process.cwd(),
        ui: { setStatus: (_key, value) => statuses.push(value), notify: (message) => statuses.push(message) },
        sessionManager: { getSessionFile: () => "/tmp/session.jsonl", getLeafId: () => "leaf-1" }
      },
      env,
      undefined,
      "fallback-delayed-remote",
      {
        resolveOptions: { fetch: health, nowMs: NOW_MS, ttlMs: TTL_MS },
        supervisor: { initialDelayMs: 25, maxDelayMs: 25 }
      }
    );

    expect(statuses).toContain("Postbox unavailable");
    expect(postboxClientMock.started).toBe(0);

    remoteHealthy = true;
    await vi.advanceTimersByTimeAsync(100);
    await vi.waitFor(() => expect(postboxClientMock.started).toBe(1));

    expect(postboxClientMock.options.at(-1)).toMatchObject({ serverUrl: remoteUrl });
    expect(postboxClientMock.options.at(-1)?.resolveTarget).toBeUndefined();
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
      env,
      undefined,
      undefined,
      { resolveOptions: { nowMs: NOW_MS, ttlMs: TTL_MS } }
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
      "fallback-retarget-hook",
      { resolveOptions: { nowMs: NOW_MS, ttlMs: TTL_MS } }
    );

    const options = postboxClientMock.options.at(-1);
    expect(options).toMatchObject({ serverUrl: server.url });
    expect(options?.resolveTarget).toEqual(expect.any(Function));
    await expect(options?.resolveTarget?.()).resolves.toMatchObject({
      status: "selected",
      target: { url: server.url, activeLocalPollingEnabled: true, source: "active-local" }
    });
  });

  it("preserves fallback active-local session stickiness when metadata points at another local server", async () => {
    const originalUrl = "http://127.0.0.1:3500/";
    const replacementUrl = "http://127.0.0.1:3600/";
    const replacementInstanceId = "22222222-2222-4222-8222-222222222222";
    const env = await tempConfigEnv();
    await writeMetadata(env, {
      role: "dev",
      instanceId: DEV_INSTANCE_ID,
      url: originalUrl,
      updatedAt: new Date(NOW_MS).toISOString()
    });
    const health = healthFetch({
      "http://127.0.0.1:3500/healthz": healthResponse({ role: "dev", instanceId: DEV_INSTANCE_ID, url: originalUrl }),
      "http://127.0.0.1:3600/healthz": healthResponse({ role: "dev", instanceId: replacementInstanceId, url: replacementUrl })
    });

    await startRegistration(
      { getSessionName: () => "Fallback active-local stickiness", on: () => undefined },
      {
        cwd: process.cwd(),
        ui: { setStatus: () => undefined, notify: () => undefined },
        sessionManager: { getSessionFile: () => "/tmp/session.jsonl", getLeafId: () => "leaf-1" }
      },
      env,
      undefined,
      "fallback-active-local-sticky",
      { resolveOptions: { fetch: health.fetch, nowMs: NOW_MS, ttlMs: TTL_MS } }
    );

    const options = postboxClientMock.options.at(-1);
    expect(options).toMatchObject({ serverUrl: originalUrl, activeLocalPollingEnabled: true });
    expect(options?.resolveTarget).toEqual(expect.any(Function));

    await writeMetadata(env, {
      role: "dev",
      instanceId: replacementInstanceId,
      url: replacementUrl,
      updatedAt: new Date(NOW_MS).toISOString()
    });

    await expect(options?.resolveTarget?.()).resolves.toMatchObject({
      status: "unavailable",
      diagnostics: expect.arrayContaining([expect.objectContaining({ code: "session-sticky-target-mismatch" })])
    });
  });

  it("keeps fallback active-local clients from polling back to a recovered configured remote", async () => {
    const configuredRemote = "https://postbox.tailnet.example:32187/";
    const localUrl = "http://127.0.0.1:3500/";
    const env = await tempConfigEnv({ PI_POSTBOX_URL: configuredRemote });
    await writeMetadata(env, {
      role: "dev",
      instanceId: DEV_INSTANCE_ID,
      url: localUrl,
      updatedAt: new Date(NOW_MS).toISOString()
    });
    const responses: Record<string, unknown | Error> = {
      "https://postbox.tailnet.example:32187/healthz": new Error("remote unavailable"),
      "http://127.0.0.1:3500/healthz": healthResponse({ role: "dev", instanceId: DEV_INSTANCE_ID, url: localUrl })
    };
    const health = healthFetch(responses);

    await startRegistration(
      { getSessionName: () => "Fallback active-local affinity", on: () => undefined },
      {
        cwd: process.cwd(),
        ui: { setStatus: () => undefined, notify: () => undefined },
        sessionManager: { getSessionFile: () => "/tmp/session.jsonl", getLeafId: () => "leaf-1" }
      },
      env,
      undefined,
      "fallback-active-local-affinity",
      { resolveOptions: { fetch: health.fetch, nowMs: NOW_MS, ttlMs: TTL_MS } }
    );

    const options = postboxClientMock.options.at(-1);
    expect(options).toMatchObject({ serverUrl: localUrl });
    expect(options?.resolveTarget).toEqual(expect.any(Function));

    health.fetch.mockClear();
    responses["https://postbox.tailnet.example:32187/healthz"] = createHealthResponse({
      startedAtMs: NOW_MS - 1_000,
      nowMs: NOW_MS
    });

    await expect(options?.resolveTarget?.()).resolves.toMatchObject({
      status: "selected",
      target: { source: "active-local", url: localUrl, activeLocalPollingEnabled: true }
    });
    expect(health.fetch).not.toHaveBeenCalledWith(new URL("https://postbox.tailnet.example:32187/healthz"), expect.any(Object));
    expect(health.fetch).toHaveBeenCalledWith(new URL("http://127.0.0.1:3500/healthz"), expect.any(Object));
  });

  it("does not pass a retarget resolver hook for explicit remote Postbox clients", async () => {
    const env = await tempConfigEnv({ PI_POSTBOX_URL: "https://postbox.tailnet.example/" });
    const health = healthFetch({
      "https://postbox.tailnet.example/healthz": createHealthResponse({ startedAtMs: NOW_MS - 1_000, nowMs: NOW_MS })
    });

    await startRegistration(
      { getSessionName: () => "Explicit remote no retarget", on: () => undefined },
      {
        cwd: process.cwd(),
        ui: { setStatus: () => undefined, notify: () => undefined },
        sessionManager: { getSessionFile: () => "/tmp/session.jsonl", getLeafId: () => "leaf-1" }
      },
      env,
      undefined,
      "fallback-remote",
      { resolveOptions: { fetch: health.fetch, nowMs: NOW_MS, ttlMs: TTL_MS } }
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

function healthFetch(responses: Record<string, unknown | Error>) {
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(init?.redirect).toBe("manual");
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (!(url in responses)) {
      throw new Error(`Unexpected health probe ${url}`);
    }
    const response = responses[url];
    if (response instanceof Error) {
      throw response;
    }
    return new Response(JSON.stringify(response), {
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

function resetExtensionModuleState(): void {
  const shutdownHandlers: Array<(event: unknown, ctx: Record<string, unknown>) => unknown> = [];
  postboxExtension({
    getSessionName: () => "Reset extension state",
    on(event: string, handler: (event: unknown, ctx: Record<string, unknown>) => unknown) {
      if (event === "session_shutdown") shutdownHandlers.push(handler);
    },
    registerTool: () => undefined,
    registerCommand: () => undefined
  });
  for (const handler of shutdownHandlers) {
    handler({}, { cwd: process.cwd(), ui: { setStatus: () => undefined, notify: () => undefined, setWidget: () => undefined } });
  }
}
