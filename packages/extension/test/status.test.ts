import { createHealthResponse } from "@pi-postbox/protocol";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const childProcessMock = vi.hoisted(() => ({
  spawnCalls: [] as unknown[]
}));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  const { EventEmitter } = await import("node:events");
  return {
    ...actual,
    spawn: vi.fn((...args: unknown[]) => {
      childProcessMock.spawnCalls.push(args);
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
      return child;
    })
  };
});

const postboxClientMock = vi.hoisted(() => ({
  options: [] as Array<{ serverUrl: string; onStatus?: (status: string) => void }>,
  pendingAsks: [] as Array<{
    requestId: string;
    prompt: string;
    mode: "single" | "multi";
    options: Array<{ value: string; label: string }>;
    sentAtLeastOnce: boolean;
    expiresAt?: string;
    note?: string;
    history?: string[];
  }>,
  statusSnapshot: undefined as unknown
}));

vi.mock("../src/client/PostboxClient.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/client/PostboxClient.js")>();
  return {
    ...actual,
    PostboxClient: class {
      constructor(private readonly options: { serverUrl: string; onStatus?: (status: string) => void }) {
        postboxClientMock.options.push(options);
      }

      start() {
        this.options.onStatus?.("connected");
      }

      stop() {
        return undefined;
      }

      updateSemanticState() {
        return true;
      }

      shutdownSession() {
        return true;
      }

      listPendingAsks() {
        return postboxClientMock.pendingAsks;
      }

      getStatusSnapshot() {
        return postboxClientMock.statusSnapshot;
      }
    }
  };
});

import postboxExtension from "../src/index.js";

const tempDirs: string[] = [];
const harnesses: ReturnType<typeof createPiHarness>[] = [];
const LOCAL_URL = "http://127.0.0.1:3500/";
const TAILNET_URL = "https://postbox.tailnet.example/";
const REMOTE_EXPORT = `export PI_POSTBOX_URL=${TAILNET_URL}`;
const NOW_MS = Date.parse("2026-06-23T12:00:00.000Z");

const secretAsk = {
  requestId: "ask-secret",
  prompt: "SECRET_PROMPT deploy customer database?",
  mode: "single" as const,
  options: [
    { value: "SECRET_OPTION_SHIP", label: "Ship the secret option" },
    { value: "SECRET_OPTION_ABORT", label: "Abort with secret rollback" }
  ],
  sentAtLeastOnce: true,
  note: "SECRET_NOTE from answer history",
  history: ["SECRET_HISTORY previous answer"]
};

const secretTokens = [
  "SECRET_PROMPT",
  "SECRET_OPTION_SHIP",
  "SECRET_OPTION_ABORT",
  "Ship the secret option",
  "Abort with secret rollback",
  "SECRET_NOTE",
  "SECRET_HISTORY",
  "deploy customer database"
];

function connectedStatus(overrides: Record<string, unknown> = {}) {
  return {
    connection: {
      state: "connected",
      activeUrl: LOCAL_URL,
      localUrl: LOCAL_URL,
      tailnetUrl: TAILNET_URL
    },
    remoteConfig: REMOTE_EXPORT,
    openQuestionCount: postboxClientMock.pendingAsks.length,
    autostart: {
      enabled: true,
      startedByThisSession: true
    },
    diagnostics: [],
    ...overrides
  };
}

afterEach(async () => {
  for (const harness of harnesses.splice(0)) harness.emit("session_shutdown", {}, createSessionContext());
  resetExtensionModuleState();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.mocked(spawn).mockClear();
  childProcessMock.spawnCalls.length = 0;
  postboxClientMock.options.length = 0;
  postboxClientMock.pendingAsks.length = 0;
  postboxClientMock.statusSnapshot = undefined;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Postbox status surfaces", () => {
  it("/postbox-status reports operator connectivity and counts without leaking pending ask content", async () => {
    postboxClientMock.pendingAsks.push(secretAsk);
    postboxClientMock.statusSnapshot = connectedStatus();
    const env = await tempConfigEnv({ PI_POSTBOX_URL: LOCAL_URL });
    const harness = await startConnectedHarness(env);

    const message = await harness.runCommand("postbox-status");

    expect(message).toMatch(/connected/i);
    expect(message).toContain(LOCAL_URL);
    expect(message).toContain(TAILNET_URL);
    expect(message).toContain(REMOTE_EXPORT);
    expect(message).toMatch(/open (questions|asks):\s*1/i);
    expect(message).toMatch(/autostart:\s*enabled/i);
    expect(message).toMatch(/started by this session/i);
    expectNoSecretContent(message);
  });

  it("postbox_status is registered as a read-only structured tool with the same private status fields", async () => {
    postboxClientMock.pendingAsks.push(secretAsk);
    postboxClientMock.statusSnapshot = connectedStatus();
    const env = await tempConfigEnv({ PI_POSTBOX_URL: LOCAL_URL });
    const harness = await startConnectedHarness(env);

    const tool = harness.tools.get("postbox_status");
    expect(tool).toBeDefined();
    expect(tool?.annotations?.readOnlyHint).toBe(true);

    const result = await tool.execute("call-status", {});

    expect(result).toMatchObject({
      details: {
        connection: {
          state: "connected",
          activeUrl: LOCAL_URL,
          localUrl: LOCAL_URL,
          tailnetUrl: TAILNET_URL
        },
        remoteConfig: REMOTE_EXPORT,
        openQuestionCount: 1,
        autostart: {
          enabled: true,
          startedByThisSession: true
        },
        diagnostics: []
      }
    });
    expectNoSecretContent(JSON.stringify(result));
  });

  it("/postbox-status reports disconnected diagnostics without autostarting a server", async () => {
    const env = await tempConfigEnv({ PI_POSTBOX_URL: "https://postbox.example.invalid/" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network unreachable");
      })
    );
    const harness = createPiHarness();
    postboxExtension(harness.pi);
    await withProcessEnv(env, async () => {
      harness.emit("session_start", {}, createSessionContext());
      await vi.waitFor(() => expect(harness.statuses).toContain("Postbox unavailable"));

      const message = await harness.runCommand("postbox-status");

      expect(message).toMatch(/(disconnected|unavailable)/i);
      expect(message).toMatch(/diagnostics?:/i);
      expect(message).toMatch(/explicit-remote|health-unreachable|network unreachable/i);
      expect(vi.mocked(spawn)).not.toHaveBeenCalled();
    });
  });

  it("/postbox-status remains useful when Tailnet is unavailable by showing local URL and diagnostics", async () => {
    postboxClientMock.statusSnapshot = connectedStatus({
      connection: {
        state: "connected",
        activeUrl: LOCAL_URL,
        localUrl: LOCAL_URL,
        tailnetUrl: undefined
      },
      remoteConfig: undefined,
      openQuestionCount: 0,
      diagnostics: ["tailscale: unavailable - Tailscale Serve is not configured"],
      tailscale: {
        state: "unavailable",
        diagnostic: "Tailscale Serve is not configured"
      }
    });
    const env = await tempConfigEnv({ PI_POSTBOX_URL: LOCAL_URL });
    const harness = await startConnectedHarness(env);

    const message = await harness.runCommand("postbox-status");

    expect(message).toMatch(/connected/i);
    expect(message).toContain(LOCAL_URL);
    expect(message).toMatch(/open (questions|asks):\s*0/i);
    expect(message).toMatch(/tail(net|scale).*unavailable|Tailscale Serve is not configured/i);
    expect(message).not.toContain("export PI_POSTBOX_URL=undefined");
    expect(message).not.toMatch(/^No pending Postbox asks\.?$/);
  });
});

async function startConnectedHarness(env: NodeJS.ProcessEnv): Promise<ReturnType<typeof createPiHarness>> {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      expect(url).toBe(new URL("healthz", LOCAL_URL).toString());
      return new Response(
        JSON.stringify(
          createHealthResponse({
            startedAtMs: NOW_MS - 1_000,
            nowMs: NOW_MS,
            localTarget: {
              role: "dev",
              instanceId: "11111111-1111-4111-8111-111111111111",
              url: LOCAL_URL
            }
          })
        ),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    })
  );
  const harness = createPiHarness();
  postboxExtension(harness.pi);
  await withProcessEnv(env, async () => {
    harness.emit("session_start", {}, createSessionContext());
    await vi.waitFor(() => expect(postboxClientMock.options.at(-1)).toMatchObject({ serverUrl: LOCAL_URL }));
  });
  return harness;
}

function createPiHarness() {
  const handlers = new Map<string, Array<(event: unknown, ctx: Record<string, unknown>) => unknown>>();
  const commands = new Map<string, { description?: string; handler: (args: string, ctx: ReturnType<typeof createCommandContext>) => unknown }>();
  const tools = new Map<string, any>();
  const statuses: string[] = [];
  const notifications: Array<{ message: string; level?: string }> = [];
  const pi = {
    getSessionName: () => "Status test session",
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
      const before = notifications.length;
      await command.handler(args, createCommandContext(notifications));
      return notifications
        .slice(before)
        .map((notification) => notification.message)
        .join("\n");
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
  const dir = await mkdtemp(join(tmpdir(), "pi-postbox-status-"));
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

function expectNoSecretContent(output: string): void {
  for (const token of secretTokens) {
    expect(output).not.toContain(token);
  }
  expect(output).not.toMatch(/postbox-answer\s+ask-secret\s+SECRET_OPTION_/i);
}
