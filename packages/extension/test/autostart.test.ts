import {
  ACTIVE_LOCAL_METADATA_DIRECTORY,
  ACTIVE_LOCAL_METADATA_FILENAMES,
  createHealthResponse,
  type ActiveLocalRole,
  type ActiveLocalTargetIdentity
} from "@pi-postbox/protocol";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const childProcessMock = vi.hoisted(() => ({
  children: [] as Array<{
    kill: ReturnType<typeof vi.fn>;
    unref: ReturnType<typeof vi.fn>;
    emit: (event: string, ...args: unknown[]) => boolean;
    exitCode: number | null;
    signalCode: NodeJS.Signals | null;
  }>
}));

const fsMock = vi.hoisted(() => ({
  packageLocalCliExists: true
}));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  const { EventEmitter } = await import("node:events");
  return {
    ...actual,
    spawn: vi.fn(() => {
      const child = new EventEmitter() as unknown as {
        pid: number;
        kill: ReturnType<typeof vi.fn>;
        unref: ReturnType<typeof vi.fn>;
        stdout: InstanceType<typeof EventEmitter>;
        stderr: InstanceType<typeof EventEmitter>;
        exitCode: number | null;
        signalCode: NodeJS.Signals | null;
      };
      child.pid = 4242;
      child.kill = vi.fn();
      child.unref = vi.fn();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.exitCode = null;
      child.signalCode = null;
      childProcessMock.children.push(child);
      return child;
    })
  };
});

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: vi.fn(() => fsMock.packageLocalCliExists)
  };
});

const postboxClientMock = vi.hoisted(() => ({
  options: [] as Array<{ serverUrl: string; resolveTarget?: () => unknown; activeLocalPollingEnabled?: boolean }>,
  asks: [] as unknown[],
  started: 0,
  stopped: 0
}));

vi.mock("../src/client/PostboxClient.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/client/PostboxClient.js")>();
  return {
    ...actual,
    PostboxClient: class {
      constructor(private readonly options: { serverUrl: string; resolveTarget?: () => unknown; activeLocalPollingEnabled?: boolean }) {
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

      ask(payload: { requestId: string; options: Array<{ value: string }> }) {
        postboxClientMock.asks.push(payload);
        return Promise.resolve({
          status: "answered",
          requestId: payload.requestId,
          selectedValues: [payload.options[0]?.value ?? "ok"],
          resolvedAt: "2026-06-23T12:00:01.000Z"
        });
      }
    }
  };
});

import { getPostboxAutostartFailureDiagnostic } from "../src/autostart.js";
import postboxExtension, { startRegistration } from "../src/index.js";

const tempDirs: string[] = [];
const shutdowns: Array<() => void> = [];
const NOW_MS = Date.parse("2026-06-23T12:00:00.000Z");
const TTL_MS = 60_000;
const DEV_INSTANCE_ID = "11111111-1111-4111-8111-111111111111";
const LOCAL_TARGET_URL = "http://127.0.0.1:3500/";

const askInput = {
  requestId: "ask-autostart",
  question: "Proceed with the local Postbox autostart?",
  context: {
    codebaseContext: "Pi extension with package-local Postbox Server autostart.",
    problemContext: "Recover a reachable dashboard before sending a remote decision."
  },
  options: [{ value: "yes", label: "Yes" }]
};

afterEach(async () => {
  for (const shutdown of shutdowns.splice(0)) shutdown();
  resetExtensionModuleState();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.mocked(spawn).mockClear();
  childProcessMock.children.length = 0;
  fsMock.packageLocalCliExists = true;
  postboxClientMock.options.length = 0;
  postboxClientMock.asks.length = 0;
  postboxClientMock.started = 0;
  postboxClientMock.stopped = 0;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("package-local Postbox server autostart", () => {
  it("ask_postbox with no reachable server spawns the package-local server, waits for healthy active-local metadata, registers, and sends the ask", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
    const env = await tempConfigEnv({ PI_POSTBOX_AUTOSTART_TIMEOUT_MS: "5000" });
    const health = healthFetch({
      "http://127.0.0.1:3500/healthz": healthResponse({ role: "dev", instanceId: DEV_INSTANCE_ID, url: LOCAL_TARGET_URL })
    });
    vi.stubGlobal("fetch", health.fetch);
    const harness = createPiHarness();
    postboxExtension(harness.pi);

    await withProcessEnv(env, async () => {
      harness.emit("session_start", {}, createSessionContext(harness.statuses));
      await vi.waitFor(() => expect(harness.statuses).toContain("Postbox unavailable"));
      expect(vi.mocked(spawn)).not.toHaveBeenCalled();

      const toolResult = harness.askTool.execute("call-autostart", askInput);
      await vi.waitFor(() => expect(vi.mocked(spawn)).toHaveBeenCalledTimes(1));
      expectPackageLocalSpawn();

      await writeMetadata(env, {
        role: "dev",
        instanceId: DEV_INSTANCE_ID,
        url: LOCAL_TARGET_URL,
        updatedAt: new Date(NOW_MS).toISOString()
      });
      await vi.advanceTimersByTimeAsync(100);
      await vi.waitFor(() => expect(postboxClientMock.started).toBe(1));

      await expect(toolResult).resolves.toMatchObject({
        details: { status: "answered", requestId: "ask-autostart", selectedValues: ["yes"] }
      });
      expect(postboxClientMock.options.at(-1)).toMatchObject({ serverUrl: LOCAL_TARGET_URL });
      expect(postboxClientMock.asks.at(-1)).toMatchObject({ requestId: "ask-autostart" });
    });
  });

  it("uses a healthy preferred server without spawning an autostart child", async () => {
    const env = await tempConfigEnv({ PI_POSTBOX_URL: "https://postbox.tailnet.example:32187/" });
    const health = healthFetch({
      "https://postbox.tailnet.example:32187/healthz": createHealthResponse({ startedAtMs: NOW_MS - 1_000, nowMs: NOW_MS })
    });

    await startRegistration(
      { getSessionName: () => "Preferred server", on: () => undefined },
      createSessionContext([]),
      env,
      undefined,
      "fallback-preferred",
      { resolveOptions: { fetch: health.fetch, nowMs: NOW_MS, ttlMs: TTL_MS } }
    );

    expect(postboxClientMock.options.at(-1)).toMatchObject({ serverUrl: "https://postbox.tailnet.example:32187/" });
    expect(postboxClientMock.started).toBe(1);
    expect(vi.mocked(spawn)).not.toHaveBeenCalled();
  });

  it("ask_postbox re-checks a recovered preferred server before autostarting", async () => {
    const preferredUrl = "https://postbox.tailnet.example:32187/";
    const env = await tempConfigEnv({ PI_POSTBOX_URL: preferredUrl });
    let preferredHealthy = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.redirect).toBe("manual");
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        expect(url).toBe(`${preferredUrl}healthz`);
        if (!preferredHealthy) throw new Error("preferred server is not reachable yet");
        return new Response(JSON.stringify(createHealthResponse({ startedAtMs: NOW_MS - 1_000, nowMs: NOW_MS })), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      })
    );
    const harness = createPiHarness();
    postboxExtension(harness.pi);

    await withProcessEnv(env, async () => {
      harness.emit("session_start", {}, createSessionContext(harness.statuses));
      await vi.waitFor(() => expect(harness.statuses).toContain("Postbox unavailable"));

      preferredHealthy = true;
      const result = await harness.askTool.execute("call-recovered-preferred", {
        ...askInput,
        requestId: "ask-recovered-preferred"
      });

      expect(vi.mocked(spawn)).not.toHaveBeenCalled();
      expect(result).toMatchObject({ details: { status: "answered", requestId: "ask-recovered-preferred" } });
      expect(postboxClientMock.options.at(-1)).toMatchObject({ serverUrl: preferredUrl });
      expect(postboxClientMock.asks.at(-1)).toMatchObject({ requestId: "ask-recovered-preferred" });
    });
  });

  it("ask_postbox re-checks newly available active-local metadata before autostarting", async () => {
    const env = await tempConfigEnv();
    const health = healthFetch({
      "http://127.0.0.1:3500/healthz": healthResponse({ role: "dev", instanceId: DEV_INSTANCE_ID, url: LOCAL_TARGET_URL })
    });
    vi.stubGlobal("fetch", health.fetch);
    const harness = createPiHarness();
    postboxExtension(harness.pi);

    await withProcessEnv(env, async () => {
      harness.emit("session_start", {}, createSessionContext(harness.statuses));
      await vi.waitFor(() => expect(harness.statuses).toContain("Postbox unavailable"));

      await writeMetadata(env, {
        role: "dev",
        instanceId: DEV_INSTANCE_ID,
        url: LOCAL_TARGET_URL,
        updatedAt: new Date().toISOString()
      });
      const result = await harness.askTool.execute("call-recovered-active-local", {
        ...askInput,
        requestId: "ask-recovered-active-local"
      });

      expect(vi.mocked(spawn)).not.toHaveBeenCalled();
      expect(result).toMatchObject({ details: { status: "answered", requestId: "ask-recovered-active-local" } });
      expect(postboxClientMock.options.at(-1)).toMatchObject({ serverUrl: LOCAL_TARGET_URL });
      expect(postboxClientMock.asks.at(-1)).toMatchObject({ requestId: "ask-recovered-active-local" });
    });
  });

  it("PI_POSTBOX_AUTOSTART=off disables spawn and ask_postbox returns explicit unavailable diagnostics", async () => {
    const env = await tempConfigEnv({ PI_POSTBOX_AUTOSTART: "off" });
    const harness = createPiHarness();
    postboxExtension(harness.pi);

    await withProcessEnv(env, async () => {
      harness.emit("session_start", {}, createSessionContext(harness.statuses));
      await vi.waitFor(() => expect(harness.statuses).toContain("Postbox unavailable"));

      const result = await harness.askTool.execute("call-off", { ...askInput, requestId: "ask-off" });

      expect(vi.mocked(spawn)).not.toHaveBeenCalled();
      expect(result).toMatchObject({ details: { status: "unavailable", requestId: "ask-off" } });
      expect(result.details.rationale).toMatch(/PI_POSTBOX_AUTOSTART=off|autostart disabled/i);
    });
  });

  it("PI_POSTBOX_AUTOSTART_TIMEOUT_MS bounds how long ask_postbox waits for autostart health", async () => {
    vi.useFakeTimers();
    const env = await tempConfigEnv({ PI_POSTBOX_AUTOSTART_TIMEOUT_MS: "50" });
    const harness = createPiHarness();
    postboxExtension(harness.pi);

    await withProcessEnv(env, async () => {
      harness.emit("session_start", {}, createSessionContext(harness.statuses));
      await vi.waitFor(() => expect(harness.statuses).toContain("Postbox unavailable"));

      const pending = harness.askTool.execute("call-timeout", { ...askInput, requestId: "ask-timeout" });
      let settled = false;
      pending.finally(() => {
        settled = true;
      });
      await vi.waitFor(() => expect(vi.mocked(spawn)).toHaveBeenCalledTimes(1), { interval: 1, timeout: 10 });
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(50);
      await expect(pending).resolves.toMatchObject({ details: { status: "unavailable", requestId: "ask-timeout" } });
      expect(vi.mocked(spawn)).toHaveBeenCalledTimes(1);
      expect((await pending).details.rationale).toMatch(/timed out|timeout|50ms/i);
    });
  });

  it("reuses an existing healthy active-local server without spawning another process", async () => {
    const env = await tempConfigEnv();
    await writeMetadata(env, {
      role: "dev",
      instanceId: DEV_INSTANCE_ID,
      url: LOCAL_TARGET_URL,
      updatedAt: new Date(NOW_MS).toISOString()
    });
    const health = healthFetch({
      "http://127.0.0.1:3500/healthz": healthResponse({ role: "dev", instanceId: DEV_INSTANCE_ID, url: LOCAL_TARGET_URL })
    });

    await startRegistration(
      { getSessionName: () => "Reuse active local", on: () => undefined },
      createSessionContext([]),
      env,
      undefined,
      "fallback-active-local",
      { resolveOptions: { fetch: health.fetch, nowMs: NOW_MS, ttlMs: TTL_MS } }
    );

    expect(postboxClientMock.options.at(-1)).toMatchObject({ serverUrl: LOCAL_TARGET_URL });
    expect(postboxClientMock.started).toBe(1);
    expect(vi.mocked(spawn)).not.toHaveBeenCalled();
  });

  it("session shutdown does not kill an ask-triggered autostart child process", async () => {
    vi.useFakeTimers();
    const env = await tempConfigEnv({ PI_POSTBOX_AUTOSTART_TIMEOUT_MS: "5000" });
    const harness = createPiHarness();
    postboxExtension(harness.pi);

    await withProcessEnv(env, async () => {
      harness.emit("session_start", {}, createSessionContext(harness.statuses));
      await vi.waitFor(() => expect(harness.statuses).toContain("Postbox unavailable"));
      expect(vi.mocked(spawn)).not.toHaveBeenCalled();

      const pending = harness.askTool.execute("call-shutdown", { ...askInput, requestId: "ask-shutdown" });
      pending.catch(() => undefined);
      await vi.waitFor(() => expect(vi.mocked(spawn)).toHaveBeenCalledTimes(1));

      const child = childProcessMock.children.at(-1);
      expect(child).toBeDefined();
      harness.emit("session_shutdown", {}, createSessionContext(harness.statuses));
      await vi.advanceTimersByTimeAsync(5_000);

      expect(child?.kill).not.toHaveBeenCalled();
      await expect(pending).resolves.toMatchObject({ details: { status: "unavailable", requestId: "ask-shutdown" } });
    });
  });

  it("PATH fallback spawn errors return unavailable diagnostics and do not poison autostart retry state", async () => {
    vi.useFakeTimers();
    fsMock.packageLocalCliExists = false;
    const env = await tempConfigEnv({ PI_POSTBOX_AUTOSTART_TIMEOUT_MS: "50" });
    const harness = createPiHarness();
    postboxExtension(harness.pi);

    await withProcessEnv(env, async () => {
      harness.emit("session_start", {}, createSessionContext(harness.statuses));
      await vi.waitFor(() => expect(harness.statuses).toContain("Postbox unavailable"));
      expect(vi.mocked(spawn)).not.toHaveBeenCalled();

      const first = harness.askTool.execute("call-path-failure-1", { ...askInput, requestId: "ask-path-failure-1" });
      await vi.waitFor(() => expect(vi.mocked(spawn)).toHaveBeenCalledTimes(1), { interval: 1, timeout: 10 });
      expectPathFallbackSpawn();
      childProcessMock.children.at(-1)?.emit("error", new Error("spawn pi-postbox-server ENOENT"));
      expect(getPostboxAutostartFailureDiagnostic(process.env)).toMatch(/pi-postbox-server|ENOENT|autostart failed/i);
      await vi.advanceTimersByTimeAsync(50);

      await expect(first).resolves.toMatchObject({ details: { status: "unavailable", requestId: "ask-path-failure-1" } });
      expect((await first).details.rationale).toMatch(/ENOENT|autostart failed/i);

      const second = harness.askTool.execute("call-path-failure-2", { ...askInput, requestId: "ask-path-failure-2" });
      await vi.waitFor(() => expect(vi.mocked(spawn)).toHaveBeenCalledTimes(2), { interval: 1, timeout: 10 });
      expectPathFallbackSpawn(1);
      childProcessMock.children.at(-1)?.emit("error", new Error("spawn pi-postbox-server ENOENT"));
      await vi.advanceTimersByTimeAsync(50);

      await expect(second).resolves.toMatchObject({ details: { status: "unavailable", requestId: "ask-path-failure-2" } });
    });
  });
});

async function tempConfigEnv(extra: NodeJS.ProcessEnv = {}): Promise<NodeJS.ProcessEnv> {
  const dir = await mkdtemp(join(tmpdir(), "pi-postbox-autostart-"));
  tempDirs.push(dir);
  return { ...extra, PI_POSTBOX_CONFIG_PATH: join(dir, "config.json") };
}

function createPiHarness() {
  const handlers = new Map<string, Array<(event: unknown, ctx: Record<string, unknown>) => unknown>>();
  const tools = new Map<string, any>();
  const statuses: string[] = [];
  const pi = {
    getSessionName: () => "Autostart test session",
    on(event: string, handler: (event: unknown, ctx: Record<string, unknown>) => unknown) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    registerTool(definition: { name: string }) {
      tools.set(definition.name, definition);
    },
    registerCommand: () => undefined
  };
  const harness = {
    pi,
    statuses,
    get askTool() {
      const tool = tools.get("ask_postbox");
      if (!tool) throw new Error("ask_postbox was not registered");
      return tool;
    },
    emit(event: string, data: unknown, ctx: Record<string, unknown>) {
      for (const handler of handlers.get(event) ?? []) handler(data, ctx);
    }
  };
  shutdowns.push(() => harness.emit("session_shutdown", {}, createSessionContext(statuses)));
  return harness;
}

function createSessionContext(statuses: string[]) {
  return {
    cwd: process.cwd(),
    ui: {
      setStatus: (_key: string, value: string) => statuses.push(value),
      notify: (message: string) => statuses.push(message),
      setWidget: () => undefined
    },
    sessionManager: { getSessionFile: () => "/tmp/session.jsonl", getLeafId: () => "leaf-1" }
  };
}

async function withProcessEnv<T>(env: NodeJS.ProcessEnv, fn: () => Promise<T>): Promise<T> {
  const keys = [
    "PI_POSTBOX_CONFIG_PATH",
    "PI_POSTBOX_CONFIG_DIR",
    "PI_POSTBOX_URL",
    "PI_POSTBOX_AUTOSTART",
    "PI_POSTBOX_AUTOSTART_TIMEOUT_MS"
  ];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, env);
  try {
    return await fn();
  } finally {
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
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

function expectPackageLocalSpawn(): void {
  const call = vi.mocked(spawn).mock.calls[0];
  expect(call?.[0]).toBe(process.execPath);
  expect(call?.[1]).toEqual(expect.arrayContaining([expect.stringMatching(/packages[/\\]server[/\\]dist[/\\]cli\.js$/), "serve", "--active-local-role", "production"]));
  expect(call?.[1]).not.toContain("--no-tailscale");
}

function expectPathFallbackSpawn(callIndex = 0): void {
  const call = vi.mocked(spawn).mock.calls[callIndex];
  expect(call?.[0]).toBe("pi-postbox-server");
  expect(call?.[1]).toEqual(expect.arrayContaining(["serve", "--active-local-role", "production"]));
  expect(call?.[1]).not.toContain("--no-tailscale");
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
  for (const handler of shutdownHandlers) handler({}, createSessionContext([]));
}
