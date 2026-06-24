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
  openFailureUrl: undefined as string | undefined,
  openExitFailureUrl: undefined as string | undefined,
  openHangUrl: undefined as string | undefined,
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
    spawn: vi.fn((command: string, args: string[] = []) => {
      const child = new EventEmitter() as unknown as {
        pid: number;
        kill: ReturnType<typeof vi.fn>;
        unref: ReturnType<typeof vi.fn>;
        stdout: InstanceType<typeof EventEmitter>;
        stderr: InstanceType<typeof EventEmitter>;
        exitCode: number | null;
        signalCode: NodeJS.Signals | null;
        emit: (event: string, ...args: unknown[]) => boolean;
      };
      child.pid = 4242;
      child.kill = vi.fn();
      child.unref = vi.fn();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.exitCode = null;
      child.signalCode = null;
      childProcessMock.children.push(child);

      const commandParts = [String(command), ...(Array.isArray(args) ? args.map(String) : [])];
      const flattened = commandParts.join(" ");
      const opensUrl = commandParts.some((part) => /^https?:\/\//.test(part));
      if (childProcessMock.openFailureUrl && flattened.includes(childProcessMock.openFailureUrl)) {
        queueMicrotask(() => child.emit("error", new Error("mock browser opener failed")));
      } else if (childProcessMock.openExitFailureUrl && flattened.includes(childProcessMock.openExitFailureUrl)) {
        queueMicrotask(() => {
          child.exitCode = 1;
          child.emit("exit", 1, null);
          child.emit("close", 1, null);
        });
      } else if (childProcessMock.openHangUrl && flattened.includes(childProcessMock.openHangUrl)) {
        // Leave the mocked opener running until the command-level timeout handles it.
      } else if (opensUrl) {
        queueMicrotask(() => {
          child.exitCode = 0;
          child.emit("exit", 0, null);
          child.emit("close", 0, null);
        });
      }

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
  options: [] as Array<{ serverUrl: string; onStatus?: (status: string) => void }>,
  instances: [] as Array<{
    options: { serverUrl: string; onStatus?: (status: string) => void };
    connectionState: "connected" | "disconnected";
    pendingAsks: Array<{ requestId: string; prompt: string; mode: "single" | "multi"; options: Array<{ value: string; label: string }>; sentAtLeastOnce: boolean }>;
    stopped: boolean;
  }>,
  started: 0,
  stopped: 0
}));

vi.mock("../src/client/PostboxClient.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/client/PostboxClient.js")>();
  return {
    ...actual,
    PostboxClient: class {
      private readonly instance: (typeof postboxClientMock.instances)[number];

      constructor(private readonly options: { serverUrl: string; onStatus?: (status: string) => void }) {
        postboxClientMock.options.push(options);
        this.instance = { options, connectionState: "disconnected", pendingAsks: [], stopped: false };
        postboxClientMock.instances.push(this.instance);
      }

      start() {
        postboxClientMock.started += 1;
        this.instance.connectionState = "connected";
        this.options.onStatus?.("connected");
      }

      stop() {
        postboxClientMock.stopped += 1;
        this.instance.stopped = true;
        this.instance.connectionState = "disconnected";
        this.instance.pendingAsks = [];
      }

      updateSemanticState() {
        return true;
      }

      shutdownSession() {
        return true;
      }

      listPendingAsks() {
        return this.instance.pendingAsks;
      }

      getStatusSnapshot() {
        return {
          connection: {
            state: this.instance.connectionState,
            activeUrl: this.options.serverUrl,
            localUrl: this.options.serverUrl
          },
          openQuestionCount: this.instance.pendingAsks.length,
          autostart: { enabled: true, startedByThisSession: false },
          diagnostics: this.instance.connectionState === "connected" ? [] : ["websocket:disconnected"]
        };
      }
    }
  };
});

import postboxExtension from "../src/index.js";

const tempDirs: string[] = [];
const harnesses: ReturnType<typeof createPiHarness>[] = [];
const NOW_MS = Date.parse("2026-06-23T12:00:00.000Z");
const DEV_INSTANCE_ID = "11111111-1111-4111-8111-111111111111";
const LOCAL_DASHBOARD_URL = "http://127.0.0.1:3500/";
const MALICIOUS_ARG_URL = "https://attacker.example/override";

afterEach(async () => {
  for (const harness of harnesses.splice(0)) harness.emit("session_shutdown", {}, createSessionContext());
  resetExtensionModuleState();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.mocked(spawn).mockClear();
  childProcessMock.openFailureUrl = undefined;
  childProcessMock.openExitFailureUrl = undefined;
  childProcessMock.openHangUrl = undefined;
  childProcessMock.children.length = 0;
  fsMock.packageLocalCliExists = true;
  postboxClientMock.options.length = 0;
  postboxClientMock.instances.length = 0;
  postboxClientMock.started = 0;
  postboxClientMock.stopped = 0;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("/postbox browser command", () => {
  it("opens the active dashboard URL when Postbox is already connected", async () => {
    const env = await tempConfigEnv({ PI_POSTBOX_URL: LOCAL_DASHBOARD_URL });
    const harness = createPiHarness();
    postboxExtension(harness.pi);

    await withProcessEnv(env, async () => {
      await startConnectedSession(harness, env);
      expect(postboxClientMock.started).toBe(1);
      expect(harness.commands.has("postbox")).toBe(true);

      await harness.runCommand("postbox");

      expect(spawnCallsContaining(LOCAL_DASHBOARD_URL)).toHaveLength(1);
      expect(harness.notifications.map((notification) => notification.message).join("\n")).not.toMatch(/manual|failed/i);
    });
  });

  it("uses the same mutating recovery/autostart path as ask_postbox when disconnected, then opens the recovered dashboard URL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
    const env = await tempConfigEnv({ PI_POSTBOX_AUTOSTART_TIMEOUT_MS: "5000" });
    const health = healthFetch({
      "http://127.0.0.1:3500/healthz": healthResponse({ role: "dev", instanceId: DEV_INSTANCE_ID, url: LOCAL_DASHBOARD_URL })
    });
    vi.stubGlobal("fetch", health.fetch);
    const harness = createPiHarness();
    postboxExtension(harness.pi);

    await withProcessEnv(env, async () => {
      harness.emit("session_start", {}, createSessionContext());
      await vi.waitFor(() => expect(harness.statuses).toContain("Postbox unavailable"));
      expect(vi.mocked(spawn)).not.toHaveBeenCalled();
      expect(harness.commands.has("postbox")).toBe(true);

      const opened = harness.runCommand("postbox");
      await vi.waitFor(() => expect(vi.mocked(spawn)).toHaveBeenCalledTimes(1));
      expectPackageLocalAutostartSpawn();

      await writeMetadata(env, {
        role: "dev",
        instanceId: DEV_INSTANCE_ID,
        url: LOCAL_DASHBOARD_URL,
        updatedAt: new Date(NOW_MS).toISOString()
      });
      await vi.advanceTimersByTimeAsync(1_000);
      await vi.waitFor(() => expect(postboxClientMock.started).toBe(1));

      await opened;
      expect(spawnCallsContaining(LOCAL_DASHBOARD_URL)).toHaveLength(1);
      expect(postboxClientMock.options.at(-1)).toMatchObject({ serverUrl: LOCAL_DASHBOARD_URL });
    });
  });

  it("notifies the user with the manual dashboard URL when the OS opener fails", async () => {
    const env = await tempConfigEnv({ PI_POSTBOX_URL: LOCAL_DASHBOARD_URL });
    childProcessMock.openFailureUrl = LOCAL_DASHBOARD_URL;
    const harness = createPiHarness();
    postboxExtension(harness.pi);

    await withProcessEnv(env, async () => {
      await startConnectedSession(harness, env);
      expect(harness.commands.has("postbox")).toBe(true);

      await harness.runCommand("postbox");

      expect(spawnCallsContaining(LOCAL_DASHBOARD_URL)).toHaveLength(1);
      expect(harness.notifications).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: expect.stringMatching(new RegExp(`open.*${escapeRegExp(LOCAL_DASHBOARD_URL)}|${escapeRegExp(LOCAL_DASHBOARD_URL)}.*manual`, "i")),
            level: expect.stringMatching(/warn|error/i)
          })
        ])
      );
    });
  });

  it("notifies the user with the manual dashboard URL when the OS opener exits non-zero", async () => {
    const env = await tempConfigEnv({ PI_POSTBOX_URL: LOCAL_DASHBOARD_URL });
    childProcessMock.openExitFailureUrl = LOCAL_DASHBOARD_URL;
    const harness = createPiHarness();
    postboxExtension(harness.pi);

    await withProcessEnv(env, async () => {
      await startConnectedSession(harness, env);
      expect(harness.commands.has("postbox")).toBe(true);

      await harness.runCommand("postbox");

      expect(spawnCallsContaining(LOCAL_DASHBOARD_URL)).toHaveLength(1);
      expect(harness.notifications).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: expect.stringMatching(new RegExp(`open.*${escapeRegExp(LOCAL_DASHBOARD_URL)}|${escapeRegExp(LOCAL_DASHBOARD_URL)}.*manual`, "i")),
            level: expect.stringMatching(/warn|error/i)
          })
        ])
      );
    });
  });

  it("notifies the user with the manual dashboard URL when the OS opener hangs", async () => {
    vi.useFakeTimers();
    const env = await tempConfigEnv({ PI_POSTBOX_URL: LOCAL_DASHBOARD_URL });
    childProcessMock.openHangUrl = LOCAL_DASHBOARD_URL;
    const harness = createPiHarness();
    postboxExtension(harness.pi);

    await withProcessEnv(env, async () => {
      await startConnectedSession(harness, env);
      expect(harness.commands.has("postbox")).toBe(true);

      const opened = harness.runCommand("postbox");
      await vi.waitFor(() => expect(spawnCallsContaining(LOCAL_DASHBOARD_URL)).toHaveLength(1));
      await vi.advanceTimersByTimeAsync(2_000);
      await opened;

      expect(childProcessMock.children.at(-1)?.kill).toHaveBeenCalled();
      expect(harness.notifications).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: expect.stringMatching(new RegExp(`open.*${escapeRegExp(LOCAL_DASHBOARD_URL)}|${escapeRegExp(LOCAL_DASHBOARD_URL)}.*manual`, "i")),
            level: expect.stringMatching(/warn|error/i)
          })
        ])
      );
    });
  });

  it("does not stop a disconnected client with pending asks before opening the dashboard", async () => {
    const env = await tempConfigEnv({ PI_POSTBOX_URL: LOCAL_DASHBOARD_URL });
    const harness = createPiHarness();
    postboxExtension(harness.pi);

    await withProcessEnv(env, async () => {
      await startConnectedSession(harness, env);
      const instance = postboxClientMock.instances.at(-1);
      expect(instance).toBeDefined();
      instance!.connectionState = "disconnected";
      instance!.pendingAsks.push({
        requestId: "ask-pending",
        prompt: "Preserve this pending ask",
        mode: "single",
        options: [{ value: "ok", label: "OK" }],
        sentAtLeastOnce: true
      });

      await harness.runCommand("postbox");

      expect(postboxClientMock.stopped).toBe(0);
      expect(instance!.stopped).toBe(false);
      expect(instance!.pendingAsks).toHaveLength(1);
      expect(spawnCallsContaining(LOCAL_DASHBOARD_URL)).toHaveLength(1);
    });
  });

  it("reports recovery timeout diagnostics and does not try to open an undefined dashboard URL", async () => {
    vi.useFakeTimers();
    const env = await tempConfigEnv({ PI_POSTBOX_AUTOSTART_TIMEOUT_MS: "50" });
    const harness = createPiHarness();
    postboxExtension(harness.pi);

    await withProcessEnv(env, async () => {
      harness.emit("session_start", {}, createSessionContext());
      await vi.waitFor(() => expect(harness.statuses).toContain("Postbox unavailable"));
      expect(harness.commands.has("postbox")).toBe(true);

      const opened = harness.runCommand("postbox");
      await vi.waitFor(() => expect(vi.mocked(spawn)).toHaveBeenCalledTimes(1), { interval: 1, timeout: 10 });
      expectPackageLocalAutostartSpawn();

      await vi.advanceTimersByTimeAsync(50);
      await opened;

      expect(vi.mocked(spawn)).toHaveBeenCalledTimes(1);
      expect(serializedSpawnCalls()).not.toMatch(/undefined|null/);
      expect(harness.notifications).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ message: expect.stringMatching(/timed out|timeout|diagnostic|unavailable/i), level: expect.stringMatching(/warn|error/i) })
        ])
      );
    });
  });

  it("registers /postbox as a user command only, without browser-opening LLM tools or optional URL arguments", async () => {
    const env = await tempConfigEnv({ PI_POSTBOX_URL: LOCAL_DASHBOARD_URL });
    const harness = createPiHarness();
    postboxExtension(harness.pi);

    await withProcessEnv(env, async () => {
      await startConnectedSession(harness, env);

      expect(harness.commands.has("postbox")).toBe(true);
      expect([...harness.tools.keys()]).toEqual(expect.arrayContaining(["ask_postbox", "postbox_status"]));
      expect([...harness.tools.keys()]).not.toEqual(expect.arrayContaining(["open_postbox"]));
      expect([...harness.tools.keys()].some((name) => /open.*postbox|postbox.*open|browser|dashboard/i.test(name))).toBe(false);

      await harness.runCommand("postbox", MALICIOUS_ARG_URL);

      expect(spawnCallsContaining(LOCAL_DASHBOARD_URL)).toHaveLength(1);
      expect(spawnCallsContaining(MALICIOUS_ARG_URL)).toHaveLength(0);
    });
  });
});

async function startConnectedSession(harness: ReturnType<typeof createPiHarness>, env: NodeJS.ProcessEnv): Promise<void> {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.redirect).toBe("manual");
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      expect(url).toBe(new URL("healthz", LOCAL_DASHBOARD_URL).toString());
      return new Response(JSON.stringify(createHealthResponse({ startedAtMs: NOW_MS - 1_000, nowMs: NOW_MS })), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    })
  );
  harness.emit("session_start", {}, createSessionContext());
  await vi.waitFor(() => expect(postboxClientMock.options.at(-1)).toMatchObject({ serverUrl: env.PI_POSTBOX_URL }));
}

function createPiHarness() {
  const handlers = new Map<string, Array<(event: unknown, ctx: Record<string, unknown>) => unknown>>();
  const commands = new Map<string, { description?: string; handler: (args: string, ctx: ReturnType<typeof createCommandContext>) => unknown }>();
  const tools = new Map<string, any>();
  const statuses: string[] = [];
  const notifications: Array<{ message: string; level?: string }> = [];
  const pi = {
    getSessionName: () => "Open Postbox test session",
    on(event: string, handler: (event: unknown, ctx: Record<string, unknown>) => unknown) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    registerTool(definition: { name: string }) {
      tools.set(definition.name, definition);
    },
    registerCommand(name: string, command: { description?: string; handler: (args: string, ctx: ReturnType<typeof createCommandContext>) => unknown }) {
      commands.set(name, command);
    }
  };
  const harness = {
    pi,
    commands,
    tools,
    statuses,
    notifications,
    emit(event: string, data: unknown, ctx: Record<string, unknown>) {
      for (const handler of handlers.get(event) ?? []) handler(data, ctx);
    },
    async runCommand(name: string, args = "") {
      const command = commands.get(name);
      if (!command) throw new Error(`${name} command was not registered`);
      await command.handler(args, createCommandContext(notifications));
    }
  };
  harnesses.push(harness);
  return harness;
}

function createSessionContext() {
  return {
    cwd: process.cwd(),
    ui: {
      setStatus: (_key: string, value: string) => harnesses.at(-1)?.statuses.push(value),
      notify: (message: string) => harnesses.at(-1)?.statuses.push(message),
      setWidget: () => undefined
    },
    sessionManager: { getSessionFile: () => "/tmp/session.jsonl", getLeafId: () => "leaf-1" }
  };
}

function createCommandContext(notifications: Array<{ message: string; level?: string }>) {
  return {
    ui: {
      notify: (message: string, level?: string) => notifications.push({ message, level })
    }
  };
}

async function tempConfigEnv(extra: NodeJS.ProcessEnv = {}): Promise<NodeJS.ProcessEnv> {
  const dir = await mkdtemp(join(tmpdir(), "pi-postbox-open-"));
  tempDirs.push(dir);
  return { ...extra, PI_POSTBOX_CONFIG_PATH: join(dir, "config.json") };
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

async function writeMetadata(env: NodeJS.ProcessEnv, record: { role: ActiveLocalRole; instanceId: string; url: string; updatedAt: string }): Promise<void> {
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
    if (!(url in responses)) throw new Error(`Unexpected health probe ${url}`);
    const response = responses[url];
    if (response instanceof Error) throw response;
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  });
  return { fetch };
}

function spawnCallsContaining(value: string): unknown[][] {
  return vi
    .mocked(spawn)
    .mock.calls.filter((call) => [String(call[0]), ...(Array.isArray(call[1]) ? call[1].map(String) : [])].some((part) => part.includes(value)));
}

function serializedSpawnCalls(): string {
  return JSON.stringify(
    vi.mocked(spawn).mock.calls.map((call) => [call[0], call[1]]),
    null,
    2
  );
}

function expectPackageLocalAutostartSpawn(): void {
  const call = vi.mocked(spawn).mock.calls[0];
  expect(call?.[0]).toBe(process.execPath);
  expect(call?.[1]).toEqual(expect.arrayContaining([expect.stringMatching(/packages[/\\]server[/\\]dist[/\\]cli\.js$/)]));
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
  for (const handler of shutdownHandlers) handler({}, createSessionContext());
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
