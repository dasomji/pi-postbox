import { SessionManager, type CreateAgentSessionOptions, type CreateAgentSessionResult } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it, vi } from "vitest";
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
});
