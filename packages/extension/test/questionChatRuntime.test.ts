import { SessionManager, type CreateAgentSessionOptions, type CreateAgentSessionResult } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { QuestionChatEvent } from "@pi-postbox/protocol";
import {
  PiQuestionChatRuntimeAdapter,
  QuestionChatRuntimeError,
  QuestionChatRuntimeRegistry
} from "../src/questionChatRuntime.js";
import { REPOSITORY_EVIDENCE_TOOL_NAMES } from "../src/repositoryEvidenceTools.js";
import { PROPOSE_ANSWER_TOOL_NAME } from "../src/proposeAnswerTool.js";

function createSourceFixture() {
  const root = mkdtempSync(join(tmpdir(), "postbox-chat-runtime-"));
  const cwd = join(root, "repo");
  mkdirSync(cwd, { recursive: true });
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

function expectReadOnlyEvidenceTools(options: CreateAgentSessionOptions): void {
  expect(REPOSITORY_EVIDENCE_TOOL_NAMES).toEqual([
    "repository_read",
    "repository_grep",
    "repository_find",
    "repository_list"
  ]);
  expect(options.tools).toEqual([...REPOSITORY_EVIDENCE_TOOL_NAMES, PROPOSE_ANSWER_TOOL_NAME]);
  expect(options.customTools?.map((tool) => tool.name)).toEqual([...REPOSITORY_EVIDENCE_TOOL_NAMES, PROPOSE_ANSWER_TOOL_NAME]);
  expect(options.excludeTools).toEqual(expect.arrayContaining(["read", "grep", "find", "ls", "bash", "edit", "write"]));
  expect(options.tools).not.toEqual(expect.arrayContaining(["read", "grep", "find", "ls", "bash", "edit", "write"]));
}

describe("Pi Question Chat runtime adapter", () => {
  it("adds the separate propose_answer tool and awaits authoritative append results", async () => {
    const fixture = createSourceFixture();
    const fake = fakeCreateSession();
    const proposeAnswer = vi.fn()
      .mockResolvedValueOnce({
        status: "appended",
        option: { value: "chat_opaque", label: "Stage first", provenance: "chat" }
      })
      .mockResolvedValueOnce({
        status: "error",
        error: { code: "duplicate_option", message: "An option with that label already exists." }
      });
    const adapter = new PiQuestionChatRuntimeAdapter({
      privateRoot: join(fixture.root, "private-chats"),
      agentDir: join(fixture.root, "agent"),
      createAgentSession: fake.create,
      proposeAnswer
    });

    const runtime = await adapter.create({
      requestId: "ask-propose-tool",
      ownerSessionId: "session-owner",
      source: { agentSessionPath: fixture.sourcePath, leafId: fixture.selectedLeafId, cwd: fixture.cwd }
    });
    const options = fake.create.mock.calls[0]![0];
    expect(REPOSITORY_EVIDENCE_TOOL_NAMES).toEqual([
      "repository_read",
      "repository_grep",
      "repository_find",
      "repository_list"
    ]);
    expect(options.tools).toEqual([...REPOSITORY_EVIDENCE_TOOL_NAMES, PROPOSE_ANSWER_TOOL_NAME]);
    expect(options.customTools?.map((tool) => tool.name)).toEqual([...REPOSITORY_EVIDENCE_TOOL_NAMES, PROPOSE_ANSWER_TOOL_NAME]);
    const tool = options.customTools?.find((candidate) => candidate.name === PROPOSE_ANSWER_TOOL_NAME);
    expect(tool).toBeTruthy();
    await expect(tool!.execute("proposal-call-1", { label: "Stage first" }, new AbortController().signal)).resolves.toEqual({
      content: [{ type: "text", text: "Added “Stage first” as a Suggested in Chat option." }],
      details: {
        optionValue: "chat_opaque",
        action: { type: "show-question", optionValue: "chat_opaque" }
      }
    });
    expect(proposeAnswer).toHaveBeenCalledWith("ask-propose-tool", { label: "Stage first" }, expect.any(AbortSignal));
    await expect(tool!.execute("proposal-call-2", { label: "Stage first" }, new AbortController().signal))
      .rejects.toMatchObject({ code: "duplicate_option", message: "An option with that label already exists." });
    expect(options.resourceLoader?.getSystemPrompt()).toContain("propose_answer");
    await runtime.terminate();
  });

  it("treats an absent private recovery root as no recoverable Chats during cleanup", async () => {
    const root = mkdtempSync(join(tmpdir(), "postbox-empty-chat-runtime-"));
    const adapter = new PiQuestionChatRuntimeAdapter({
      privateRoot: join(root, "not-created"),
      agentDir: join(root, "agent"),
      createAgentSession: fakeCreateSession().create
    });
    const registry = new QuestionChatRuntimeRegistry(adapter);

    expect(adapter.listRecoveryOffers()).toEqual([]);
    await expect(registry.cleanupAll("session-owner")).resolves.toBeUndefined();
  });

  it("persists a private versioned recovery manifest before events and reopens the same transcript after reload", async () => {
    const fixture = createSourceFixture();
    const privateRoot = join(fixture.root, "private-chats");
    const sessions: Array<{ abort: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }> = [];
    let activeManager: SessionManager | undefined;
    const createSession = vi.fn(async (options: CreateAgentSessionOptions) => {
      activeManager = options.sessionManager;
      const session = {
        model: { provider: "test-provider", id: "source-model" },
        prompt: vi.fn(async (_text: string, promptOptions: { preflightResult?: (success: boolean) => void }) => {
          promptOptions.preflightResult?.(true);
        }),
        abort: vi.fn(async () => undefined),
        dispose: vi.fn()
      };
      sessions.push(session);
      return { session, extensionsResult: { extensions: [], errors: [], runtime: undefined } } as unknown as CreateAgentSessionResult;
    });
    const adapter = new PiQuestionChatRuntimeAdapter({
      privateRoot,
      agentDir: join(fixture.root, "agent"),
      createAgentSession: createSession
    });
    const registry = new QuestionChatRuntimeRegistry(adapter);
    await registry.activate({
      requestId: "ask-recover",
      ownerSessionId: "session-owner",
      source: { agentSessionPath: fixture.sourcePath, leafId: fixture.selectedLeafId, cwd: fixture.cwd }
    });

    const runtimeDir = join(privateRoot, readdirSync(privateRoot)[0]!);
    const manifestPath = join(runtimeDir, "manifest.json");
    expect(statSync(privateRoot).mode & 0o777).toBe(0o700);
    expect(statSync(runtimeDir).mode & 0o777).toBe(0o700);
    expect(statSync(manifestPath).mode & 0o777).toBe(0o600);
    const createdManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(createdManifest).toMatchObject({
      version: 1,
      requestId: "ask-recover",
      ownerSessionId: "session-owner",
      forkKind: "exact",
      cwd: fixture.cwd,
      chatBoundaryId: fixture.selectedLeafId,
      sequence: 0
    });
    expect(createdManifest.privateSessionPath).toBe(activeManager!.getSessionFile());

    const observedSequences: number[] = [];
    registry.subscribe("ask-recover", (event) => {
      const durable = JSON.parse(readFileSync(manifestPath, "utf8"));
      observedSequences.push(durable.sequence);
      expect(durable.sequence).toBeGreaterThanOrEqual(event.sequence);
    });
    await registry.send("ask-recover", "session-owner", { clientCommandId: "persisted-command", message: "Explain recovery." });
    expect(observedSequences.length).toBeGreaterThan(0);
    activeManager!.appendMessage({ role: "user", content: "Explain recovery.", timestamp: Date.now() });
    activeManager!.appendMessage({
      role: "assistant",
      content: [{ type: "toolCall", id: "persisted-tool", name: "repository_read", arguments: { path: "src/file.ts" } }],
      api: "anthropic-messages",
      provider: "test-provider",
      model: "source-model",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "toolUse",
      timestamp: Date.now()
    });
    activeManager!.appendMessage({
      role: "assistant",
      content: [{ type: "toolCall", id: "persisted-proposal", name: "propose_answer", arguments: { label: "Stage first" } }],
      api: "anthropic-messages",
      provider: "test-provider",
      model: "source-model",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "toolUse",
      timestamp: Date.now()
    });
    activeManager!.appendMessage({
      role: "toolResult",
      toolCallId: "persisted-proposal",
      toolName: "propose_answer",
      content: [{ type: "text", text: "Added “Stage first” as a Suggested in Chat option." }],
      details: { optionValue: "chat_persisted", action: { type: "show-question", optionValue: "chat_persisted" } },
      isError: false,
      timestamp: Date.now()
    });
    activeManager!.appendMessage({
      role: "toolResult",
      toolCallId: "persisted-tool",
      toolName: "repository_read",
      content: [{ type: "text", text: "bounded persisted evidence" }],
      isError: false,
      timestamp: Date.now()
    });
    activeManager!.appendMessage({
      role: "assistant",
      content: [{ type: "toolCall", id: "interrupted-tool", name: "repository_find", arguments: { path: "src", query: "unfinished" } }],
      api: "anthropic-messages",
      provider: "test-provider",
      model: "source-model",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "toolUse",
      timestamp: Date.now()
    });

    await registry.suspendAll();
    expect(sessions[0]!.abort).toHaveBeenCalledOnce();
    expect(sessions[0]!.dispose).toHaveBeenCalledOnce();
    expect(existsSync(runtimeDir)).toBe(true);
    expect(existsSync(manifestPath)).toBe(true);

    const recoveredPropose = vi.fn();
    const reloaded = new QuestionChatRuntimeRegistry(new PiQuestionChatRuntimeAdapter({
      privateRoot,
      agentDir: join(fixture.root, "agent"),
      createAgentSession: createSession,
      proposeAnswer: recoveredPropose
    }));
    expect(await reloaded.listRecoveryOffers()).toEqual([
      { requestId: "ask-recover", ownerSessionId: "session-owner", forkKind: "exact" }
    ]);
    const [result] = await reloaded.reconcile("session-owner", [
      { requestId: "ask-recover", forkKind: "exact", action: "recover" }
    ]);
    expect(result).toMatchObject({
      status: "recovered",
      snapshot: {
        requestId: "ask-recover",
        forkKind: "exact",
        sequence: expect.any(Number),
        messages: [expect.objectContaining({ role: "user", text: "Explain recovery." })],
        tools: [
          expect.objectContaining({ id: "persisted-tool", state: "success", details: "bounded persisted evidence" }),
          expect.objectContaining({
            id: "persisted-proposal",
            tool: "propose_answer",
            state: "success",
            target: "Stage first",
            action: { type: "show-question", optionValue: "chat_persisted" }
          }),
          expect.objectContaining({ id: "interrupted-tool", state: "stale" })
        ]
      }
    });
    expect(result.status === "recovered" && result.snapshot.sequence).toBeGreaterThanOrEqual(observedSequences.at(-1)!);
    expect(createSession).toHaveBeenCalledTimes(2);
    expect(recoveredPropose).not.toHaveBeenCalled();
    for (const [options] of createSession.mock.calls) expectReadOnlyEvidenceTools(options);
    await reloaded.cleanup("ask-recover");
    expect(existsSync(runtimeDir)).toBe(false);
  });

  it("deletes corrupt manifests and private-session symlink escapes without following them", async () => {
    const fixture = createSourceFixture();
    const privateRoot = join(fixture.root, "private-chats");
    mkdirSync(privateRoot, { recursive: true, mode: 0o700 });
    const corruptDir = join(privateRoot, "a".repeat(64));
    mkdirSync(corruptDir, { mode: 0o700 });
    writeFileSync(join(corruptDir, "manifest.json"), "{not-json", { mode: 0o600 });
    const fake = fakeCreateSession();
    const adapter = new PiQuestionChatRuntimeAdapter({
      privateRoot,
      agentDir: join(fixture.root, "agent"),
      createAgentSession: fake.create
    });
    expect(adapter.listRecoveryOffers()).toEqual([]);
    expect(existsSync(corruptDir)).toBe(false);

    const registry = new QuestionChatRuntimeRegistry(adapter);
    await registry.activate({
      requestId: "ask-symlink",
      ownerSessionId: "session-owner",
      source: { agentSessionPath: fixture.sourcePath, leafId: fixture.selectedLeafId, cwd: fixture.cwd }
    });
    const runtimeDir = join(privateRoot, readdirSync(privateRoot)[0]!);
    const manifest = JSON.parse(readFileSync(join(runtimeDir, "manifest.json"), "utf8"));
    await registry.suspendAll();
    const outside = join(fixture.root, "outside.jsonl");
    writeFileSync(outside, "outside must survive\n", { mode: 0o600 });
    unlinkSync(manifest.privateSessionPath);
    symlinkSync(outside, manifest.privateSessionPath);

    expect(adapter.listRecoveryOffers()).toEqual([]);
    expect(existsSync(runtimeDir)).toBe(false);
    expect(readFileSync(outside, "utf8")).toBe("outside must survive\n");

    await registry.activate({
      requestId: "ask-internal-symlink",
      ownerSessionId: "session-owner",
      source: { agentSessionPath: fixture.sourcePath, leafId: fixture.selectedLeafId, cwd: fixture.cwd }
    });
    const internalDir = join(privateRoot, readdirSync(privateRoot)[0]!);
    const internalManifest = JSON.parse(readFileSync(join(internalDir, "manifest.json"), "utf8"));
    await registry.suspendAll();
    const realSessionPath = `${internalManifest.privateSessionPath}.real`;
    renameSync(internalManifest.privateSessionPath, realSessionPath);
    symlinkSync(realSessionPath, internalManifest.privateSessionPath);
    expect(adapter.listRecoveryOffers()).toEqual([]);
    expect(existsSync(internalDir)).toBe(false);
  });

  it("deletes owned disk-only recovery manifests on replacement after reload", async () => {
    const fixture = createSourceFixture();
    const privateRoot = join(fixture.root, "private-chats");
    const adapter = new PiQuestionChatRuntimeAdapter({
      privateRoot,
      agentDir: join(fixture.root, "agent"),
      createAgentSession: fakeCreateSession().create
    });
    const live = new QuestionChatRuntimeRegistry(adapter);
    await live.activate({
      requestId: "ask-reload-replacement",
      ownerSessionId: "session-owner",
      source: { agentSessionPath: fixture.sourcePath, leafId: fixture.selectedLeafId, cwd: fixture.cwd }
    });
    const runtimeDir = join(privateRoot, readdirSync(privateRoot)[0]!);
    await live.suspendAll();
    expect(existsSync(join(runtimeDir, "manifest.json"))).toBe(true);

    const reloaded = new QuestionChatRuntimeRegistry(adapter);
    await reloaded.cleanupAll("session-owner");
    expect(existsSync(runtimeDir)).toBe(false);
  });

  it("deletes a structurally invalid recovered fork whose transcript boundary is missing", async () => {
    const fixture = createSourceFixture();
    const privateRoot = join(fixture.root, "private-chats");
    const adapter = new PiQuestionChatRuntimeAdapter({
      privateRoot,
      agentDir: join(fixture.root, "agent"),
      createAgentSession: fakeCreateSession().create
    });
    const live = new QuestionChatRuntimeRegistry(adapter);
    await live.activate({
      requestId: "ask-missing-boundary",
      ownerSessionId: "session-owner",
      source: { agentSessionPath: fixture.sourcePath, leafId: fixture.selectedLeafId, cwd: fixture.cwd }
    });
    const runtimeDir = join(privateRoot, readdirSync(privateRoot)[0]!);
    const manifestPath = join(runtimeDir, "manifest.json");
    await live.suspendAll();
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, chatBoundaryId: "missing-boundary" })}\n`, { mode: 0o600 });

    const reloaded = new QuestionChatRuntimeRegistry(adapter);
    expect(reloaded.listRecoveryOffers()).toHaveLength(1);
    await expect(reloaded.reconcile("session-owner", [
      { requestId: "ask-missing-boundary", forkKind: "exact", action: "recover" }
    ])).resolves.toEqual([
      expect.objectContaining({ status: "failed", requestId: "ask-missing-boundary" })
    ]);
    expect(existsSync(runtimeDir)).toBe(false);
  });
  it("creates an isolated context-only interviewer from authoritative persisted handoff context without inventing source history", async () => {
    const root = mkdtempSync(join(tmpdir(), "postbox-context-chat-runtime-"));
    const privateRoot = join(root, "private-chats");
    const recordedModel = { provider: "anthropic", id: "claude-sonnet-4" } as any;
    const modelRuntime = {
      getModel: vi.fn((provider: string, id: string) =>
        provider === recordedModel.provider && id === recordedModel.id ? recordedModel : undefined),
      hasConfiguredAuth: vi.fn(() => true)
    } as any;
    const fake = fakeCreateSession(recordedModel);
    const adapter = new PiQuestionChatRuntimeAdapter({
      privateRoot,
      agentDir: join(root, "agent"),
      createAgentSession: fake.create,
      createModelRuntime: vi.fn(async () => modelRuntime)
    });
    const registry = new QuestionChatRuntimeRegistry(adapter);
    const source = {
      cwd: join(root, "repo"),
      model: "anthropic/claude-sonnet-4",
      mode: "single" as const,
      question: {
        prompt: "Which storage design?",
        context: "The public API is not final.",
        relevance: "This blocks implementation.",
        decisionImpact: "The choice fixes compatibility."
      },
      options: [
        { value: "sqlite", label: "SQLite", description: "One local file.", meaning: "Durable local state." },
        { value: "memory", label: "Memory", context: "Useful only in tests." }
      ],
      context: {
        codebaseContext: "Fastify server with a request store.",
        problemContext: "The request must survive restart.",
        additionalInfo: [
          { kind: "code" as const, title: "Existing seam", content: "requestStore.create(payload)", language: "ts" },
          { kind: "link" as const, title: "Design note", content: "https://example.test/design" }
        ]
      }
    };
    mkdirSync(source.cwd, { recursive: true });

    const [first, retry] = await Promise.all([
      registry.activateContext({ requestId: "ask-context", ownerSessionId: "session-owner", source }),
      registry.activateContext({ requestId: "ask-context", ownerSessionId: "session-owner", source })
    ]);
    expect(first).toEqual(retry);
    expect(first).toMatchObject({
      state: "ready",
      forkKind: "context-only",
      messages: [],
      model: { id: "anthropic/claude-sonnet-4", source: "originating" }
    });
    expect(fake.create).toHaveBeenCalledOnce();
    const options = fake.create.mock.calls[0]![0];
    expect(options.model).toBe(recordedModel);
    expectReadOnlyEvidenceTools(options);
    expect(options.resourceLoader?.getExtensions().extensions).toEqual([]);
    expect(options.resourceLoader?.getSkills().skills).toEqual([]);
    expect(options.resourceLoader?.getAgentsFiles().agentsFiles).toEqual([]);
    expect(options.sessionManager?.buildSessionContext().messages).toEqual([]);
    const systemPrompt = options.resourceLoader?.getSystemPrompt() ?? "";
    expect(systemPrompt).toContain("fresh private context-only interviewer session");
    expect(systemPrompt).toContain("Which storage design?");
    expect(systemPrompt).toContain("SQLite");
    expect(systemPrompt).toContain("Memory");
    expect(systemPrompt).toContain("Fastify server with a request store.");
    expect(systemPrompt).toContain("The request must survive restart.");
    expect(systemPrompt).toContain("requestStore.create(payload)");
    expect(systemPrompt).not.toContain("source transcript");
    expect(systemPrompt).not.toContain("source answer");

    const runtimeDir = options.sessionManager!.getSessionDir();
    expect(relative(privateRoot, runtimeDir)).not.toMatch(/^\.\./);
    expect(statSync(runtimeDir).mode & 0o777).toBe(0o700);
    await registry.cleanup("ask-context");
    expect(fake.lifecycle).toEqual(["abort", "dispose"]);
    expect(existsSync(runtimeDir)).toBe(false);
  });

  it("discloses Pi-default context-only model fallback and rejects cross-kind replacement", async () => {
    const fixture = createSourceFixture();
    const fallback = fakeCreateSession({ provider: "fallback-provider", id: "default-model" });
    const modelRuntime = {
      getModel: vi.fn(() => undefined),
      hasConfiguredAuth: vi.fn(() => false)
    } as any;
    const adapter = new PiQuestionChatRuntimeAdapter({
      privateRoot: join(fixture.root, "private-chats"),
      agentDir: join(fixture.root, "agent"),
      createAgentSession: fallback.create,
      createModelRuntime: vi.fn(async () => modelRuntime)
    });
    const registry = new QuestionChatRuntimeRegistry(adapter);
    const contextSource = {
      cwd: fixture.cwd,
      model: "recorded-provider/missing-model",
      mode: "single" as const,
      question: { prompt: "Choose." },
      options: [{ value: "a", label: "A" }],
      context: { codebaseContext: "Codebase.", problemContext: "Problem." }
    };
    const snapshot = await registry.activateContext({ requestId: "ask-context-fallback", ownerSessionId: "session-owner", source: contextSource });
    expect(snapshot.model).toMatchObject({
      id: "fallback-provider/default-model",
      source: "pi-default",
      fallbackReason: expect.stringContaining("recorded-provider/missing-model")
    });
    expect(fallback.create.mock.calls[0]![0].model).toBeUndefined();
    await expect(registry.activate({
      requestId: "ask-context-fallback",
      ownerSessionId: "session-owner",
      source: { agentSessionPath: fixture.sourcePath, leafId: fixture.selectedLeafId, cwd: fixture.cwd }
    })).rejects.toMatchObject({ code: "runtime_busy" });
    expect(fallback.create).toHaveBeenCalledOnce();
    await registry.cleanup("ask-context-fallback");
  });

  it("creates one private root-to-leaf fork without changing the source or spending model capacity", async () => {
    const fixture = createSourceFixture();
    const before = readFileSync(fixture.sourcePath);
    const beforeMtime = statSync(fixture.sourcePath).mtimeMs;
    const fake = fakeCreateSession();
    const recordedModel = { provider: "test-provider", id: "source-model" } as any;
    const modelRuntime = {
      getModel: vi.fn((provider: string, id: string) =>
        provider === recordedModel.provider && id === recordedModel.id ? recordedModel : undefined),
      hasConfiguredAuth: vi.fn(() => true)
    } as any;
    const privateRoot = join(fixture.root, "private-chats");
    const adapter = new PiQuestionChatRuntimeAdapter({
      privateRoot,
      agentDir: join(fixture.root, "agent"),
      createAgentSession: fake.create,
      createModelRuntime: vi.fn(async () => modelRuntime)
    });
    const registry = new QuestionChatRuntimeRegistry(adapter);

    const source = { agentSessionPath: fixture.sourcePath, leafId: fixture.selectedLeafId, cwd: fixture.cwd };
    const [first, retry] = await Promise.all([
      registry.activate({ requestId: "ask/runtime-safe", ownerSessionId: "session-owner", source }),
      registry.activate({ requestId: "ask/runtime-safe", ownerSessionId: "session-owner", source })
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
    expect(options.model).toBe(recordedModel);
    expectReadOnlyEvidenceTools(options);
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

  it("uses Pi's configured default when an exact fork's recorded model is unauthenticated", async () => {
    const fixture = createSourceFixture();
    const fake = fakeCreateSession({ provider: "fallback-provider", id: "default-model" });
    const recordedModel = { provider: "test-provider", id: "source-model" } as any;
    const modelRuntime = {
      getModel: vi.fn(() => recordedModel),
      hasConfiguredAuth: vi.fn(() => false)
    } as any;
    const adapter = new PiQuestionChatRuntimeAdapter({
      privateRoot: join(fixture.root, "private-chats"),
      agentDir: join(fixture.root, "agent"),
      createAgentSession: fake.create,
      createModelRuntime: vi.fn(async () => modelRuntime)
    });

    const runtime = await adapter.create({
      requestId: "ask-fallback",
      ownerSessionId: "session-owner",
      source: { agentSessionPath: fixture.sourcePath, leafId: fixture.selectedLeafId, cwd: fixture.cwd }
    });
    expect(runtime.snapshot.model).toMatchObject({
      id: "fallback-provider/default-model",
      source: "pi-default",
      fallbackReason: expect.stringContaining("test-provider/source-model")
    });
    expect(modelRuntime.getModel).toHaveBeenCalledWith("test-provider", "source-model");
    expect(modelRuntime.hasConfiguredAuth).toHaveBeenCalledWith("test-provider");
    expect(fake.create.mock.calls[0]![0].model).toBeUndefined();
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
      ownerSessionId: "session-owner",
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
      adapter.create({ requestId: "missing-path", ownerSessionId: "session-owner", source: { agentSessionPath: join(fixture.root, "missing"), leafId: "leaf", cwd: fixture.cwd } })
    ).rejects.toMatchObject({ code: "source_path_missing" } satisfies Partial<QuestionChatRuntimeError>);
    await expect(
      adapter.create({ requestId: "missing-leaf", ownerSessionId: "session-owner", source: { agentSessionPath: fixture.sourcePath, leafId: "missing", cwd: fixture.cwd } })
    ).rejects.toMatchObject({ code: "source_leaf_missing" } satisfies Partial<QuestionChatRuntimeError>);
    expect(fake.create).not.toHaveBeenCalled();
  });

  it("sends an ordinary SDK prompt and exposes only normalized visible stream events", async () => {
    const fixture = createSourceFixture();
    let listener: ((event: any) => void) | undefined;
    let forkManager: SessionManager | undefined;
    let acceptFirstPrompt!: () => void;
    let promptCall = 0;
    const prompt = vi.fn((_text: string, options: { preflightResult?: (success: boolean) => void }) => {
      promptCall += 1;
      if (promptCall === 1) {
        return new Promise<void>((resolve) => {
          acceptFirstPrompt = () => {
            options.preflightResult?.(true);
            resolve();
          };
        });
      }
      options.preflightResult?.(true);
      return Promise.resolve();
    });
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
      ownerSessionId: "session-owner",
      source: { agentSessionPath: fixture.sourcePath, leafId: fixture.selectedLeafId, cwd: fixture.cwd }
    });
    const events: QuestionChatEvent[] = [];
    registry.subscribe(requestId, (event) => events.push(event));

    const firstSend = registry.send(requestId, "session-owner", { clientCommandId: "browser-command-1", message: "Please explain." });
    await Promise.resolve();
    await expect(
      registry.send(requestId, "session-owner", { clientCommandId: "too-early-steer", message: "Do not start another prompt" })
    ).rejects.toMatchObject({ code: "runtime_busy" });
    await expect(registry.stop(requestId, "session-owner", { clientCommandId: "too-early-stop" })).rejects.toMatchObject({ code: "runtime_busy" });
    expect((await registry.getSnapshot(requestId, "session-owner")).state).toBe("ready");
    acceptFirstPrompt();
    await expect(firstSend).resolves.toEqual({
      status: "accepted",
      clientCommandId: "browser-command-1",
      mode: "turn"
    });
    expect(prompt).toHaveBeenCalledWith("Please explain.", expect.objectContaining({
      expandPromptTemplates: false,
      source: "rpc",
      preflightResult: expect.any(Function)
    }));
    await expect(registry.send(requestId, "session-owner", { clientCommandId: "browser-command-2", message: "Correction while running" })).resolves.toEqual({
      status: "accepted",
      clientCommandId: "browser-command-2",
      mode: "steer"
    });
    expect(prompt).toHaveBeenNthCalledWith(2, "Correction while running", {
      expandPromptTemplates: false,
      source: "rpc",
      streamingBehavior: "steer",
      preflightResult: expect.any(Function)
    });
    prompt.mockRejectedValueOnce(new Error("steer queue unavailable"));
    await expect(
      registry.send(requestId, "session-owner", { clientCommandId: "browser-command-rejected", message: "Rejected correction" })
    ).rejects.toThrow("steer queue unavailable");
    expect((await registry.getSnapshot(requestId, "session-owner")).state).toBe("generating");
    expect((await registry.getSnapshot(requestId, "session-owner")).messages).not.toContainEqual(
      expect.objectContaining({ text: "Rejected correction" })
    );

    listener?.({ type: "agent_start" });
    listener?.({
      type: "tool_execution_start",
      toolCallId: "tool-evidence-1",
      toolName: "repository_grep",
      args: { path: "src", query: "literal evidence", secretInternal: "must-not-stream" }
    });
    listener?.({
      type: "tool_execution_end",
      toolCallId: "tool-evidence-1",
      toolName: "repository_grep",
      result: {
        content: [{ type: "text", text: "src/file.ts:2:literal evidence" }],
        details: { privatePath: "/host/private" }
      },
      isError: false
    });
    const longToolIdPrefix = "tool-id-prefix-".repeat(16);
    const longToolIds = [`${longToolIdPrefix}a`, `${longToolIdPrefix}b`];
    listener?.({
      type: "tool_execution_start",
      toolCallId: longToolIds[0],
      toolName: "repository_read",
      args: { path: "src/a.ts" }
    });
    listener?.({
      type: "tool_execution_start",
      toolCallId: longToolIds[1],
      toolName: "repository_read",
      args: { path: "src/\u202Eb.ts" }
    });
    listener?.({
      type: "tool_execution_end",
      toolCallId: longToolIds[0],
      toolName: "repository_read",
      result: { content: [{ type: "text", text: `${"d".repeat(9_000)}\u202Ehidden` }] },
      isError: false
    });
    listener?.({ type: "tool_execution_start", toolCallId: "tool-shell", toolName: "bash", args: { command: "cat .env" } });
    listener?.({
      type: "tool_execution_start",
      toolCallId: "tool-proposal-1",
      toolName: "propose_answer",
      args: { label: "Stage first", description: "private input must not stream" }
    });
    listener?.({
      type: "tool_execution_end",
      toolCallId: "tool-proposal-1",
      toolName: "propose_answer",
      result: {
        content: [{ type: "text", text: "Added “Stage first” as a Suggested in Chat option." }],
        details: { optionValue: "chat_live", action: { type: "show-question", optionValue: "chat_live" } }
      },
      isError: false
    });
    listener?.({
      type: "tool_execution_start",
      toolCallId: "tool-restricted-display",
      toolName: "repository_read",
      args: { path: "config/token-store.json" }
    });
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
    expect((await registry.getSnapshot(requestId, "session-owner")).messages.at(-1)).toMatchObject({ role: "assistant", text: "Visible **answer**", status: "final" });
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
    const toolEvents = events.filter((event) => event.type === "tool.started" || event.type === "tool.finished");
    expect(toolEvents.filter((event) => event.activity.target === "src")).toEqual([
      expect.objectContaining({ type: "tool.started", activity: expect.objectContaining({ id: "tool-evidence-1", state: "running", target: "src" }) }),
      expect.objectContaining({ type: "tool.finished", activity: expect.objectContaining({ id: "tool-evidence-1", state: "success", details: "src/file.ts:2:literal evidence" }) })
    ]);
    const boundedLongIds = toolEvents
      .filter((event) => event.activity.tool === "repository_read" && event.activity.id.length === 200)
      .map((event) => event.activity.id);
    expect(new Set(boundedLongIds).size).toBe(2);
    expect(boundedLongIds.every((id) => id.length <= 200)).toBe(true);
    const boundedResult = toolEvents.find(
      (event) => event.type === "tool.finished" && event.activity.target === "src/a.ts"
    );
    expect(boundedResult?.activity.details).toHaveLength(8_000);
    expect(boundedResult?.activity.details).toMatch(/… details truncated …$/);
    expect(JSON.stringify(toolEvents)).not.toMatch(/[\u202A-\u202E\u2066-\u2069]/);
    expect(toolEvents).toContainEqual(
      expect.objectContaining({
        type: "tool.started",
        activity: expect.objectContaining({ id: "tool-restricted-display", target: "restricted target" })
      })
    );
    expect(toolEvents).toContainEqual(expect.objectContaining({
      type: "tool.finished",
      activity: expect.objectContaining({
        id: "tool-proposal-1",
        tool: "propose_answer",
        target: "Stage first",
        state: "success",
        details: "Added “Stage first” as a Suggested in Chat option.",
        action: { type: "show-question", optionValue: "chat_live" }
      })
    }));
    expect(JSON.stringify(toolEvents)).not.toContain("private input must not stream");
    expect(JSON.stringify(toolEvents)).not.toContain("token-store.json");
    expect(JSON.stringify(toolEvents)).not.toContain("must-not-stream");
    expect(JSON.stringify(toolEvents)).not.toContain("/host/private");
    expect(JSON.stringify(toolEvents)).not.toContain("cat .env");
    const snapshot = await registry.getSnapshot(requestId, "session-owner");
    expect(snapshot).toMatchObject({ state: "ready", sequence: events.at(-1)?.sequence });
    expect(snapshot.messages.map((message) => message.text)).toEqual([
      "Please explain.",
      "Visible **answer**",
      "Correction while running"
    ]);
    expect(JSON.stringify(snapshot.messages)).not.toContain("selected branch");
    expect(snapshot.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "tool-evidence-1", tool: "repository_grep", state: "success", target: "src" }),
      expect.objectContaining({ tool: "repository_read", state: "success", target: "src/a.ts" }),
      expect.objectContaining({ tool: "repository_read", state: "running", target: "src/b.ts" })
    ]));

    await registry.send(requestId, "session-owner", { clientCommandId: "browser-command-3", message: "Please explain." });
    expect((await registry.getSnapshot(requestId, "session-owner")).messages.filter((message) => message.role === "user" && message.text === "Please explain.")).toHaveLength(2);
    listener?.({ type: "message_start", message: { role: "assistant", content: [], timestamp: 11 } });
    listener?.({
      type: "message_update",
      message: { role: "assistant", content: [{ type: "text", text: "Visible **answer**" }], timestamp: 11 },
      assistantMessageEvent: { type: "text_delta", delta: "Visible **answer**" }
    });
    listener?.({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "Visible **answer**" }], stopReason: "stop", timestamp: 11 }
    });
    expect((await registry.getSnapshot(requestId, "session-owner")).messages.filter((message) => message.role === "assistant" && message.text === "Visible **answer**")).toHaveLength(2);
    forkManager!.appendMessage({ role: "user", content: "Please explain.", timestamp: 10 });
    forkManager!.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "Visible **answer**" }],
      api: "anthropic-messages",
      provider: "test-provider",
      model: "source-model",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop",
      timestamp: 11
    });
    listener?.({ type: "agent_settled" });
    expect((await registry.getSnapshot(requestId, "session-owner")).messages.filter((message) => message.role === "assistant" && message.text === "Visible **answer**")).toHaveLength(2);
  });

  it("deduplicates an in-flight client command without prompting twice", async () => {
    let finishSend!: () => void;
    const runtime = {
      snapshot: { requestId: "ask-dedupe", state: "ready", forkKind: "exact", model: { id: "test/model", source: "originating" }, sequence: 0, messages: [] },
      send: vi.fn((command: { clientCommandId: string }) => new Promise<{ status: "accepted"; clientCommandId: string; mode: "turn" }>((resolve) => {
        finishSend = () => resolve({ status: "accepted", clientCommandId: command.clientCommandId, mode: "turn" });
      })),
      subscribe: vi.fn(() => () => undefined),
      terminate: vi.fn(async () => undefined)
    };
    const registry = new QuestionChatRuntimeRegistry({ create: vi.fn(async () => runtime) } as any);
    await registry.activate({ requestId: "ask-dedupe", ownerSessionId: "session-owner", source: { agentSessionPath: "/unused", leafId: "leaf", cwd: "/repo" } });
    const first = registry.send("ask-dedupe", "session-owner", { clientCommandId: "same", message: "hello" });
    const retry = registry.send("ask-dedupe", "session-owner", { clientCommandId: "same", message: "hello" });
    await Promise.resolve();
    expect(runtime.send).toHaveBeenCalledOnce();
    finishSend();
    await expect(Promise.all([first, retry])).resolves.toEqual([
      { status: "accepted", clientCommandId: "same", mode: "turn" },
      { status: "accepted", clientCommandId: "same", mode: "turn" }
    ]);
  });

  it("creates exactly one runtime for concurrent activations and enforces its owner", async () => {
    let finishCreate!: (runtime: any) => void;
    const create = vi.fn(() => new Promise<any>((resolve) => {
      finishCreate = resolve;
    }));
    const registry = new QuestionChatRuntimeRegistry({ create } as any);
    const input = {
      requestId: "ask-concurrent-activation",
      ownerSessionId: "session-owner",
      source: { agentSessionPath: "/unused", leafId: "leaf", cwd: "/repo" }
    };
    const first = registry.activate(input);
    const second = registry.activate(input);
    expect(create).toHaveBeenCalledOnce();
    await expect(registry.activate({ ...input, ownerSessionId: "session-other" })).rejects.toMatchObject({
      code: "wrong_owner"
    });
    finishCreate({
      snapshot: {
        requestId: input.requestId,
        state: "ready",
        forkKind: "exact",
        model: { id: "test/model", source: "originating" },
        sequence: 0,
        messages: []
      },
      send: vi.fn(),
      stop: vi.fn(),
      subscribe: vi.fn(() => () => undefined),
      terminate: vi.fn(async () => undefined)
    });
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ requestId: input.requestId }),
      expect.objectContaining({ requestId: input.requestId })
    ]);
  });

  it("bounds runtime command outcomes and terminal ownership tombstones", async () => {
    const send = vi.fn(async (command: { clientCommandId: string }) => ({
      status: "accepted" as const,
      clientCommandId: command.clientCommandId,
      mode: "turn" as const
    }));
    const create = vi.fn(async ({ requestId }: { requestId: string }) => ({
      snapshot: {
        requestId,
        state: "ready" as const,
        forkKind: "exact" as const,
        model: { id: "test/model", source: "originating" as const },
        sequence: 0,
        messages: []
      },
      send,
      stop: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
      terminate: vi.fn(async () => undefined),
      suspend: vi.fn(async () => undefined)
    }));
    const registry = new QuestionChatRuntimeRegistry({ create, createContext: vi.fn() } as any);

    await registry.activate({
      requestId: "ask-bounded-commands",
      ownerSessionId: "session-owner",
      source: { agentSessionPath: "/unused", leafId: "leaf", cwd: "/repo" }
    });
    for (let index = 0; index < 300; index += 1) {
      await registry.send("ask-bounded-commands", "session-owner", {
        clientCommandId: `command-${index}`,
        message: `Message ${index}`
      });
    }
    await registry.send("ask-bounded-commands", "session-owner", {
      clientCommandId: "command-299",
      message: "Message 299"
    });
    expect(send).toHaveBeenCalledTimes(300);
    await registry.send("ask-bounded-commands", "session-owner", {
      clientCommandId: "command-0",
      message: "Message 0"
    });
    expect(send).toHaveBeenCalledTimes(301);

    const beforeMultiRequestChurn = send.mock.calls.length;
    for (let index = 0; index < 300; index += 1) {
      const requestId = `ask-outcome-${index}`;
      await registry.activate({
        requestId,
        ownerSessionId: "session-owner",
        source: { agentSessionPath: "/unused", leafId: "leaf", cwd: "/repo" }
      });
      await registry.send(requestId, "session-owner", {
        clientCommandId: "server-restart-stable-command",
        message: `Question ${index}`
      });
    }
    expect(send).toHaveBeenCalledTimes(beforeMultiRequestChurn + 300);
    await registry.send("ask-outcome-299", "session-owner", {
      clientCommandId: "server-restart-stable-command",
      message: "Question 299"
    });
    expect(send).toHaveBeenCalledTimes(beforeMultiRequestChurn + 300);
    await registry.send("ask-outcome-0", "session-owner", {
      clientCommandId: "server-restart-stable-command",
      message: "Question 0"
    });
    expect(send).toHaveBeenCalledTimes(beforeMultiRequestChurn + 301);

    for (let index = 0; index < 300; index += 1) {
      const requestId = `ask-terminal-${index}`;
      await registry.activate({
        requestId,
        ownerSessionId: "session-owner",
        source: { agentSessionPath: "/unused", leafId: "leaf", cwd: "/repo" }
      });
      await registry.cleanup(requestId);
    }
    await expect(registry.activate({
      requestId: "ask-terminal-299",
      ownerSessionId: "session-owner",
      source: { agentSessionPath: "/unused", leafId: "leaf", cwd: "/repo" }
    })).rejects.toMatchObject({ code: "request_not_pending" });
    await expect(registry.activate({
      requestId: "ask-terminal-0",
      ownerSessionId: "session-owner",
      source: { agentSessionPath: "/unused", leafId: "leaf", cwd: "/repo" }
    })).resolves.toMatchObject({ requestId: "ask-terminal-0" });
  });

  it("never evicts an in-flight extension command outcome at capacity", async () => {
    const finishes: Array<() => void> = [];
    const send = vi.fn((command: { clientCommandId: string }) => new Promise<{
      status: "accepted";
      clientCommandId: string;
      mode: "turn";
    }>((resolve) => {
      finishes.push(() => resolve({ status: "accepted", clientCommandId: command.clientCommandId, mode: "turn" }));
    }));
    const runtime = {
      snapshot: {
        requestId: "ask-inflight-capacity",
        state: "ready" as const,
        forkKind: "exact" as const,
        model: { id: "test/model", source: "originating" as const },
        sequence: 0,
        messages: []
      },
      send,
      stop: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
      terminate: vi.fn(async () => undefined)
    };
    const registry = new QuestionChatRuntimeRegistry({ create: vi.fn(async () => runtime) } as any);
    await registry.activate({
      requestId: "ask-inflight-capacity",
      ownerSessionId: "session-owner",
      source: { agentSessionPath: "/unused", leafId: "leaf", cwd: "/repo" }
    });

    const pending = Array.from({ length: 256 }, (_, index) => registry.send(
      "ask-inflight-capacity",
      "session-owner",
      { clientCommandId: `inflight-${index}`, message: `Message ${index}` }
    ));
    await expect(registry.send("ask-inflight-capacity", "session-owner", {
      clientCommandId: "inflight-over-capacity",
      message: "Must not execute"
    })).rejects.toMatchObject({ code: "rate_limited" });
    void registry.send("ask-inflight-capacity", "session-owner", {
      clientCommandId: "inflight-0",
      message: "Message 0"
    });
    expect(send).toHaveBeenCalledTimes(256);
    for (const finish of finishes) finish();
    await expect(Promise.all(pending)).resolves.toHaveLength(256);
  });

  it("retains failed command outcomes and rejects conflicting stable command reuse", async () => {
    const failure = new QuestionChatRuntimeError("runtime_failure", "Failed after the runtime accepted work.");
    const runtime = {
      snapshot: {
        requestId: "ask-failed-dedupe",
        state: "ready" as const,
        forkKind: "exact" as const,
        model: { id: "test/model", source: "originating" as const },
        sequence: 0,
        messages: []
      },
      send: vi.fn(async () => { throw failure; }),
      stop: vi.fn(),
      subscribe: vi.fn(() => () => undefined),
      terminate: vi.fn(async () => undefined)
    };
    const registry = new QuestionChatRuntimeRegistry({ create: vi.fn(async () => runtime) } as any);
    await registry.activate({
      requestId: "ask-failed-dedupe",
      ownerSessionId: "session-owner",
      source: { agentSessionPath: "/unused", leafId: "leaf", cwd: "/repo" }
    });

    await expect(registry.send("ask-failed-dedupe", "session-owner", {
      clientCommandId: "stable-failure",
      message: "Run once"
    })).rejects.toBe(failure);
    await expect(registry.send("ask-failed-dedupe", "session-owner", {
      clientCommandId: "stable-failure",
      message: "Run once"
    })).rejects.toBe(failure);
    expect(runtime.send).toHaveBeenCalledOnce();
    await expect(registry.send("ask-failed-dedupe", "session-owner", {
      clientCommandId: "stable-failure",
      message: "Different input"
    })).rejects.toMatchObject({ code: "duplicate_command" });
    expect(runtime.send).toHaveBeenCalledOnce();
  });

  it("makes cleanup win over an in-flight activation and leaves an owner-bound terminal tombstone", async () => {
    let finishCreate!: (runtime: any) => void;
    const terminate = vi.fn(async () => undefined);
    const registry = new QuestionChatRuntimeRegistry({
      create: vi.fn(() => new Promise<any>((resolve) => {
        finishCreate = resolve;
      }))
    } as any);
    const activation = registry.activate({
      requestId: "ask-activation-terminal",
      ownerSessionId: "session-owner",
      source: { agentSessionPath: "/unused", leafId: "leaf", cwd: "/repo" }
    });
    const cleanup = registry.cleanup("ask-activation-terminal");
    finishCreate({
      snapshot: {
        requestId: "ask-activation-terminal",
        state: "ready",
        forkKind: "exact",
        model: { id: "test/model", source: "originating" },
        sequence: 0,
        messages: []
      },
      send: vi.fn(),
      stop: vi.fn(),
      subscribe: vi.fn(() => () => undefined),
      terminate
    });
    await cleanup;
    await expect(activation).rejects.toMatchObject({ code: "request_not_pending" });
    expect(terminate).toHaveBeenCalledOnce();
    await expect(registry.getSnapshot("ask-activation-terminal", "session-owner")).rejects.toMatchObject({
      code: "request_not_pending"
    });
    await expect(registry.getSnapshot("ask-activation-terminal", "session-other")).rejects.toMatchObject({
      code: "wrong_owner"
    });
  });

  it("aborts an in-flight prompt and ignores late SDK effects after terminal cleanup", async () => {
    const fixture = createSourceFixture();
    const privateRoot = join(fixture.root, "private-terminal-race");
    let acceptPrompt!: () => void;
    let finishPrompt!: () => void;
    let listener: ((event: any) => void) | undefined;
    const abort = vi.fn(async () => undefined);
    const dispose = vi.fn();
    const adapter = new PiQuestionChatRuntimeAdapter({
      privateRoot,
      agentDir: join(fixture.root, "agent-terminal-race"),
      createAgentSession: vi.fn(async (options: CreateAgentSessionOptions) => ({
        session: {
          model: { provider: "test-provider", id: "source-model" },
          isStreaming: false,
          state: {},
          sessionManager: options.sessionManager,
          subscribe: (next: (event: any) => void) => {
            listener = next;
            return vi.fn();
          },
          prompt: vi.fn((_text: string, promptOptions: { preflightResult?: (success: boolean) => void }) =>
            new Promise<void>((resolve) => {
              acceptPrompt = () => promptOptions.preflightResult?.(true);
              finishPrompt = resolve;
            })),
          abort,
          dispose
        },
        extensionsResult: { extensions: [], errors: [], runtime: undefined }
      }) as unknown as CreateAgentSessionResult)
    });
    const registry = new QuestionChatRuntimeRegistry(adapter);
    const requestId = "ask-prompt-terminal";
    await registry.activate({
      requestId,
      ownerSessionId: "session-owner",
      source: { agentSessionPath: fixture.sourcePath, leafId: fixture.selectedLeafId, cwd: fixture.cwd }
    });
    const events: QuestionChatEvent[] = [];
    registry.subscribe(requestId, (event) => events.push(event));
    const send = registry.send(requestId, "session-owner", {
      clientCommandId: "turn-terminal",
      message: "This must lose to terminal cleanup"
    });
    await vi.waitFor(() => expect(acceptPrompt).toBeTypeOf("function"));
    const cleanup = registry.cleanup(requestId);
    await cleanup;
    acceptPrompt();
    finishPrompt();
    await expect(send).rejects.toMatchObject({ code: "request_not_pending" });

    listener?.({
      type: "tool_execution_start",
      toolName: "repository_read",
      toolCallId: "late-tool",
      args: { path: "src/late.ts" }
    });
    listener?.({ type: "message_start", message: { role: "assistant", content: [], timestamp: 1 } });
    listener?.({
      type: "message_update",
      message: { role: "assistant", content: [{ type: "text", text: "late" }], timestamp: 1 },
      assistantMessageEvent: { type: "text_delta", delta: "late" }
    });
    expect(events).toEqual([]);
    expect(abort).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
    expect(readdirSync(privateRoot)).toEqual([]);
  });

  it("stops only the active turn, preserves partial output, and accepts a later ordinary prompt", async () => {
    const fixture = createSourceFixture();
    let listener: ((event: any) => void) | undefined;
    let forkManager: SessionManager | undefined;
    const prompt = vi.fn(async (_text: string, options: { preflightResult?: (success: boolean) => void }) => {
      options.preflightResult?.(true);
    });
    let finishAbort!: () => void;
    const abort = vi
      .fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => {
        finishAbort = resolve;
      }))
      .mockResolvedValue(undefined);
    const dispose = vi.fn();
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
          subscribe: (next: (event: any) => void) => {
            listener = next;
            return vi.fn();
          },
          prompt,
          abort,
          dispose
        },
        extensionsResult: { extensions: [], errors: [], runtime: undefined }
      }) as unknown as CreateAgentSessionResult;
      })
    });
    const registry = new QuestionChatRuntimeRegistry(adapter);
    const requestId = "ask-stop";
    await registry.activate({
      requestId,
      ownerSessionId: "session-owner",
      source: { agentSessionPath: fixture.sourcePath, leafId: fixture.selectedLeafId, cwd: fixture.cwd }
    });
    forkManager!.appendMessage({ role: "user", content: "Earlier", timestamp: 17 });
    forkManager!.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "Partial before stop" }],
      api: "anthropic-messages",
      provider: "test-provider",
      model: "source-model",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop",
      timestamp: 18
    });
    const events: QuestionChatEvent[] = [];
    registry.subscribe(requestId, (event) => events.push(event));
    await expect(registry.send(requestId, "session-owner", { clientCommandId: "turn-1", message: "Start" })).resolves.toMatchObject({ mode: "turn" });
    listener?.({ type: "message_start", message: { role: "assistant", content: [], timestamp: 20 } });
    listener?.({
      type: "message_update",
      message: { role: "assistant", content: [{ type: "text", text: "Partial before stop" }], timestamp: 20 },
      assistantMessageEvent: { type: "text_delta", delta: "Partial before stop" }
    });

    const firstStop = registry.stop(requestId, "session-owner", { clientCommandId: "stop-1" });
    const duplicateStop = registry.stop(requestId, "session-owner", { clientCommandId: "stop-1" });
    await Promise.resolve();
    await expect(registry.stop(requestId, "session-owner", { clientCommandId: "stop-distinct" })).rejects.toMatchObject({ code: "runtime_busy" });
    expect(abort).toHaveBeenCalledOnce();
    expect(dispose).not.toHaveBeenCalled();
    finishAbort();
    await expect(Promise.all([firstStop, duplicateStop])).resolves.toEqual([
      { status: "accepted", clientCommandId: "stop-1" },
      { status: "accepted", clientCommandId: "stop-1" }
    ]);
    listener?.({ type: "agent_end", messages: [], willRetry: false });
    listener?.({ type: "agent_settled" });

    const stoppedBeforePersistence = await registry.getSnapshot(requestId, "session-owner");
    expect(stoppedBeforePersistence).toMatchObject({
      state: "ready",
      messages: [
        expect.objectContaining({ role: "user", text: "Earlier" }),
        expect.objectContaining({ role: "assistant", text: "Partial before stop", status: "final" }),
        expect.objectContaining({ role: "user", text: "Start" }),
        expect.objectContaining({ role: "assistant", text: "Partial before stop", status: "stopped" })
      ]
    });
    forkManager!.appendMessage({ role: "user", content: "Start", timestamp: 19 });
    forkManager!.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "Partial before stop" }],
      api: "anthropic-messages",
      provider: "test-provider",
      model: "source-model",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "aborted",
      timestamp: 20
    });
    expect((await registry.getSnapshot(requestId, "session-owner")).messages.filter(
      (message) => message.role === "assistant" && message.text === "Partial before stop"
    ).map((message) => message.status)).toEqual(["final", "stopped"]);
    expect(events).toContainEqual(expect.objectContaining({ type: "lifecycle", state: "stopping" }));
    expect(events).toContainEqual(expect.objectContaining({ type: "lifecycle", state: "stopped" }));
    expect(events).toContainEqual(expect.objectContaining({ type: "message.finished", status: "stopped" }));
    await expect(registry.send(requestId, "session-owner", { clientCommandId: "turn-2", message: "Continue" })).resolves.toMatchObject({ mode: "turn" });
    expect(prompt).toHaveBeenLastCalledWith("Continue", expect.objectContaining({
      expandPromptTemplates: false,
      source: "rpc",
      preflightResult: expect.any(Function)
    }));
    await registry.stop(requestId, "session-owner", { clientCommandId: "stop-before-token" });
    listener?.({ type: "agent_settled" });
    expect(events.slice(-3)).toEqual([
      expect.objectContaining({ type: "lifecycle", state: "stopping" }),
      expect.objectContaining({ type: "lifecycle", state: "stopped" }),
      expect.objectContaining({ type: "lifecycle", state: "ready" })
    ]);
  });

  it("marks retry-exhausted partial output interrupted without starting another turn", async () => {
    const fixture = createSourceFixture();
    let listener: ((event: any) => void) | undefined;
    let forkManager: SessionManager | undefined;
    const prompt = vi.fn(async (_text: string, options: { preflightResult?: (success: boolean) => void }) => {
      options.preflightResult?.(true);
    });
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
          subscribe: (next: (event: any) => void) => {
            listener = next;
            return vi.fn();
          },
          prompt,
          abort: vi.fn(async () => undefined),
          dispose: vi.fn()
        },
        extensionsResult: { extensions: [], errors: [], runtime: undefined }
      }) as unknown as CreateAgentSessionResult;
      })
    });
    const registry = new QuestionChatRuntimeRegistry(adapter);
    const requestId = "ask-interrupted";
    await registry.activate({
      requestId,
      ownerSessionId: "session-owner",
      source: { agentSessionPath: fixture.sourcePath, leafId: fixture.selectedLeafId, cwd: fixture.cwd }
    });
    await registry.send(requestId, "session-owner", { clientCommandId: "turn-error", message: "Try" });
    listener?.({ type: "message_start", message: { role: "assistant", content: [], timestamp: 30 } });
    listener?.({
      type: "message_update",
      message: { role: "assistant", content: [{ type: "text", text: "Partial before failure" }], timestamp: 30 },
      assistantMessageEvent: { type: "text_delta", delta: "Partial before failure" }
    });
    listener?.({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "Partial before failure" }], stopReason: "error", timestamp: 30 }
    });
    forkManager!.appendMessage({ role: "user", content: "Try", timestamp: 29 });
    forkManager!.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "Partial before failure" }],
      api: "anthropic-messages",
      provider: "test-provider",
      model: "source-model",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "error",
      timestamp: 30
    });
    listener?.({ type: "agent_end", messages: [], willRetry: true });
    expect((await registry.getSnapshot(requestId, "session-owner")).state).toBe("generating");
    expect((await registry.getSnapshot(requestId, "session-owner")).messages).not.toContainEqual(
      expect.objectContaining({ status: "interrupted" })
    );

    listener?.({ type: "message_start", message: { role: "assistant", content: [], timestamp: 31 } });
    expect((await registry.getSnapshot(requestId, "session-owner")).messages).toContainEqual(
      expect.objectContaining({ text: "Partial before failure", status: "final" })
    );
    expect((await registry.getSnapshot(requestId, "session-owner")).messages).not.toContainEqual(
      expect.objectContaining({ text: "Partial before failure", status: "interrupted" })
    );
    listener?.({
      type: "message_update",
      message: { role: "assistant", content: [{ type: "text", text: "Partial after retry" }], timestamp: 31 },
      assistantMessageEvent: { type: "text_delta", delta: "Partial after retry" }
    });
    listener?.({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "Partial after retry" }], stopReason: "error", timestamp: 31 }
    });
    forkManager!.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "Partial after retry" }],
      api: "anthropic-messages",
      provider: "test-provider",
      model: "source-model",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "error",
      timestamp: 31
    });
    listener?.({ type: "agent_end", messages: [], willRetry: false });
    listener?.({ type: "agent_settled" });

    expect(await registry.getSnapshot(requestId, "session-owner")).toMatchObject({
      state: "ready",
      messages: [
        expect.objectContaining({ role: "user", text: "Try", status: "final" }),
        expect.objectContaining({ role: "assistant", text: "Partial before failure", status: "final" }),
        expect.objectContaining({ role: "assistant", text: "Partial after retry", status: "interrupted" })
      ]
    });
    expect((await registry.getSnapshot(requestId, "session-owner")).messages.filter((message) => message.status === "interrupted")).toHaveLength(1);
    expect(prompt).toHaveBeenCalledTimes(1);
    await expect(registry.send(requestId, "session-owner", { clientCommandId: "turn-after-error", message: "Retry manually" })).resolves.toMatchObject({ mode: "turn" });
    expect(prompt).toHaveBeenCalledTimes(2);
    listener?.({ type: "message_start", message: { role: "assistant", content: [], timestamp: 32 } });
    listener?.({
      type: "message_update",
      message: { role: "assistant", content: [{ type: "text", text: "Recovered answer" }], timestamp: 32 },
      assistantMessageEvent: { type: "text_delta", delta: "Recovered answer" }
    });
    listener?.({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "Recovered answer" }], stopReason: "stop", timestamp: 32 }
    });
    forkManager!.appendMessage({ role: "user", content: "Retry manually", timestamp: 31 });
    forkManager!.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "Recovered answer" }],
      api: "anthropic-messages",
      provider: "test-provider",
      model: "source-model",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop",
      timestamp: 32
    });
    listener?.({ type: "agent_settled" });
    expect((await registry.getSnapshot(requestId, "session-owner")).messages).toContainEqual(
      expect.objectContaining({ text: "Partial after retry", status: "interrupted" })
    );
  });
});
