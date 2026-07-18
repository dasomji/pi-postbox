import {
  QUESTION_CHAT_ASSISTANT_TEXT_MAX,
  QUESTION_CHAT_DELTA_MAX,
  QUESTION_CHAT_TOOL_ACTIVITY_MAX,
  QUESTION_CHAT_TOOL_DETAILS_MAX,
  QUESTION_CHAT_TOOL_TARGET_MAX,
  QuestionChatContextSourceSchema,
  QuestionChatEventSchema,
  QuestionChatSendPayloadSchema,
  QuestionChatStopPayloadSchema,
  type QuestionChatAvailabilityCode,
  type QuestionChatEvent,
  type QuestionChatMessage,
  type QuestionChatContextSource,
  type QuestionChatSendPayload,
  type QuestionChatSendResponse,
  type QuestionChatSnapshot,
  type QuestionChatSource,
  type QuestionChatState,
  type QuestionChatStopPayload,
  type QuestionChatStopResponse,
  type QuestionChatToolActivity
} from "../../protocol/src/index.js";
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
import { createHash, randomUUID } from "node:crypto";
import {
  constants,
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  type Dirent,
  writeFileSync
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";
import {
  REPOSITORY_EVIDENCE_TOOL_NAMES,
  createRepositoryEvidenceTools,
  isRepositoryEvidenceRestrictedPath
} from "./repositoryEvidenceTools.js";

const INTERVIEWER_SYSTEM_PROMPT =
  "You are the focused interviewer for one pending Postbox Question. Explain the decision without resolving it. Only the human may select, submit, cancel, or otherwise resolve the question. Repository evidence is available only through the scoped repository_read, repository_grep, repository_find, and repository_list tools. Never claim shell or mutation capability.";
const DISABLED_BUILTIN_TOOLS = ["read", "grep", "find", "ls", "bash", "edit", "write"];

export interface QuestionChatActivation {
  requestId: string;
  ownerSessionId: string;
  source: QuestionChatSource;
}

export interface QuestionChatContextActivation {
  requestId: string;
  ownerSessionId: string;
  source: QuestionChatContextSource;
}

interface SessionLifecycle {
  model?: { provider: string; id: string };
  isStreaming?: boolean;
  state?: { streamingMessage?: unknown };
  subscribe?(listener: (event: unknown) => void): () => void;
  prompt?(
    text: string,
    options: {
      expandPromptTemplates: false;
      source: "rpc";
      streamingBehavior?: "steer";
      preflightResult?: (success: boolean) => void;
    }
  ): Promise<void>;
  abort(): Promise<void>;
  dispose(): void;
}

export interface QuestionChatRuntime {
  readonly snapshot: QuestionChatSnapshot;
  send(command: QuestionChatSendPayload): Promise<QuestionChatSendResponse>;
  stop(command: QuestionChatStopPayload): Promise<QuestionChatStopResponse>;
  subscribe(listener: (event: QuestionChatEvent) => void): () => void;
  suspend(): Promise<void>;
  terminate(): Promise<void>;
}

export interface QuestionChatRecoveryOffer {
  requestId: string;
  ownerSessionId: string;
  forkKind: "exact" | "context-only";
}

export interface QuestionChatReconciliationDecision {
  requestId: string;
  forkKind: "exact" | "context-only";
  action: "recover" | "delete";
}

export type QuestionChatReconciliationResult =
  | { status: "recovered"; snapshot: QuestionChatSnapshot }
  | { status: "deleted"; requestId: string }
  | { status: "failed"; requestId: string; message: string };

type RuntimeEventInput = QuestionChatEvent extends infer Event
  ? Event extends QuestionChatEvent
    ? Omit<Event, "requestId" | "sequence">
    : never
  : never;

export interface PiQuestionChatRuntimeAdapterOptions {
  privateRoot?: string;
  agentDir?: string;
  createAgentSession?: (options: CreateAgentSessionOptions) => Promise<CreateAgentSessionResult>;
  createModelRuntime?: () => Promise<ModelRuntime>;
}

const RecoveryManifestSchema = z.object({
  version: z.literal(1),
  requestId: z.string().min(1).max(200),
  ownerSessionId: z.string().min(1).max(200),
  forkKind: z.enum(["exact", "context-only"]),
  cwd: z.string().min(1).max(4_000),
  privateSessionPath: z.string().min(1).max(4_000),
  chatBoundaryId: z.string().min(1).max(400).nullable(),
  sequence: z.number().int().nonnegative(),
  model: z.object({
    id: z.string().min(1).max(400),
    source: z.enum(["originating", "pi-default"]),
    fallbackReason: z.string().max(2_000).optional()
  }),
  contextSource: QuestionChatContextSourceSchema.optional()
});

type RecoveryManifest = z.infer<typeof RecoveryManifestSchema>;
const RECOVERY_MANIFEST = "manifest.json";
const RECOVERY_HASH = /^[a-f0-9]{64}$/;

export class QuestionChatRuntimeError extends Error {
  constructor(
    public readonly code: Extract<
      QuestionChatAvailabilityCode,
      "source_path_missing" | "source_leaf_missing" | "runtime_failure" | "runtime_busy"
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
    return this.createPrivateRuntime(input.requestId, input.ownerSessionId, "exact", undefined, (runtimeDir) => {
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
      return {
        cwd: input.source.cwd,
        sessionManager,
        systemPrompt: INTERVIEWER_SYSTEM_PROMPT,
        recordedModelId: recordedModel ? `${recordedModel.provider}/${recordedModel.modelId}` : undefined
      };
    });
  }

  async createContext(input: QuestionChatContextActivation): Promise<QuestionChatRuntime> {
    return this.createPrivateRuntime(input.requestId, input.ownerSessionId, "context-only", input.source, (runtimeDir) => ({
      cwd: input.source.cwd,
      sessionManager: SessionManager.create(input.source.cwd, runtimeDir),
      systemPrompt: contextOnlySystemPrompt(input.source),
      recordedModelId: input.source.model,
      explicitModelId: input.source.model
    }));
  }

  private async createPrivateRuntime(
    requestId: string,
    ownerSessionId: string,
    forkKind: QuestionChatSnapshot["forkKind"],
    contextSource: QuestionChatContextSource | undefined,
    prepare: (runtimeDir: string) => {
      cwd: string;
      sessionManager: SessionManager;
      systemPrompt: string;
      recordedModelId?: string;
      explicitModelId?: string;
    }
  ): Promise<QuestionChatRuntime> {
    const runtimeDir = this.runtimeDirectory(requestId);
    let session: SessionLifecycle | undefined;

    try {
      mkdirSync(this.privateRoot, { recursive: true, mode: 0o700 });
      this.assertPrivateRoot();
      mkdirSync(runtimeDir, { recursive: false, mode: 0o700 });
      this.validateRuntimeDirectory(runtimeDir);

      const prepared = prepare(runtimeDir);
      const settingsManager = SettingsManager.create(prepared.cwd, this.agentDir, { projectTrusted: false });
      const resourceLoader = new DefaultResourceLoader({
        cwd: prepared.cwd,
        agentDir: this.agentDir,
        settingsManager,
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        systemPrompt: prepared.systemPrompt,
        appendSystemPrompt: []
      });
      await resourceLoader.reload();
      const evidence = await createRepositoryEvidenceTools(prepared.cwd);

      const modelRuntime = await this.createModelRuntime();
      const explicitModel = resolveRecordedModel(prepared.explicitModelId, modelRuntime);
      const result = await this.createSession({
        cwd: prepared.cwd,
        agentDir: this.agentDir,
        sessionManager: prepared.sessionManager,
        settingsManager,
        resourceLoader,
        modelRuntime,
        ...(explicitModel ? { model: explicitModel } : {}),
        tools: [...REPOSITORY_EVIDENCE_TOOL_NAMES],
        customTools: evidence.tools,
        excludeTools: DISABLED_BUILTIN_TOOLS
      });
      session = result.session;
      const selectedModel = session.model;
      if (!selectedModel) {
        throw new QuestionChatRuntimeError("runtime_failure", "No authenticated Pi model is available for Question Chat.");
      }

      const selectedModelId = `${selectedModel.provider}/${selectedModel.id}`;
      const isOriginatingModel = Boolean(
        prepared.recordedModelId === selectedModelId && (!prepared.explicitModelId || explicitModel)
      );
      const fallbackReason = isOriginatingModel
        ? undefined
        : result.modelFallbackMessage ??
          (prepared.recordedModelId
            ? `Originating model ${prepared.recordedModelId} is unavailable; using Pi default ${selectedModelId}.`
            : `No originating model was recorded; using Pi default ${selectedModelId}.`);

      const privateSessionPath = prepared.sessionManager.getSessionFile();
      if (privateSessionPath && existsSync(privateSessionPath)) chmodSync(privateSessionPath, 0o600);
      const snapshot: QuestionChatSnapshot = {
        requestId,
        state: "ready",
        forkKind,
        model: {
          id: selectedModelId,
          source: isOriginatingModel ? "originating" : "pi-default",
          fallbackReason
        },
        sequence: 0,
        messages: [],
        tools: []
      };
      if (!privateSessionPath) throw new QuestionChatRuntimeError("runtime_failure", "Pi did not persist the private Question Chat fork.");
      const manifest: RecoveryManifest = {
        version: 1,
        requestId,
        ownerSessionId,
        forkKind,
        cwd: prepared.cwd,
        privateSessionPath,
        chatBoundaryId: prepared.sessionManager.getLeafId(),
        sequence: 0,
        model: snapshot.model,
        ...(contextSource ? { contextSource } : {})
      };
      this.writeManifest(runtimeDir, manifest);
      return new ManagedQuestionChatRuntime(
        snapshot,
        session,
        prepared.sessionManager,
        manifest.chatBoundaryId,
        runtimeDir,
        this.privateRoot,
        (sequence) => this.writeManifest(runtimeDir, { ...manifest, sequence })
      );
    } catch (error) {
      if (session) {
        try {
          await session.abort();
        } finally {
          session.dispose();
        }
      }
      try {
        this.removeRuntimeDirectory(runtimeDir);
      } catch {
        // Never follow an unsafe path while handling the original failure.
      }
      if (error instanceof QuestionChatRuntimeError) throw error;
      throw new QuestionChatRuntimeError(
        "runtime_failure",
        error instanceof Error ? `Question Chat runtime failed: ${error.message}` : "Question Chat runtime failed."
      );
    }
  }

  listRecoveryOffers(): QuestionChatRecoveryOffer[] {
    let entries: Dirent[];
    try {
      if (!existsSync(this.privateRoot)) return [];
      this.assertPrivateRoot();
      entries = readdirSync(this.privateRoot, { withFileTypes: true });
    } catch (error) {
      if (isMissingPathError(error)) return [];
      throw error;
    }
    const offers: QuestionChatRecoveryOffer[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !RECOVERY_HASH.test(entry.name)) continue;
      const runtimeDir = join(this.privateRoot, entry.name);
      try {
        const manifest = this.readManifest(runtimeDir);
        this.validatePrivateSessionPath(runtimeDir, manifest.privateSessionPath);
        offers.push({ requestId: manifest.requestId, ownerSessionId: manifest.ownerSessionId, forkKind: manifest.forkKind });
      } catch {
        try {
          this.removeValidatedRuntimeDirectory(runtimeDir);
        } catch (error) {
          if (!isMissingPathError(error)) throw error;
        }
      }
    }
    return offers.sort((left, right) => left.requestId.localeCompare(right.requestId));
  }

  async recover(ownerSessionId: string, requestId: string, forkKind: QuestionChatSnapshot["forkKind"]): Promise<QuestionChatRuntime> {
    const runtimeDir = this.runtimeDirectory(requestId);
    const manifest = this.readManifest(runtimeDir);
    if (manifest.ownerSessionId !== ownerSessionId || manifest.forkKind !== forkKind) {
      throw new QuestionChatRuntimeError("runtime_failure", "Question Chat recovery metadata does not match the registered owner and fork kind.");
    }
    const privateSessionPath = this.validatePrivateSessionPath(runtimeDir, manifest.privateSessionPath);
    let sessionManager: SessionManager;
    try {
      sessionManager = SessionManager.open(privateSessionPath, runtimeDir, manifest.cwd);
      if (manifest.chatBoundaryId && !sessionManager.getEntry(manifest.chatBoundaryId)) {
        throw new Error("Question Chat transcript boundary is unavailable.");
      }
    } catch (error) {
      this.removeValidatedRuntimeDirectory(runtimeDir);
      throw new QuestionChatRuntimeError(
        "runtime_failure",
        error instanceof Error ? error.message : "Question Chat recovery metadata is structurally invalid."
      );
    }
    let session: SessionLifecycle | undefined;
    try {
      const settingsManager = SettingsManager.create(manifest.cwd, this.agentDir, { projectTrusted: false });
      const resourceLoader = new DefaultResourceLoader({
        cwd: manifest.cwd,
        agentDir: this.agentDir,
        settingsManager,
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        systemPrompt: manifest.contextSource ? contextOnlySystemPrompt(manifest.contextSource) : INTERVIEWER_SYSTEM_PROMPT,
        appendSystemPrompt: []
      });
      await resourceLoader.reload();
      const evidence = await createRepositoryEvidenceTools(manifest.cwd);
      const modelRuntime = await this.createModelRuntime();
      const explicitModel = resolveRecordedModel(manifest.model.id, modelRuntime);
      const result = await this.createSession({
        cwd: manifest.cwd,
        agentDir: this.agentDir,
        sessionManager,
        settingsManager,
        resourceLoader,
        modelRuntime,
        ...(explicitModel ? { model: explicitModel } : {}),
        tools: [...REPOSITORY_EVIDENCE_TOOL_NAMES],
        customTools: evidence.tools,
        excludeTools: DISABLED_BUILTIN_TOOLS
      });
      session = result.session;
      const selectedModel = session.model;
      if (!selectedModel) throw new QuestionChatRuntimeError("runtime_failure", "No authenticated Pi model is available for Question Chat.");
      const selectedModelId = `${selectedModel.provider}/${selectedModel.id}`;
      const model = selectedModelId === manifest.model.id
        ? manifest.model
        : {
            id: selectedModelId,
            source: "pi-default" as const,
            fallbackReason: result.modelFallbackMessage ?? `Recovered model ${manifest.model.id} is unavailable; using Pi default ${selectedModelId}.`
          };
      const durableManifest: RecoveryManifest = { ...manifest, privateSessionPath, model };
      this.writeManifest(runtimeDir, durableManifest);
      return new ManagedQuestionChatRuntime(
        { requestId, state: "ready", forkKind, model, sequence: manifest.sequence, messages: [], tools: [] },
        session,
        sessionManager,
        manifest.chatBoundaryId,
        runtimeDir,
        this.privateRoot,
        (sequence) => this.writeManifest(runtimeDir, { ...durableManifest, sequence })
      );
    } catch (error) {
      if (session) {
        try {
          await session.abort();
        } finally {
          session.dispose();
        }
      }
      if (error instanceof QuestionChatRuntimeError) throw error;
      throw new QuestionChatRuntimeError("runtime_failure", error instanceof Error ? error.message : "Question Chat recovery failed.");
    }
  }

  discard(requestId: string): void {
    const runtimeDir = this.runtimeDirectory(requestId);
    try {
      if (!existsSync(runtimeDir)) return;
      this.removeValidatedRuntimeDirectory(runtimeDir);
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
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

  private assertPrivateRoot(): void {
    const configuredRootStat = lstatSync(this.privateRoot);
    if (!configuredRootStat.isDirectory() || configuredRootStat.isSymbolicLink()) {
      throw new Error("Question Chat private root is not a real directory");
    }
    const root = realpathSync(this.privateRoot);
    if (!statSync(root).isDirectory()) throw new Error("Question Chat private root is not a directory");
    chmodSync(root, 0o700);
  }

  private readManifest(runtimeDir: string): RecoveryManifest {
    this.validateRuntimeDirectory(runtimeDir);
    const manifestPath = join(runtimeDir, RECOVERY_MANIFEST);
    const manifestStat = lstatSync(manifestPath);
    if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) throw new Error("Question Chat recovery manifest is not a regular file");
    const manifest = RecoveryManifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8")));
    if (this.runtimeDirectory(manifest.requestId) !== runtimeDir) throw new Error("Question Chat recovery directory key does not match its request");
    if (manifest.forkKind === "context-only" && !manifest.contextSource) throw new Error("Context-only Question Chat recovery metadata is incomplete");
    if (manifest.forkKind === "exact" && manifest.contextSource) throw new Error("Exact Question Chat recovery metadata has the wrong fork kind");
    if (!isAbsolute(manifest.cwd) || !statSync(realpathSync(manifest.cwd)).isDirectory()) {
      throw new Error("Question Chat recovery working directory is unavailable");
    }
    return manifest;
  }

  private writeManifest(runtimeDir: string, manifest: RecoveryManifest): void {
    RecoveryManifestSchema.parse(manifest);
    this.validateRuntimeDirectory(runtimeDir);
    const path = join(runtimeDir, RECOVERY_MANIFEST);
    const temporary = join(runtimeDir, `${RECOVERY_MANIFEST}.next-${randomUUID()}`);
    writeFileSync(temporary, `${JSON.stringify(manifest)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    chmodSync(temporary, 0o600);
    renameSync(temporary, path);
    chmodSync(path, 0o600);
  }

  private validateRuntimeDirectory(runtimeDir: string): void {
    this.assertPrivateRoot();
    if (!RECOVERY_HASH.test(runtimeDir.slice(runtimeDir.lastIndexOf("/") + 1))) throw new Error("Invalid Question Chat recovery directory key");
    const configuredRuntimeStat = lstatSync(runtimeDir);
    if (!configuredRuntimeStat.isDirectory() || configuredRuntimeStat.isSymbolicLink()) {
      throw new Error("Question Chat recovery path is not a private directory");
    }
    const runtimeReal = realpathSync(runtimeDir);
    assertContained(this.privateRoot, runtimeReal);
    const runtimeStat = lstatSync(runtimeReal);
    if (!runtimeStat.isDirectory() || runtimeStat.isSymbolicLink()) throw new Error("Question Chat recovery path is not a private directory");
    chmodSync(runtimeReal, 0o700);
  }

  private validatePrivateSessionPath(runtimeDir: string, privateSessionPath: string): string {
    if (!isAbsolute(privateSessionPath)) throw new Error("Question Chat private session path must be absolute");
    const configuredSessionStat = lstatSync(privateSessionPath);
    if (!configuredSessionStat.isFile() || configuredSessionStat.isSymbolicLink()) {
      throw new Error("Question Chat private session is not a regular file");
    }
    const sessionReal = realpathSync(privateSessionPath);
    assertContained(runtimeDir, sessionReal);
    const sessionStat = lstatSync(sessionReal);
    if (!sessionStat.isFile() || sessionStat.isSymbolicLink()) throw new Error("Question Chat private session is not a regular file");
    chmodSync(sessionReal, 0o600);
    return sessionReal;
  }

  private removeValidatedRuntimeDirectory(runtimeDir: string): void {
    this.validateRuntimeDirectory(runtimeDir);
    rmSync(runtimeDir, { recursive: true, force: true });
  }

  private removeRuntimeDirectory(runtimeDir: string): void {
    if (!existsSync(runtimeDir)) return;
    this.removeValidatedRuntimeDirectory(runtimeDir);
  }
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

class ManagedQuestionChatRuntime implements QuestionChatRuntime {
  private terminated = false;
  private sequence: number;
  private state: QuestionChatState = "ready";
  private readonly listeners = new Set<(event: QuestionChatEvent) => void>();
  private readonly unsubscribeSession: (() => void) | undefined;
  private streamingAssistant: Extract<QuestionChatMessage, { role: "assistant" }> | undefined;
  private transientMessages: Array<{ message: QuestionChatMessage; forkOccurrencesAtCreation: number }> = [];
  private pendingErrorMessage: Extract<QuestionChatMessage, { role: "assistant" }> | undefined;
  private awaitingRetry = false;
  private stopRequested = false;
  private stopOutcomeEmitted = false;
  private promptStarting = false;
  private sdkActive = false;
  private readonly forkOutcomes = new Map<string, "final" | "stopped" | "interrupted">();
  private readonly liveToolActivities = new Map<string, QuestionChatToolActivity>();

  constructor(
    private readonly initialSnapshot: QuestionChatSnapshot,
    private readonly session: SessionLifecycle,
    private readonly sessionManager: SessionManager,
    private readonly chatBoundaryId: string | null,
    private readonly runtimeDir: string,
    private readonly privateRoot: string,
    private readonly persistSequence: (sequence: number) => void
  ) {
    this.sequence = initialSnapshot.sequence;
    this.unsubscribeSession = this.session.subscribe?.((event) => this.onSessionEvent(event));
  }

  get snapshot(): QuestionChatSnapshot {
    const messages = this.finalizedMessagesFromFork();
    this.transientMessages = this.transientMessages.filter(({ message, forkOccurrencesAtCreation }) =>
      countMatchingMessages(messages, message) <= forkOccurrencesAtCreation
    );
    messages.push(...this.transientMessages.map(({ message }) => message));
    if (this.streamingAssistant) messages.push(this.streamingAssistant);
    const tools = this.toolActivitiesFromFork();
    for (const activity of this.liveToolActivities.values()) {
      const existing = tools.findIndex((candidate) => candidate.id === activity.id);
      if (existing >= 0) tools[existing] = activity;
      else tools.push(activity);
    }
    return {
      ...this.initialSnapshot,
      state: this.state,
      sequence: this.sequence,
      messages: messages.slice(-100),
      tools: tools.slice(-QUESTION_CHAT_TOOL_ACTIVITY_MAX)
    };
  }

  async send(command: QuestionChatSendPayload): Promise<QuestionChatSendResponse> {
    const input = QuestionChatSendPayloadSchema.parse(command);
    if (this.terminated) throw new QuestionChatRuntimeError("runtime_failure", "Question Chat has terminated.");
    if (this.promptStarting || this.state === "stopping" || this.state === "stopped" || this.state === "interrupted") {
      throw new QuestionChatRuntimeError("runtime_busy", "Question Chat is not ready for another message.");
    }
    if (!this.session.prompt) throw new QuestionChatRuntimeError("runtime_failure", "Question Chat cannot accept prompts.");
    const mode = this.state === "generating" && (this.sdkActive || Boolean(this.session.isStreaming)) ? "steer" : "prompt";
    if (this.state === "generating" && mode !== "steer") {
      throw new QuestionChatRuntimeError("runtime_busy", "Question Chat is still starting its response.");
    }

    const userMessage: QuestionChatMessage = {
      id: input.clientCommandId,
      role: "user",
      text: input.message,
      status: "final"
    };
    this.promptStarting = true;
    const prompt = this.startPrompt(input.message, mode === "steer" ? "steer" : undefined);
    try {
      await prompt.accepted;
    } catch (error) {
      void prompt.completion.catch(() => undefined);
      throw error;
    } finally {
      this.promptStarting = false;
    }

    this.transientMessages.push({
      message: userMessage,
      forkOccurrencesAtCreation: countMatchingMessages(this.finalizedMessagesFromFork(), userMessage)
    });
    this.emit({
      type: "message.started",
      message: userMessage
    });
    if (mode === "prompt") {
      this.sdkActive = true;
      this.emit({ type: "lifecycle", state: "generating" });
      void prompt.completion.catch(() => {
        if (!this.terminated && this.state !== "ready") {
          this.sdkActive = false;
          this.emit({ type: "lifecycle", state: "interrupted" });
          this.emit({ type: "lifecycle", state: "ready" });
        }
      });
    } else {
      // Accepted steering completes with the active run; terminal outcomes are
      // normalized from SDK events rather than changing lifecycle here.
      void prompt.completion.catch(() => undefined);
    }
    return { status: "accepted", clientCommandId: input.clientCommandId, mode };
  }

  async stop(command: QuestionChatStopPayload): Promise<QuestionChatStopResponse> {
    const input = QuestionChatStopPayloadSchema.parse(command);
    if (this.terminated) throw new QuestionChatRuntimeError("runtime_failure", "Question Chat has terminated.");
    if (this.promptStarting || this.state === "stopping") {
      throw new QuestionChatRuntimeError("runtime_busy", "Question Chat is already starting or stopping a response.");
    }
    if (this.state !== "generating" || (!this.sdkActive && !this.session.isStreaming)) {
      throw new QuestionChatRuntimeError("runtime_busy", "Question Chat has no active response to stop.");
    }
    this.stopRequested = true;
    this.stopOutcomeEmitted = false;
    this.emit({ type: "lifecycle", state: "stopping" });
    try {
      await this.session.abort();
    } catch (error) {
      this.stopRequested = false;
      this.emit({ type: "lifecycle", state: "generating" });
      throw error;
    }
    return { status: "accepted", clientCommandId: input.clientCommandId };
  }

  subscribe(listener: (event: QuestionChatEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private startPrompt(
    text: string,
    streamingBehavior: "steer" | undefined
  ): { accepted: Promise<void>; completion: Promise<void> } {
    let notified = false;
    let accept!: () => void;
    let reject!: (error: unknown) => void;
    const accepted = new Promise<void>((resolve, rejectPromise) => {
      accept = resolve;
      reject = rejectPromise;
    });
    const completion = this.session.prompt!(text, {
      expandPromptTemplates: false,
      source: "rpc",
      ...(streamingBehavior ? { streamingBehavior } : {}),
      preflightResult: (success) => {
        if (notified) return;
        notified = true;
        if (success) accept();
        else reject(new QuestionChatRuntimeError("runtime_failure", "Pi rejected the Question Chat prompt before acceptance."));
      }
    });
    void completion.then(
      () => {
        if (!notified) reject(new QuestionChatRuntimeError("runtime_failure", "Pi completed without reporting prompt acceptance."));
      },
      (error) => {
        if (!notified) reject(error);
      }
    );
    return { accepted, completion };
  }

  private onSessionEvent(value: unknown): void {
    try {
      if (!isRecord(value) || typeof value.type !== "string") return;
      if (value.type === "tool_execution_start") {
        if (!isRepositoryEvidenceTool(value.toolName) || typeof value.toolCallId !== "string") return;
        const activity: QuestionChatToolActivity = {
          id: sanitizeToolId(value.toolCallId),
          tool: value.toolName,
          target: sanitizeToolTarget(value.args),
          state: "running",
          ...sanitizeToolArguments(value.toolName, value.args)
        };
        this.liveToolActivities.set(value.toolCallId, activity);
        this.emit({ type: "tool.started", activity });
        return;
      }
      if (value.type === "tool_execution_end") {
        if (!isRepositoryEvidenceTool(value.toolName) || typeof value.toolCallId !== "string") return;
        const started = this.liveToolActivities.get(value.toolCallId);
        if (!started) return;
        const details = sanitizeToolResult(value.result);
        const activity = value.isError === true
          ? { ...started, state: "error" as const, ...(details ? { details } : {}) }
          : { ...started, state: "success" as const, ...(details ? { details } : {}) };
        this.liveToolActivities.set(value.toolCallId, activity);
        this.emit({ type: "tool.finished", activity });
        return;
      }
      if (value.type === "agent_start") {
        if (this.promptStarting) return;
        if (this.state !== "generating" && this.state !== "stopping") this.emit({ type: "lifecycle", state: "generating" });
        return;
      }
      if (value.type === "agent_settled") {
        if (this.stopRequested && !this.stopOutcomeEmitted) {
          if (this.streamingAssistant) {
            const partial = this.streamingAssistant;
            this.streamingAssistant = undefined;
            this.finishAssistant(partial, "stopped", true);
          }
          this.emit({ type: "lifecycle", state: "stopped" });
          this.stopOutcomeEmitted = true;
        }
        void this.snapshot;
        this.pendingErrorMessage = undefined;
        this.awaitingRetry = false;
        this.stopRequested = false;
        this.stopOutcomeEmitted = false;
        this.sdkActive = false;
        if (this.state !== "ready") this.emit({ type: "lifecycle", state: "ready" });
        return;
      }
      if (value.type === "agent_end") {
        if (!this.pendingErrorMessage) return;
        const pendingErrorMessage = this.pendingErrorMessage;
        this.pendingErrorMessage = undefined;
        if (value.willRetry === true) {
          this.awaitingRetry = true;
          this.finishAssistant(pendingErrorMessage, "final", true);
        } else {
          this.awaitingRetry = false;
          this.finishAssistant(pendingErrorMessage, "interrupted", true);
          this.emit({ type: "lifecycle", state: "interrupted" });
        }
        return;
      }
      if (value.type === "message_start" && isAssistantMessage(value.message)) {
        const id = assistantMessageId(value.message, this.sequence + 1);
        this.streamingAssistant = { id, role: "assistant", text: "", status: "streaming" };
        this.emit({ type: "message.started", message: this.streamingAssistant });
        return;
      }
      if (value.type === "message_update" && this.streamingAssistant && isRecord(value.assistantMessageEvent)) {
        const update = value.assistantMessageEvent;
        if (update.type !== "text_delta" || typeof update.delta !== "string" || !update.delta) return;
        const remaining = QUESTION_CHAT_ASSISTANT_TEXT_MAX - this.streamingAssistant.text.length;
        const visibleDelta = update.delta.slice(0, Math.max(0, remaining));
        for (let offset = 0; offset < visibleDelta.length; offset += QUESTION_CHAT_DELTA_MAX) {
          const text = visibleDelta.slice(offset, offset + QUESTION_CHAT_DELTA_MAX);
          this.streamingAssistant = {
            ...this.streamingAssistant,
            text: this.streamingAssistant.text + text
          };
          this.emit({ type: "assistant.text.delta", messageId: this.streamingAssistant.id, text });
        }
        return;
      }
      if (value.type === "message_end" && this.streamingAssistant && isAssistantMessage(value.message)) {
        const text = visibleAssistantText(value.message).slice(0, QUESTION_CHAT_ASSISTANT_TEXT_MAX);
        const messageId = this.streamingAssistant.id;
        const message: Extract<QuestionChatMessage, { role: "assistant" }> = {
          id: messageId,
          role: "assistant",
          text,
          status: "final"
        };
        this.streamingAssistant = undefined;
        const stopReason = typeof value.message.stopReason === "string" ? value.message.stopReason : undefined;
        if (this.stopRequested || stopReason === "aborted") {
          this.awaitingRetry = false;
          this.finishAssistant(message, "stopped");
          this.emit({ type: "lifecycle", state: "stopped" });
          this.stopOutcomeEmitted = true;
        } else if (stopReason === "error") {
          this.pendingErrorMessage = message;
        } else {
          this.awaitingRetry = false;
          this.finishAssistant(message, "final");
        }
      }
    } catch {
      // Pi does not contain listener failures. A malformed/private SDK event is
      // therefore ignored at this normalization boundary rather than escaping.
    }
  }

  private finishAssistant(
    message: Extract<QuestionChatMessage, { role: "assistant" }>,
    status: "final" | "stopped" | "interrupted",
    persistedAtFinish = false
  ): void {
    const finished: QuestionChatMessage = { ...message, status };
    const persisted = persistedAtFinish && this.recordPersistedOutcome(finished, status);
    const finalized = this.finalizedMessagesFromFork();
    const lastFinalized = finalized.at(-1);
    const alreadyPersisted =
      persisted &&
      lastFinalized?.role === "assistant" &&
      lastFinalized.text === finished.text &&
      lastFinalized.status === status;
    if (!alreadyPersisted) {
      this.transientMessages.push({
        message: finished,
        forkOccurrencesAtCreation: countMatchingMessages(finalized, finished)
      });
    }
    this.emit({ type: "message.finished", messageId: finished.id, text: finished.text, status });
  }

  private recordPersistedOutcome(
    message: Extract<QuestionChatMessage, { role: "assistant" }>,
    status: "final" | "stopped" | "interrupted"
  ): boolean {
    const branch = this.sessionManager.getBranch();
    const boundaryIndex = this.chatBoundaryId ? branch.findIndex((entry) => entry.id === this.chatBoundaryId) : -1;
    for (let index = branch.length - 1; index > boundaryIndex; index -= 1) {
      const entry = branch[index]!;
      if (entry.type !== "message" || entry.message.role !== "assistant") continue;
      if (assistantMessageId(entry.message, -1) !== message.id) continue;
      this.forkOutcomes.set(entry.id, status);
      return true;
    }
    return false;
  }

  private emit(event: RuntimeEventInput): void {
    const sequence = this.sequence + 1;
    this.persistSequence(sequence);
    this.sequence = sequence;
    const normalized = QuestionChatEventSchema.parse({
      ...event,
      requestId: this.initialSnapshot.requestId,
      sequence
    });
    if (normalized.type === "lifecycle") this.state = normalized.state;
    for (const listener of this.listeners) {
      try {
        listener(normalized);
      } catch {
        // One browser transport cannot break the SDK listener or other clients.
      }
    }
  }

  private finalizedMessagesFromFork(): QuestionChatMessage[] {
    const branch = this.sessionManager.getBranch();
    const boundaryIndex = this.chatBoundaryId ? branch.findIndex((entry) => entry.id === this.chatBoundaryId) : -1;
    const messages: QuestionChatMessage[] = [];
    const chatEntries = branch.slice(boundaryIndex + 1);
    let lastAssistantIndex = -1;
    for (let index = chatEntries.length - 1; index >= 0; index -= 1) {
      const entry = chatEntries[index]!;
      if (entry.type === "message" && entry.message.role === "assistant") {
        lastAssistantIndex = index;
        break;
      }
    }
    for (const [index, entry] of chatEntries.entries()) {
      if (entry.type !== "message") continue;
      if (entry.message.role === "user") {
        const text = visibleUserText(entry.message);
        if (text) messages.push({ id: entry.id, role: "user", text: text.slice(0, 8_000), status: "final" });
      } else if (entry.message.role === "assistant") {
        const visibleText = visibleAssistantText(entry.message);
        if (!visibleText) continue;
        const stopReason = "stopReason" in entry.message ? entry.message.stopReason : undefined;
        let nextConversationalRole: "user" | "assistant" | undefined;
        for (let later = index + 1; later < chatEntries.length; later += 1) {
          const laterEntry = chatEntries[later]!;
          if (laterEntry.type !== "message") continue;
          if (laterEntry.message.role === "user" || laterEntry.message.role === "assistant") {
            nextConversationalRole = laterEntry.message.role;
            break;
          }
        }
        const status = this.forkOutcomes.get(entry.id) ?? (stopReason === "aborted"
          ? "stopped"
          : stopReason === "error" && nextConversationalRole !== "assistant" &&
              !(index === lastAssistantIndex && (this.pendingErrorMessage || this.awaitingRetry))
            ? "interrupted"
            : "final");
        messages.push({
          id: entry.id,
          role: "assistant",
          text: visibleText.slice(0, QUESTION_CHAT_ASSISTANT_TEXT_MAX),
          status
        });
      }
    }
    return messages;
  }

  private toolActivitiesFromFork(): QuestionChatToolActivity[] {
    const branch = this.sessionManager.getBranch();
    const boundaryIndex = this.chatBoundaryId ? branch.findIndex((entry) => entry.id === this.chatBoundaryId) : -1;
    const activities = new Map<string, QuestionChatToolActivity>();
    for (const entry of branch.slice(boundaryIndex + 1)) {
      if (entry.type !== "message") continue;
      const message = entry.message;
      if (message.role === "assistant" && Array.isArray(message.content)) {
        for (const item of message.content) {
          if (!isRecord(item) || item.type !== "toolCall" || typeof item.id !== "string" || !isRepositoryEvidenceTool(item.name)) continue;
          activities.set(item.id, {
            id: sanitizeToolId(item.id),
            tool: item.name,
            target: sanitizeToolTarget(item.arguments),
            state: "stale",
            ...sanitizeToolArguments(item.name, item.arguments)
          });
        }
      } else if (message.role === "toolResult" && typeof message.toolCallId === "string") {
        const started = activities.get(message.toolCallId);
        if (!started || !isRepositoryEvidenceTool(message.toolName)) continue;
        const details = sanitizeToolResult(message);
        activities.set(message.toolCallId, {
          ...started,
          state: message.isError ? "error" : "success",
          ...(details ? { details } : {})
        });
      }
    }
    return [...activities.values()].slice(-QUESTION_CHAT_TOOL_ACTIVITY_MAX);
  }

  async terminate(): Promise<void> {
    if (this.terminated) return;
    this.terminated = true;
    this.unsubscribeSession?.();
    this.listeners.clear();
    try {
      await this.session.abort();
    } finally {
      this.session.dispose();
      assertContained(this.privateRoot, this.runtimeDir);
      rmSync(this.runtimeDir, { recursive: true, force: true });
    }
  }

  async suspend(): Promise<void> {
    if (this.terminated) return;
    this.terminated = true;
    this.unsubscribeSession?.();
    this.listeners.clear();
    try {
      await this.session.abort();
    } finally {
      this.session.dispose();
    }
  }
}

export class QuestionChatRuntimeRegistry {
  private readonly runtimes = new Map<string, {
    kind: "exact" | "context-only";
    ownerSessionId: string;
    runtime: Promise<QuestionChatRuntime>;
  }>();
  private readonly terminations = new Map<string, Promise<void>>();
  private readonly completedCommands = new Map<string, Map<string, Promise<QuestionChatSendResponse>>>();
  private readonly completedStopCommands = new Map<string, Map<string, Promise<QuestionChatStopResponse>>>();

  constructor(
    private readonly adapter: Pick<PiQuestionChatRuntimeAdapter, "create" | "createContext"> &
      Partial<Pick<PiQuestionChatRuntimeAdapter, "listRecoveryOffers" | "recover" | "discard">>
  ) {}

  async activate(input: QuestionChatActivation): Promise<QuestionChatSnapshot> {
    return this.activateKind(input.requestId, input.ownerSessionId, "exact", () => this.adapter.create(input));
  }

  async activateContext(input: QuestionChatContextActivation): Promise<QuestionChatSnapshot> {
    return this.activateKind(input.requestId, input.ownerSessionId, "context-only", () => this.adapter.createContext(input));
  }

  async getSnapshot(requestId: string): Promise<QuestionChatSnapshot> {
    const runtime = this.runtimes.get(requestId);
    if (!runtime) throw new QuestionChatRuntimeError("runtime_failure", "Question Chat has not started.");
    return (await runtime.runtime).snapshot;
  }

  async send(requestId: string, command: QuestionChatSendPayload): Promise<QuestionChatSendResponse> {
    const input = QuestionChatSendPayloadSchema.parse(command);
    let commands = this.completedCommands.get(requestId);
    if (!commands) {
      commands = new Map();
      this.completedCommands.set(requestId, commands);
    }
    const completed = commands.get(input.clientCommandId);
    if (completed) return completed;
    const runtime = this.runtimes.get(requestId);
    if (!runtime) throw new QuestionChatRuntimeError("runtime_failure", "Question Chat has not started.");
    const response = runtime.runtime.then((active) => active.send(input));
    commands.set(input.clientCommandId, response);
    if (commands.size > 256) commands.delete(commands.keys().next().value!);
    try {
      return await response;
    } catch (error) {
      if (commands.get(input.clientCommandId) === response) commands.delete(input.clientCommandId);
      throw error;
    }
  }

  async stop(requestId: string, command: QuestionChatStopPayload): Promise<QuestionChatStopResponse> {
    const input = QuestionChatStopPayloadSchema.parse(command);
    let commands = this.completedStopCommands.get(requestId);
    if (!commands) {
      commands = new Map();
      this.completedStopCommands.set(requestId, commands);
    }
    const completed = commands.get(input.clientCommandId);
    if (completed) return completed;
    const runtime = this.runtimes.get(requestId);
    if (!runtime) throw new QuestionChatRuntimeError("runtime_failure", "Question Chat has not started.");
    const response = runtime.runtime.then((active) => active.stop(input));
    commands.set(input.clientCommandId, response);
    if (commands.size > 256) commands.delete(commands.keys().next().value!);
    try {
      return await response;
    } catch (error) {
      if (commands.get(input.clientCommandId) === response) commands.delete(input.clientCommandId);
      throw error;
    }
  }

  subscribe(requestId: string, listener: (event: QuestionChatEvent) => void): () => void {
    const runtime = this.runtimes.get(requestId);
    if (!runtime) return () => undefined;
    let unsubscribe: () => void = () => undefined;
    let active = true;
    void runtime.runtime.then((resolved) => {
      if (active) unsubscribe = resolved.subscribe(listener);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }

  async cleanup(requestId: string): Promise<void> {
    const existingTermination = this.terminations.get(requestId);
    if (existingTermination) return existingTermination;
    const runtime = this.runtimes.get(requestId);
    if (!runtime) return;
    this.runtimes.delete(requestId);
    this.completedCommands.delete(requestId);
    this.completedStopCommands.delete(requestId);
    const termination = (async () => {
      try {
        await (await runtime.runtime).terminate();
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

  async cleanupAll(ownerSessionId?: string): Promise<void> {
    const ownedRuntimeIds = [...this.runtimes]
      .filter(([, entry]) => !ownerSessionId || entry.ownerSessionId === ownerSessionId)
      .map(([requestId]) => requestId);
    await Promise.all([
      ...this.terminations.values(),
      ...ownedRuntimeIds.map((requestId) => this.cleanup(requestId))
    ]);
    for (const offer of this.adapter.listRecoveryOffers?.() ?? []) {
      if (!ownerSessionId || offer.ownerSessionId === ownerSessionId) this.adapter.discard?.(offer.requestId);
    }
  }

  async suspendAll(): Promise<void> {
    const entries = [...this.runtimes.entries()];
    this.runtimes.clear();
    this.completedCommands.clear();
    this.completedStopCommands.clear();
    await Promise.all(entries.map(async ([, entry]) => (await entry.runtime).suspend()));
  }

  listRecoveryOffers(): QuestionChatRecoveryOffer[] {
    return this.adapter.listRecoveryOffers?.() ?? [];
  }

  async reconcile(
    ownerSessionId: string,
    decisions: QuestionChatReconciliationDecision[]
  ): Promise<QuestionChatReconciliationResult[]> {
    const results: QuestionChatReconciliationResult[] = [];
    for (const decision of decisions) {
      if (decision.action === "delete") {
        try {
          await this.cleanup(decision.requestId);
          this.adapter.discard?.(decision.requestId);
          results.push({ status: "deleted", requestId: decision.requestId });
        } catch (error) {
          results.push({
            status: "failed",
            requestId: decision.requestId,
            message: error instanceof Error ? error.message : "Question Chat cleanup failed."
          });
        }
        continue;
      }
      try {
        let entry = this.runtimes.get(decision.requestId);
        if (entry && (entry.kind !== decision.forkKind || entry.ownerSessionId !== ownerSessionId)) {
          throw new QuestionChatRuntimeError("runtime_busy", "A Question Chat with different recovery ownership is already running.");
        }
        if (!entry) {
          if (!this.adapter.recover) throw new QuestionChatRuntimeError("runtime_failure", "Question Chat recovery is not configured.");
          const runtime = this.adapter.recover(ownerSessionId, decision.requestId, decision.forkKind);
          entry = { kind: decision.forkKind, ownerSessionId, runtime };
          this.runtimes.set(decision.requestId, entry);
          void runtime.catch(() => {
            if (this.runtimes.get(decision.requestId) === entry) this.runtimes.delete(decision.requestId);
          });
        }
        results.push({ status: "recovered", snapshot: (await entry.runtime).snapshot });
      } catch (error) {
        results.push({
          status: "failed",
          requestId: decision.requestId,
          message: error instanceof Error ? error.message : "Question Chat recovery failed."
        });
      }
    }
    return results;
  }

  private async activateKind(
    requestId: string,
    ownerSessionId: string,
    kind: "exact" | "context-only",
    create: () => Promise<QuestionChatRuntime>
  ): Promise<QuestionChatSnapshot> {
    let entry = this.runtimes.get(requestId);
    if (entry && (entry.kind !== kind || entry.ownerSessionId !== ownerSessionId)) {
      throw new QuestionChatRuntimeError("runtime_busy", "A Question Chat with different ownership or fork kind is already running.");
    }
    if (!entry) {
      const runtime = create();
      entry = { kind, ownerSessionId, runtime };
      this.runtimes.set(requestId, entry);
      void runtime.catch(() => {
        if (this.runtimes.get(requestId) === entry) this.runtimes.delete(requestId);
      });
    }
    return (await entry.runtime).snapshot;
  }
}

function resolveRecordedModel(modelId: string | undefined, modelRuntime: ModelRuntime): ReturnType<ModelRuntime["getModel"]> {
  if (!modelId) return undefined;
  const separator = modelId.indexOf("/");
  if (separator <= 0 || separator === modelId.length - 1) return undefined;
  const provider = modelId.slice(0, separator);
  const id = modelId.slice(separator + 1);
  const model = modelRuntime.getModel(provider, id);
  return model && modelRuntime.hasConfiguredAuth(provider) ? model : undefined;
}

function contextOnlySystemPrompt(source: QuestionChatContextSource): string {
  return `${INTERVIEWER_SYSTEM_PROMPT}

This is a fresh private context-only interviewer session created from persisted handoff context. It is not the exact originating conversation. Treat the following bounded payload as authoritative user-provided context; do not invent prior dialogue, decisions, or implementation history.

<postbox-question>
${JSON.stringify({ mode: source.mode, question: source.question, options: source.options }, null, 2)}
</postbox-question>

<postbox-handoff-context>
${JSON.stringify(source.context, null, 2)}
</postbox-handoff-context>`;
}

function isRepositoryEvidenceTool(value: unknown): value is (typeof REPOSITORY_EVIDENCE_TOOL_NAMES)[number] {
  return typeof value === "string" && (REPOSITORY_EVIDENCE_TOOL_NAMES as readonly string[]).includes(value);
}

function sanitizeToolId(value: string): string {
  const sanitized = stripToolControls(value);
  if (!sanitized) return "repository-tool";
  if (sanitized.length <= 200) return sanitized;
  const suffix = createHash("sha256").update(value).digest("hex").slice(0, 16);
  return `${sanitized.slice(0, 183)}-${suffix}`;
}

function sanitizeToolTarget(args: unknown): string {
  if (!isRecord(args) || typeof args.path !== "string") return ".";
  const path = sanitizeToolText(args.path, QUESTION_CHAT_TOOL_TARGET_MAX);
  if (
    !path ||
    isAbsolute(path) ||
    isRepositoryEvidenceRestrictedPath(path)
  ) return "restricted target";
  return path;
}

function sanitizeToolArguments(
  tool: (typeof REPOSITORY_EVIDENCE_TOOL_NAMES)[number],
  args: unknown
): { details?: string } {
  if ((tool !== "repository_grep" && tool !== "repository_find") || !isRecord(args) || typeof args.query !== "string") return {};
  const query = sanitizeToolText(args.query, 200);
  return query ? { details: `literal query: ${query}` } : {};
}

function sanitizeToolResult(result: unknown): string | undefined {
  if (!isRecord(result) || !Array.isArray(result.content)) return undefined;
  const text = result.content
    .filter((item: unknown) => isRecord(item) && item.type === "text" && typeof item.text === "string")
    .map((item: Record<string, any>) => item.text)
    .join("\n");
  const sanitized = stripToolControls(text);
  if (!sanitized) return undefined;
  if (sanitized.length <= QUESTION_CHAT_TOOL_DETAILS_MAX) return sanitized;
  const marker = "… details truncated …";
  return `${sanitized.slice(0, QUESTION_CHAT_TOOL_DETAILS_MAX - marker.length)}${marker}`;
}

function sanitizeToolText(value: string, maximum: number): string {
  return stripToolControls(value).slice(0, maximum);
}

function stripToolControls(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g, "");
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}

function isAssistantMessage(value: unknown): value is Record<string, any> & { role: "assistant" } {
  return isRecord(value) && value.role === "assistant";
}

function assistantMessageId(message: Record<string, any>, fallback: number): string {
  return `assistant-${typeof message.timestamp === "number" ? message.timestamp : fallback}`;
}

function visibleAssistantText(message: Record<string, any>): string {
  return Array.isArray(message.content)
    ? message.content
        .filter((item: unknown) => isRecord(item) && item.type === "text" && typeof item.text === "string")
        .map((item: Record<string, any>) => item.text)
        .join("")
    : "";
}

function visibleUserText(message: Record<string, any>): string {
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content
    .filter((item: unknown) => isRecord(item) && item.type === "text" && typeof item.text === "string")
    .map((item: Record<string, any>) => item.text)
    .join("");
}

function countMatchingMessages(messages: QuestionChatMessage[], candidate: QuestionChatMessage): number {
  return messages.filter((message) => message.role === candidate.role && message.text === candidate.text).length;
}


function assertContained(root: string, candidate: string): void {
  const relation = relative(resolve(root), resolve(candidate));
  if (!relation || relation.startsWith("..") || relation.includes("/../")) {
    throw new Error("Question Chat runtime path escaped its private root");
  }
}
