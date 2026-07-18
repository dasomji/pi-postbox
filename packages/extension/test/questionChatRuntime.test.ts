import { SessionManager, type CreateAgentSessionOptions, type CreateAgentSessionResult } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { QuestionChatEvent } from "@pi-postbox/protocol";
import {
  PiQuestionChatRuntimeAdapter,
  QuestionChatRuntimeError,
  QuestionChatRuntimeRegistry
} from "../src/questionChatRuntime.js";

function createSourceFixture() {
  const root = mkdtempSync(join(tmpdir(), "postbox-chat-runtime-"));
  const cwd = join(root, "repo");
  const sourceDir = join(root, "source");
  const manager = SessionManager.create(cwd, sourceDir);
  manager.appendModelChange("test-provider", "source-model");
  const rootMessageId = manager.appendMessage({ role: "user", content: "root question", timestamp: Date.now() });
  manager.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "source answer" }],
    api: "anthropic-messages",
    provider: "test-provider",
    model: "source-model",
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop",
    timestamp: Date.now()
  });
  const selectedLeafId = manager.appendMessage({ role: "user", content: "selected branch", timestamp: Date.now() });
  manager.branch(rootMessageId);
  const siblingLeafId = manager.appendMessage({ role: "user", content: "unrelated sibling", timestamp: Date.now() });
  const sourcePath = manager.getSessionFile();
  if (!sourcePath) throw new Error("Expected persisted source fixture");
  return { root, cwd, sourcePath, selectedLeafId, siblingLeafId };
}

function fakeCreateSession(selectedModel = { provider: "test-provider", id: "source-model" }) {
  const lifecycle: string[] = [];
  const create = vi.fn(async (options: CreateAgentSessionOptions) => {
    const session = {
      model: selectedModel,
      abort: vi.fn(async () => {
        lifecycle.push("abort");
      }),
      dispose: vi.fn(() => {
        lifecycle.push("dispose");
      })
    };
    return { session, extensionsResult: { extensions: [], errors: [], runtime: undefined } } as unknown as CreateAgentSessionResult;
  });
  return { create, lifecycle };
}

describe("Pi Question Chat runtime adapter", () => {
  it("creates one private root-to-leaf fork without changing the source or spending model capacity", async () => {
    const fixture = createSourceFixture();
    const before = readFileSync(fixture.sourcePath);
    const beforeMtime = statSync(fixture.sourcePath).mtimeMs;
    const fake = fakeCreateSession();
    const privateRoot = join(fixture.root, "private-chats");
    const adapter = new PiQuestionChatRuntimeAdapter({
      privateRoot,
      agentDir: join(fixture.root, "agent"),
      createAgentSession: fake.create
    });
    const registry = new QuestionChatRuntimeRegistry(adapter);

    const source = { agentSessionPath: fixture.sourcePath, leafId: fixture.selectedLeafId, cwd: fixture.cwd };
    const [first, retry] = await Promise.all([
      registry.activate({ requestId: "ask/runtime-safe", source }),
      registry.activate({ requestId: "ask/runtime-safe", source })
    ]);

    expect(first).toEqual(retry);
    expect(first).toMatchObject({
      state: "ready",
      forkKind: "exact",
      messages: [],
      model: { id: "test-provider/source-model", source: "originating" }
    });
    expect(fake.create).toHaveBeenCalledTimes(1);
    const options = fake.create.mock.calls[0]![0];
    expect(options.tools).toEqual([]);
    expect(options.customTools).toBeUndefined();
    expect(options.resourceLoader?.getExtensions().extensions).toEqual([]);
    expect(options.resourceLoader?.getSkills().skills).toEqual([]);
    expect(options.resourceLoader?.getPrompts().prompts).toEqual([]);
    expect(options.resourceLoader?.getThemes().themes).toEqual([]);
    expect(options.resourceLoader?.getAgentsFiles().agentsFiles).toEqual([]);
    expect(options.resourceLoader?.getAppendSystemPrompt()).toEqual([]);

    const forkManager = options.sessionManager!;
    const forkText = readFileSync(forkManager.getSessionFile()!, "utf8");
    expect(forkText).toContain("selected branch");
    expect(forkText).not.toContain("unrelated sibling");
    expect(Buffer.compare(readFileSync(fixture.sourcePath), before)).toBe(0);
    expect(statSync(fixture.sourcePath).mtimeMs).toBe(beforeMtime);

    const forkDir = forkManager.getSessionDir();
    expect(relative(privateRoot, forkDir)).not.toMatch(/^\.\./);
    expect(statSync(forkDir).mode & 0o777).toBe(0o700);

    await registry.cleanup("ask/runtime-safe");
    expect(fake.lifecycle).toEqual(["abort", "dispose"]);
    expect(existsSync(forkDir)).toBe(false);
    await expect(registry.cleanup("ask/runtime-safe")).resolves.toBeUndefined();
  });

  it("surfaces a clear Pi-default model fallback", async () => {
    const fixture = createSourceFixture();
    const fake = fakeCreateSession({ provider: "fallback-provider", id: "default-model" });
    const adapter = new PiQuestionChatRuntimeAdapter({
      privateRoot: join(fixture.root, "private-chats"),
      agentDir: join(fixture.root, "agent"),
      createAgentSession: fake.create
    });

    const runtime = await adapter.create({
      requestId: "ask-fallback",
      source: { agentSessionPath: fixture.sourcePath, leafId: fixture.selectedLeafId, cwd: fixture.cwd }
    });
    expect(runtime.snapshot.model).toMatchObject({
      id: "fallback-provider/default-model",
      source: "pi-default",
      fallbackReason: expect.stringContaining("test-provider/source-model")
    });
    await runtime.terminate();
  });

  it("waits for abort before cleanupAll disposes and deletes the private fork", async () => {
    const fixture = createSourceFixture();
    let finishAbort!: () => void;
    let runtimeDir!: string;
    const lifecycle: string[] = [];
    const adapter = new PiQuestionChatRuntimeAdapter({
      privateRoot: join(fixture.root, "private-chats"),
      agentDir: join(fixture.root, "agent"),
      createAgentSession: vi.fn(async (options: CreateAgentSessionOptions) => {
        runtimeDir = options.sessionManager!.getSessionDir();
        return {
          session: {
            model: { provider: "test-provider", id: "source-model" },
            abort: vi.fn(
              () => new Promise<void>((resolve) => {
                lifecycle.push("abort-start");
                finishAbort = resolve;
              })
            ),
            dispose: vi.fn(() => lifecycle.push("dispose"))
          },
          extensionsResult: { extensions: [], errors: [], runtime: undefined }
        } as unknown as CreateAgentSessionResult;
      })
    });
    const registry = new QuestionChatRuntimeRegistry(adapter);
    await registry.activate({
      requestId: "ask-deferred-abort",
      source: { agentSessionPath: fixture.sourcePath, leafId: fixture.selectedLeafId, cwd: fixture.cwd }
    });
    const websocketCleanup = registry.cleanup("ask-deferred-abort");
    await Promise.resolve();
    expect(lifecycle).toEqual(["abort-start"]);
    expect(existsSync(runtimeDir)).toBe(true);

    let shutdownCleanupCompleted = false;
    const shutdownCleanup = registry.cleanupAll().then(() => {
      shutdownCleanupCompleted = true;
    });
    await Promise.resolve();
    expect(shutdownCleanupCompleted).toBe(false);

    finishAbort();
    await Promise.all([websocketCleanup, shutdownCleanup]);
    expect(lifecycle).toEqual(["abort-start", "dispose"]);
    expect(existsSync(runtimeDir)).toBe(false);
  });

  it("returns typed source errors before constructing an SDK session", async () => {
    const fixture = createSourceFixture();
    const fake = fakeCreateSession();
    const adapter = new PiQuestionChatRuntimeAdapter({
      privateRoot: join(fixture.root, "private-chats"),
      agentDir: join(fixture.root, "agent"),
      createAgentSession: fake.create
    });

    await expect(
      adapter.create({ requestId: "missing-path", source: { agentSessionPath: join(fixture.root, "missing"), leafId: "leaf", cwd: fixture.cwd } })
    ).rejects.toMatchObject({ code: "source_path_missing" } satisfies Partial<QuestionChatRuntimeError>);
    await expect(
      adapter.create({ requestId: "missing-leaf", source: { agentSessionPath: fixture.sourcePath, leafId: "missing", cwd: fixture.cwd } })
    ).rejects.toMatchObject({ code: "source_leaf_missing" } satisfies Partial<QuestionChatRuntimeError>);
    expect(fake.create).not.toHaveBeenCalled();
  });

  it("sends an ordinary SDK prompt and exposes only normalized visible stream events", async () => {
    const fixture = createSourceFixture();
    let listener: ((event: any) => void) | undefined;
    let forkManager: SessionManager | undefined;
    const prompt = vi.fn(async () => undefined);
    const adapter = new PiQuestionChatRuntimeAdapter({
      privateRoot: join(fixture.root, "private-chats"),
      agentDir: join(fixture.root, "agent"),
      createAgentSession: vi.fn(async (options: CreateAgentSessionOptions) => {
        forkManager = options.sessionManager;
        return ({
        session: {
          model: { provider: "test-provider", id: "source-model" },
          isStreaming: false,
          state: {},
          sessionManager: options.sessionManager,
          subscribe: vi.fn((next: (event: any) => void) => {
            listener = next;
            return vi.fn();
          }),
          prompt,
          abort: vi.fn(async () => undefined),
          dispose: vi.fn()
        },
        extensionsResult: { extensions: [], errors: [], runtime: undefined }
      }) as unknown as CreateAgentSessionResult;
      })
    });
    const registry = new QuestionChatRuntimeRegistry(adapter);
    const requestId = "ask-stream";
    await registry.activate({
      requestId,
      source: { agentSessionPath: fixture.sourcePath, leafId: fixture.selectedLeafId, cwd: fixture.cwd }
    });
    const events: QuestionChatEvent[] = [];
    registry.subscribe(requestId, (event) => events.push(event));

    await expect(registry.send(requestId, { clientCommandId: "browser-command-1", message: "Please explain." })).resolves.toEqual({
      status: "accepted",
      clientCommandId: "browser-command-1"
    });
    expect(prompt).toHaveBeenCalledWith("Please explain.", { expandPromptTemplates: false, source: "rpc" });
    await expect(registry.send(requestId, { clientCommandId: "browser-command-2", message: "Too soon" })).rejects.toMatchObject({
      code: "runtime_busy"
    });

    listener?.({ type: "agent_start" });
    listener?.({ type: "message_start", message: { role: "assistant", content: [], timestamp: 10 } });
    listener?.({
      type: "message_update",
      message: { role: "assistant", content: [{ type: "thinking", thinking: "secret" }], timestamp: 10 },
      assistantMessageEvent: { type: "thinking_delta", delta: "private chain of thought" }
    });
    listener?.({
      type: "message_update",
      message: { role: "assistant", content: [{ type: "text", text: "Visible **answer**" }], timestamp: 10 },
      assistantMessageEvent: { type: "text_delta", delta: "Visible **answer**" }
    });
    listener?.({
      type: "message_update",
      message: { role: "assistant", content: [{ type: "text", text: "x".repeat(33_000) }], timestamp: 10 },
      assistantMessageEvent: { type: "text_delta", delta: "x".repeat(33_000) }
    });
    listener?.({
      type: "message_update",
      message: { role: "assistant", content: [{ type: "text", text: "must-not-escape" }], timestamp: 10 },
      assistantMessageEvent: { type: "text_delta", delta: "must-not-escape" }
    });
    forkManager!.appendMessage({ role: "user", content: "Please explain.", timestamp: 9 });
    listener?.({
      type: "message_end",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "secret" },
          { type: "text", text: "Visible **answer**" },
          { type: "toolCall", id: "tool-1", name: "read", arguments: { path: ".env" } }
        ],
        timestamp: 10
      }
    });
    listener?.({ type: "queue_update", steering: [], followUp: [] });
    expect((await registry.getSnapshot(requestId)).messages.at(-1)).toMatchObject({ role: "assistant", text: "Visible **answer**", status: "final" });
    forkManager!.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "Visible **answer**" }],
      api: "anthropic-messages",
      provider: "test-provider",
      model: "source-model",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop",
      timestamp: 10
    });
    listener?.({ type: "agent_settled" });

    expect(events.slice(0, 3).map((event) => event.type)).toEqual(["message.started", "lifecycle", "message.started"]);
    expect(events.slice(-2).map((event) => event.type)).toEqual(["message.finished", "lifecycle"]);
    expect(events.filter((event) => event.type === "assistant.text.delta").map((event) => event.text).join("")).toHaveLength(32_000);
    expect(JSON.stringify(events)).toContain("Visible **answer**");
    expect(JSON.stringify(events)).not.toContain("secret");
    expect(JSON.stringify(events)).not.toContain(".env");
    expect(JSON.stringify(events)).not.toContain("must-not-escape");
    const snapshot = await registry.getSnapshot(requestId);
    expect(snapshot).toMatchObject({ state: "ready", sequence: events.at(-1)?.sequence });
    expect(snapshot.messages.map((message) => message.text)).toEqual(["Please explain.", "Visible **answer**"]);
    expect(JSON.stringify(snapshot.messages)).not.toContain("selected branch");

    await registry.send(requestId, { clientCommandId: "browser-command-3", message: "Please explain." });
    expect((await registry.getSnapshot(requestId)).messages.filter((message) => message.role === "user" && message.text === "Please explain.")).toHaveLength(2);
  });

  it("deduplicates an in-flight client command without prompting twice", async () => {
    let finishSend!: () => void;
    const runtime = {
      snapshot: { requestId: "ask-dedupe", state: "ready", forkKind: "exact", model: { id: "test/model", source: "originating" }, sequence: 0, messages: [] },
      send: vi.fn((command: { clientCommandId: string }) => new Promise<{ status: "accepted"; clientCommandId: string }>((resolve) => {
        finishSend = () => resolve({ status: "accepted", clientCommandId: command.clientCommandId });
      })),
      subscribe: vi.fn(() => () => undefined),
      terminate: vi.fn(async () => undefined)
    };
    const registry = new QuestionChatRuntimeRegistry({ create: vi.fn(async () => runtime) } as any);
    await registry.activate({ requestId: "ask-dedupe", source: { agentSessionPath: "/unused", leafId: "leaf", cwd: "/repo" } });
    const first = registry.send("ask-dedupe", { clientCommandId: "same", message: "hello" });
    const retry = registry.send("ask-dedupe", { clientCommandId: "same", message: "hello" });
    await Promise.resolve();
    expect(runtime.send).toHaveBeenCalledOnce();
    finishSend();
    await expect(Promise.all([first, retry])).resolves.toEqual([
      { status: "accepted", clientCommandId: "same" },
      { status: "accepted", clientCommandId: "same" }
    ]);
  });
});
