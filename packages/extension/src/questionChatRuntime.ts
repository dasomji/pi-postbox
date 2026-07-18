import type { QuestionChatAvailabilityCode, QuestionChatSnapshot, QuestionChatSource } from "../../protocol/src/index.js";
import {
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  createAgentSession,
  getAgentDir,
  type CreateAgentSessionOptions,
  type CreateAgentSessionResult
} from "@earendil-works/pi-coding-agent";
import { createHash } from "node:crypto";
import { constants, copyFileSync, existsSync, mkdirSync, rmSync, chmodSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const INTERVIEWER_SYSTEM_PROMPT =
  "You are the focused interviewer for one pending Postbox Question. Explain the decision without resolving it. Only the human may select, submit, cancel, or otherwise resolve the question.";

export interface QuestionChatActivation {
  requestId: string;
  source: QuestionChatSource;
}

interface SessionLifecycle {
  model?: { provider: string; id: string };
  abort(): Promise<void>;
  dispose(): void;
}

export interface QuestionChatRuntime {
  readonly snapshot: QuestionChatSnapshot;
  terminate(): Promise<void>;
}

export interface PiQuestionChatRuntimeAdapterOptions {
  privateRoot?: string;
  agentDir?: string;
  createAgentSession?: (options: CreateAgentSessionOptions) => Promise<CreateAgentSessionResult>;
  createModelRuntime?: () => Promise<ModelRuntime>;
}

export class QuestionChatRuntimeError extends Error {
  constructor(
    public readonly code: Extract<
      QuestionChatAvailabilityCode,
      "source_path_missing" | "source_leaf_missing" | "runtime_failure"
    >,
    message: string
  ) {
    super(message);
    this.name = "QuestionChatRuntimeError";
  }
}

export class PiQuestionChatRuntimeAdapter {
  private readonly privateRoot: string;
  private readonly agentDir: string;
  private readonly createSession: (options: CreateAgentSessionOptions) => Promise<CreateAgentSessionResult>;
  private readonly createModelRuntime: () => Promise<ModelRuntime>;

  constructor(options: PiQuestionChatRuntimeAdapterOptions = {}) {
    this.privateRoot = resolve(options.privateRoot ?? join(getAgentDir(), "postbox", "question-chats"));
    this.agentDir = resolve(options.agentDir ?? getAgentDir());
    this.createSession = options.createAgentSession ?? createAgentSession;
    this.createModelRuntime =
      options.createModelRuntime ??
      (() =>
        ModelRuntime.create({
          authPath: join(this.agentDir, "auth.json"),
          modelsPath: join(this.agentDir, "models.json"),
          allowModelNetwork: false
        }));
  }

  async create(input: QuestionChatActivation): Promise<QuestionChatRuntime> {
    this.assertSourceFile(input.source.agentSessionPath);
    const runtimeDir = this.runtimeDirectory(input.requestId);
    let session: SessionLifecycle | undefined;

    try {
      mkdirSync(this.privateRoot, { recursive: true, mode: 0o700 });
      chmodSync(this.privateRoot, 0o700);
      mkdirSync(runtimeDir, { recursive: false, mode: 0o700 });
      chmodSync(runtimeDir, 0o700);

      // Pi 0.80.10 may migrate an opened session in place. Open a private byte
      // snapshot so even older source sessions remain immutable.
      const sourceSnapshotPath = join(runtimeDir, "source-snapshot.jsonl");
      copyFileSync(input.source.agentSessionPath, sourceSnapshotPath, constants.COPYFILE_EXCL);
      chmodSync(sourceSnapshotPath, 0o600);

      const sessionManager = SessionManager.open(sourceSnapshotPath, runtimeDir, input.source.cwd);
      if (!sessionManager.getEntry(input.source.leafId)) {
        throw new QuestionChatRuntimeError("source_leaf_missing", "The recorded source leaf no longer exists.");
      }
      const forkPath = sessionManager.createBranchedSession(input.source.leafId);
      if (!forkPath) throw new QuestionChatRuntimeError("runtime_failure", "Pi did not create a persistent private fork.");

      const recordedModel = sessionManager.buildSessionContext().model;
      const settingsManager = SettingsManager.create(input.source.cwd, this.agentDir, { projectTrusted: false });
      const resourceLoader = new DefaultResourceLoader({
        cwd: input.source.cwd,
        agentDir: this.agentDir,
        settingsManager,
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        systemPrompt: INTERVIEWER_SYSTEM_PROMPT,
        appendSystemPrompt: []
      });
      await resourceLoader.reload();

      const result = await this.createSession({
        cwd: input.source.cwd,
        agentDir: this.agentDir,
        sessionManager,
        settingsManager,
        resourceLoader,
        modelRuntime: await this.createModelRuntime(),
        tools: []
      });
      session = result.session;
      const selectedModel = session.model;
      if (!selectedModel) {
        throw new QuestionChatRuntimeError("runtime_failure", "No authenticated Pi model is available for Question Chat.");
      }

      const selectedModelId = `${selectedModel.provider}/${selectedModel.id}`;
      const recordedModelId = recordedModel ? `${recordedModel.provider}/${recordedModel.modelId}` : undefined;
      const isOriginatingModel = recordedModelId === selectedModelId;
      const fallbackReason = isOriginatingModel
        ? undefined
        : result.modelFallbackMessage ??
          (recordedModelId
            ? `Originating model ${recordedModelId} is unavailable; using Pi default ${selectedModelId}.`
            : `No originating model was recorded; using Pi default ${selectedModelId}.`);

      const privateForkPath = sessionManager.getSessionFile();
      if (privateForkPath && existsSync(privateForkPath)) chmodSync(privateForkPath, 0o600);

      const snapshot: QuestionChatSnapshot = {
        requestId: input.requestId,
        state: "ready",
        forkKind: "exact",
        model: {
          id: selectedModelId,
          source: isOriginatingModel ? "originating" : "pi-default",
          fallbackReason
        },
        messages: []
      };
      return new ManagedQuestionChatRuntime(snapshot, session, runtimeDir, this.privateRoot);
    } catch (error) {
      if (session) {
        try {
          await session.abort();
        } finally {
          session.dispose();
        }
      }
      this.removeRuntimeDirectory(runtimeDir);
      if (error instanceof QuestionChatRuntimeError) throw error;
      throw new QuestionChatRuntimeError(
        "runtime_failure",
        error instanceof Error ? `Question Chat runtime failed: ${error.message}` : "Question Chat runtime failed."
      );
    }
  }

  private assertSourceFile(sourcePath: string): void {
    try {
      if (!statSync(sourcePath).isFile()) throw new Error("not a file");
    } catch {
      throw new QuestionChatRuntimeError("source_path_missing", "The originating Pi session file is unavailable.");
    }
  }

  private runtimeDirectory(requestId: string): string {
    const key = createHash("sha256").update(requestId).digest("hex");
    return join(this.privateRoot, key);
  }

  private removeRuntimeDirectory(runtimeDir: string): void {
    assertContained(this.privateRoot, runtimeDir);
    rmSync(runtimeDir, { recursive: true, force: true });
  }
}

class ManagedQuestionChatRuntime implements QuestionChatRuntime {
  private terminated = false;

  constructor(
    readonly snapshot: QuestionChatSnapshot,
    private readonly session: SessionLifecycle,
    private readonly runtimeDir: string,
    private readonly privateRoot: string
  ) {}

  async terminate(): Promise<void> {
    if (this.terminated) return;
    this.terminated = true;
    try {
      await this.session.abort();
    } finally {
      this.session.dispose();
      assertContained(this.privateRoot, this.runtimeDir);
      rmSync(this.runtimeDir, { recursive: true, force: true });
    }
  }
}

export class QuestionChatRuntimeRegistry {
  private readonly runtimes = new Map<string, Promise<QuestionChatRuntime>>();
  private readonly terminations = new Map<string, Promise<void>>();

  constructor(private readonly adapter: Pick<PiQuestionChatRuntimeAdapter, "create">) {}

  async activate(input: QuestionChatActivation): Promise<QuestionChatSnapshot> {
    let runtime = this.runtimes.get(input.requestId);
    if (!runtime) {
      runtime = this.adapter.create(input);
      this.runtimes.set(input.requestId, runtime);
      void runtime.catch(() => {
        if (this.runtimes.get(input.requestId) === runtime) this.runtimes.delete(input.requestId);
      });
    }
    return (await runtime).snapshot;
  }

  async cleanup(requestId: string): Promise<void> {
    const existingTermination = this.terminations.get(requestId);
    if (existingTermination) return existingTermination;
    const runtime = this.runtimes.get(requestId);
    if (!runtime) return;
    this.runtimes.delete(requestId);
    const termination = (async () => {
      try {
        await (await runtime).terminate();
      } catch (error) {
        if (!(error instanceof QuestionChatRuntimeError)) throw error;
      }
    })();
    this.terminations.set(requestId, termination);
    try {
      await termination;
    } finally {
      if (this.terminations.get(requestId) === termination) this.terminations.delete(requestId);
    }
  }

  async cleanupAll(): Promise<void> {
    await Promise.all([
      ...this.terminations.values(),
      ...[...this.runtimes.keys()].map((requestId) => this.cleanup(requestId))
    ]);
  }
}

function assertContained(root: string, candidate: string): void {
  const relation = relative(resolve(root), resolve(candidate));
  if (!relation || relation.startsWith("..") || relation.includes("/../")) {
    throw new Error("Question Chat runtime path escaped its private root");
  }
}
