import {
  QUESTION_CHAT_ASSISTANT_TEXT_MAX,
  QUESTION_CHAT_DELTA_MAX,
  QUESTION_CHAT_TOOL_ACTIVITY_MAX,
  QUESTION_CHAT_TOOL_DETAILS_MAX,
  QUESTION_CHAT_TOOL_TARGET_MAX,
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
} from "@pi-postbox/protocol";
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
import {
  constants,
  chmodSync,
  copyFileSync,
  statSync
} from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import {
  REPOSITORY_EVIDENCE_TOOL_NAMES,
  createRepositoryEvidenceTools,
  isRepositoryEvidenceRestrictedPath
} from "./repositoryEvidenceTools.js";
import {
  PROPOSE_ANSWER_TOOL_NAME,
  createProposeAnswerTool,
  type ProposeAnswerTransport
} from "./proposeAnswerTool.js";
import {
  FileQuestionChatRecoveryStore,
  type QuestionChatRecoveryManifest,
  type QuestionChatRecoveryStore
} from "./questionChatRecoveryStore.js";

const INTERVIEWER_SYSTEM_PROMPT =
  "You are the focused interviewer for one pending Postbox Question. Explain the decision without resolving it. Only the human may select, submit, cancel, or otherwise resolve the question. Repository evidence is available only through the scoped repository_read, repository_grep, repository_find, and repository_list tools. You may use propose_answer to append one answer option when it would help the human decide; it never selects, submits, cancels, or resolves the Question. Never claim shell or other mutation capability.";
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
  proposeAnswer?: ProposeAnswerTransport;
  recoveryStore?: QuestionChatRecoveryStore;
}

export class QuestionChatRuntimeError extends Error {
  constructor(
    public readonly code: Extract<
      QuestionChatAvailabilityCode,
      | "source_path_missing"
      | "source_leaf_missing"
      | "runtime_failure"
      | "runtime_busy"
      | "wrong_owner"
      | "request_not_pending"
      | "chat_not_started"
      | "duplicate_command"
      | "rate_limited"
    >,
    message: string
  ) {
    super(message);
    this.name = "QuestionChatRuntimeError";
  }
}

export class PiQuestionChatRuntimeAdapter {
  private readonly agentDir: string;
  private readonly createSession: (options: CreateAgentSessionOptions) => Promise<CreateAgentSessionResult>;
  private readonly createModelRuntime: () => Promise<ModelRuntime>;
  private readonly proposeAnswer: ProposeAnswerTransport;
  private readonly recoveryStore: QuestionChatRecoveryStore;

  constructor(options: PiQuestionChatRuntimeAdapterOptions = {}) {
    this.agentDir = resolve(options.agentDir ?? getAgentDir());
    this.recoveryStore = options.recoveryStore ?? new FileQuestionChatRecoveryStore(
      options.privateRoot ?? join(getAgentDir(), "postbox", "question-chats")
    );
    this.createSession = options.createAgentSession ?? createAgentSession;
    this.createModelRuntime =
      options.createModelRuntime ??
      (() =>
        ModelRuntime.create({
          authPath: join(this.agentDir, "auth.json"),
          modelsPath: join(this.agentDir, "models.json"),
          allowModelNetwork: false
        }));
    this.proposeAnswer = options.proposeAnswer ?? (async () => ({
      status: "error",
      error: { code: "internal_error", message: "Postbox proposal transport is unavailable." }
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
      recordedModelId: input.source.model
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
    }
  ): Promise<QuestionChatRuntime> {
    let runtimeDir = "";
    let session: SessionLifecycle | undefined;

    try {
      runtimeDir = this.recoveryStore.create(requestId);

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
      const proposalTool = createProposeAnswerTool(requestId, this.proposeAnswer);

      const modelRuntime = await this.createModelRuntime();
      // Both exact forks and context-only interviewers follow the same rule:
      // prefer the recorded authenticated model, otherwise let Pi select its
      // configured default.
      const explicitModel = resolveRecordedModel(prepared.recordedModelId, modelRuntime);
      const result = await this.createSession({
        cwd: prepared.cwd,
        agentDir: this.agentDir,
        sessionManager: prepared.sessionManager,
        settingsManager,
        resourceLoader,
        modelRuntime,
        ...(explicitModel ? { model: explicitModel } : {}),
        tools: [...REPOSITORY_EVIDENCE_TOOL_NAMES, PROPOSE_ANSWER_TOOL_NAME],
        customTools: [...evidence.tools, proposalTool],
        excludeTools: DISABLED_BUILTIN_TOOLS
      });
      session = result.session;
      const selectedModel = session.model;
      if (!selectedModel) {
        throw new QuestionChatRuntimeError("runtime_failure", "No authenticated Pi model is available for Question Chat.");
      }

      const selectedModelId = `${selectedModel.provider}/${selectedModel.id}`;
      const isOriginatingModel = Boolean(
        explicitModel && prepared.recordedModelId === selectedModelId
      );
      const fallbackReason = isOriginatingModel
        ? undefined
        : result.modelFallbackMessage ??
          (prepared.recordedModelId
            ? `Originating model ${prepared.recordedModelId} is unavailable; using Pi default ${selectedModelId}.`
            : `No originating model was recorded; using Pi default ${selectedModelId}.`);

      const privateSessionPath = prepared.sessionManager.getSessionFile();
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
      const manifest: QuestionChatRecoveryManifest = {
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
      this.recoveryStore.write(manifest);
      return new ManagedQuestionChatRuntime(
        snapshot,
        session,
        prepared.sessionManager,
        manifest.chatBoundaryId,
        (sequence) => this.recoveryStore.write({ ...manifest, sequence }),
        () => this.recoveryStore.remove(requestId)
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
        this.recoveryStore.remove(requestId);
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
    return this.recoveryStore.list()
      .map(({ manifest }) => ({
        requestId: manifest.requestId,
        ownerSessionId: manifest.ownerSessionId,
        forkKind: manifest.forkKind
      }))
      .sort((left, right) => left.requestId.localeCompare(right.requestId));
  }

  async recover(ownerSessionId: string, requestId: string, forkKind: QuestionChatSnapshot["forkKind"]): Promise<QuestionChatRuntime> {
    const { runtimeDirectory: runtimeDir, privateSessionPath, manifest } = this.recoveryStore.load(requestId);
    if (manifest.ownerSessionId !== ownerSessionId || manifest.forkKind !== forkKind) {
      throw new QuestionChatRuntimeError("runtime_failure", "Question Chat recovery metadata does not match the registered owner and fork kind.");
    }
    let sessionManager: SessionManager;
    try {
      sessionManager = SessionManager.open(privateSessionPath, runtimeDir, manifest.cwd);
      if (manifest.chatBoundaryId && !sessionManager.getEntry(manifest.chatBoundaryId)) {
        throw new Error("Question Chat transcript boundary is unavailable.");
      }
    } catch (error) {
      this.recoveryStore.remove(requestId);
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
      const proposalTool = createProposeAnswerTool(requestId, this.proposeAnswer);
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
        tools: [...REPOSITORY_EVIDENCE_TOOL_NAMES, PROPOSE_ANSWER_TOOL_NAME],
        customTools: [...evidence.tools, proposalTool],
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
      const durableManifest: QuestionChatRecoveryManifest = { ...manifest, privateSessionPath, model };
      this.recoveryStore.write(durableManifest);
      return new ManagedQuestionChatRuntime(
        { requestId, state: "ready", forkKind, model, sequence: manifest.sequence, messages: [], tools: [] },
        session,
        sessionManager,
        manifest.chatBoundaryId,
        (sequence) => this.recoveryStore.write({ ...durableManifest, sequence }),
        () => this.recoveryStore.remove(requestId)
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
    this.recoveryStore.remove(requestId);
  }

  private assertSourceFile(sourcePath: string): void {
    try {
      if (!statSync(sourcePath).isFile()) throw new Error("not a file");
    } catch {
      throw new QuestionChatRuntimeError("source_path_missing", "The originating Pi session file is unavailable.");
    }
  }

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
  private turnStarting = false;
  private sdkActive = false;
  private readonly forkOutcomes = new Map<string, "final" | "stopped" | "interrupted">();
  private readonly liveToolActivities = new Map<string, QuestionChatToolActivity>();

  constructor(
    private readonly initialSnapshot: QuestionChatSnapshot,
    private readonly session: SessionLifecycle,
    private readonly sessionManager: SessionManager,
    private readonly chatBoundaryId: string | null,
    private readonly persistSequence: (sequence: number) => void,
    private readonly deleteRecovery: () => void
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
    if (this.turnStarting || this.state === "stopping" || this.state === "stopped" || this.state === "interrupted") {
      throw new QuestionChatRuntimeError("runtime_busy", "Question Chat is not ready for another message.");
    }
    if (!this.session.prompt) throw new QuestionChatRuntimeError("runtime_failure", "Question Chat cannot start a model turn.");
    const mode = this.state === "generating" && (this.sdkActive || Boolean(this.session.isStreaming)) ? "steer" : "turn";
    if (this.state === "generating" && mode !== "steer") {
      throw new QuestionChatRuntimeError("runtime_busy", "Question Chat is still starting its response.");
    }

    const userMessage: QuestionChatMessage = {
      id: input.clientCommandId,
      role: "user",
      text: input.message,
      status: "final"
    };
    this.turnStarting = true;
    const turn = this.startTurn(input.message, mode === "steer" ? "steer" : undefined);
    try {
      await turn.accepted;
    } catch (error) {
      void turn.completion.catch(() => undefined);
      throw error;
    } finally {
      this.turnStarting = false;
    }

    if (this.terminated) {
      void turn.completion.catch(() => undefined);
      throw new QuestionChatRuntimeError(
        "request_not_pending",
        "The Postbox Question became terminal before the Question Chat turn was accepted."
      );
    }

    this.transientMessages.push({
      message: userMessage,
      forkOccurrencesAtCreation: countMatchingMessages(this.finalizedMessagesFromFork(), userMessage)
    });
    this.emit({
      type: "message.started",
      message: userMessage
    });
    if (mode === "turn") {
      this.sdkActive = true;
      this.emit({ type: "lifecycle", state: "generating" });
      void turn.completion.catch(() => {
        if (!this.terminated && this.state !== "ready") {
          this.sdkActive = false;
          this.emit({ type: "lifecycle", state: "interrupted" });
          this.emit({ type: "lifecycle", state: "ready" });
        }
      });
    } else {
      // Accepted steering completes with the active run; terminal outcomes are
      // normalized from SDK events rather than changing lifecycle here.
      void turn.completion.catch(() => undefined);
    }
    return { status: "accepted", clientCommandId: input.clientCommandId, mode };
  }

  async stop(command: QuestionChatStopPayload): Promise<QuestionChatStopResponse> {
    const input = QuestionChatStopPayloadSchema.parse(command);
    if (this.terminated) throw new QuestionChatRuntimeError("runtime_failure", "Question Chat has terminated.");
    if (this.turnStarting || this.state === "stopping") {
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

  private startTurn(
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
        else reject(new QuestionChatRuntimeError("runtime_failure", "Pi rejected the Question Chat turn before acceptance."));
      }
    });
    void completion.then(
      () => {
        if (!notified) reject(new QuestionChatRuntimeError("runtime_failure", "Pi completed without reporting Question Chat turn acceptance."));
      },
      (error) => {
        if (!notified) reject(error);
      }
    );
    return { accepted, completion };
  }

  private onSessionEvent(value: unknown): void {
    if (this.terminated) return;
    try {
      if (!isRecord(value) || typeof value.type !== "string") return;
      if (value.type === "tool_execution_start") {
        if (!isQuestionChatTool(value.toolName) || typeof value.toolCallId !== "string") return;
        const activity: QuestionChatToolActivity = {
          id: sanitizeToolId(value.toolCallId),
          tool: value.toolName,
          target: sanitizeQuestionChatToolTarget(value.toolName, value.args),
          state: "running",
          ...sanitizeQuestionChatToolArguments(value.toolName, value.args)
        };
        this.liveToolActivities.set(value.toolCallId, activity);
        this.emit({ type: "tool.started", activity });
        return;
      }
      if (value.type === "tool_execution_end") {
        if (!isQuestionChatTool(value.toolName) || typeof value.toolCallId !== "string") return;
        const started = this.liveToolActivities.get(value.toolCallId);
        if (!started) return;
        const details = sanitizeToolResult(value.result);
        const action = value.isError === true || value.toolName !== PROPOSE_ANSWER_TOOL_NAME
          ? undefined
          : sanitizeProposalAction(value.result);
        const activity = value.isError === true
          ? { ...started, state: "error" as const, ...(details ? { details } : {}) }
          : { ...started, state: "success" as const, ...(details ? { details } : {}), ...(action ? { action } : {}) };
        this.liveToolActivities.set(value.toolCallId, activity);
        this.emit({ type: "tool.finished", activity });
        return;
      }
      if (value.type === "agent_start") {
        if (this.turnStarting) return;
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
    if (this.terminated) return;
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
          if (!isRecord(item) || item.type !== "toolCall" || typeof item.id !== "string" || !isQuestionChatTool(item.name)) continue;
          activities.set(item.id, {
            id: sanitizeToolId(item.id),
            tool: item.name,
            target: sanitizeQuestionChatToolTarget(item.name, item.arguments),
            state: "stale",
            ...sanitizeQuestionChatToolArguments(item.name, item.arguments)
          });
        }
      } else if (message.role === "toolResult" && typeof message.toolCallId === "string") {
        const started = activities.get(message.toolCallId);
        if (!started || !isQuestionChatTool(message.toolName)) continue;
        const details = sanitizeToolResult(message);
        const action = message.isError || message.toolName !== PROPOSE_ANSWER_TOOL_NAME
          ? undefined
          : sanitizeProposalAction(message);
        activities.set(message.toolCallId, {
          ...started,
          state: message.isError ? "error" : "success",
          ...(details ? { details } : {}),
          ...(action ? { action } : {})
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
      this.deleteRecovery();
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
  private readonly commandOutcomes = new Map<string, Map<string, {
    kind: "send" | "stop";
    fingerprint: string;
    result: Promise<QuestionChatSendResponse | QuestionChatStopResponse>;
    settled: boolean;
    expiresAt: number;
  }>>();
  private readonly terminalTombstones = new Map<string, { ownerSessionId: string; expiresAt: number }>();

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

  async getSnapshot(requestId: string, ownerSessionId: string): Promise<QuestionChatSnapshot> {
    const runtime = this.requireRuntime(requestId, ownerSessionId);
    return (await runtime.runtime).snapshot;
  }

  async send(requestId: string, ownerSessionId: string, command: QuestionChatSendPayload): Promise<QuestionChatSendResponse> {
    const input = QuestionChatSendPayloadSchema.parse(command);
    this.assertKnownOwner(requestId, ownerSessionId);
    const retained = this.retainedCommand<QuestionChatSendResponse>(requestId, "send", input.clientCommandId, input);
    if (retained) return retained;
    const runtime = this.requireRuntime(requestId, ownerSessionId);
    this.assertCommandCapacity(requestId);
    const response = runtime.runtime.then((active) => active.send(input));
    this.retainCommand(requestId, "send", input.clientCommandId, input, response);
    return response;
  }

  async stop(requestId: string, ownerSessionId: string, command: QuestionChatStopPayload): Promise<QuestionChatStopResponse> {
    const input = QuestionChatStopPayloadSchema.parse(command);
    this.assertKnownOwner(requestId, ownerSessionId);
    const retained = this.retainedCommand<QuestionChatStopResponse>(requestId, "stop", input.clientCommandId, input);
    if (retained) return retained;
    const runtime = this.requireRuntime(requestId, ownerSessionId);
    this.assertCommandCapacity(requestId);
    const response = runtime.runtime.then((active) => active.stop(input));
    this.retainCommand(requestId, "stop", input.clientCommandId, input, response);
    return response;
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
    this.retainTerminalTombstone(requestId, runtime.ownerSessionId);
    this.runtimes.delete(requestId);
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
    this.commandOutcomes.clear();
    this.terminalTombstones.clear();
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
    this.pruneTerminalTombstones();
    const terminal = this.terminalTombstones.get(requestId);
    if (terminal) {
      if (terminal.ownerSessionId !== ownerSessionId) {
        throw new QuestionChatRuntimeError("wrong_owner", "Question Chat belongs to a different Pi Session.");
      }
      throw new QuestionChatRuntimeError("request_not_pending", "The Postbox Question is already terminal.");
    }
    let entry = this.runtimes.get(requestId);
    if (entry && entry.ownerSessionId !== ownerSessionId) {
      throw new QuestionChatRuntimeError("wrong_owner", "Question Chat belongs to a different Pi Session.");
    }
    if (entry && entry.kind !== kind) {
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
    const snapshot = (await entry.runtime).snapshot;
    if (this.runtimes.get(requestId) !== entry) {
        throw new QuestionChatRuntimeError("request_not_pending", "The Postbox Question became terminal during Question Chat activation.");
    }
    return snapshot;
  }

  private requireRuntime(requestId: string, ownerSessionId: string) {
    this.assertKnownOwner(requestId, ownerSessionId);
    if (this.terminalTombstones.has(requestId)) {
      throw new QuestionChatRuntimeError("request_not_pending", "The Postbox Question is already terminal.");
    }
    const runtime = this.runtimes.get(requestId);
    if (!runtime) throw new QuestionChatRuntimeError("chat_not_started", "Question Chat has not started.");
    return runtime;
  }

  private assertKnownOwner(requestId: string, ownerSessionId: string): void {
    this.pruneTerminalTombstones();
    const knownOwner = this.runtimes.get(requestId)?.ownerSessionId ?? this.terminalTombstones.get(requestId)?.ownerSessionId;
    if (knownOwner && knownOwner !== ownerSessionId) {
      throw new QuestionChatRuntimeError("wrong_owner", "Question Chat belongs to a different Pi Session.");
    }
  }

  private retainedCommand<T extends QuestionChatSendResponse | QuestionChatStopResponse>(
    requestId: string,
    kind: "send" | "stop",
    commandId: string,
    payload: unknown
  ): Promise<T> | undefined {
    this.pruneCommandOutcomes();
    const retained = this.commandOutcomes.get(requestId)?.get(commandId);
    if (!retained) return undefined;
    if (retained.kind !== kind || retained.fingerprint !== runtimeCommandFingerprint(kind, payload)) {
      return Promise.reject(new QuestionChatRuntimeError(
        "duplicate_command",
        "This command ID was already used for different Question Chat input."
      ));
    }
    return retained.result as Promise<T>;
  }

  private retainCommand<T extends QuestionChatSendResponse | QuestionChatStopResponse>(
    requestId: string,
    kind: "send" | "stop",
    commandId: string,
    payload: unknown,
    result: Promise<T>
  ): void {
    this.pruneCommandOutcomes();
    let commands = this.commandOutcomes.get(requestId);
    if (!commands) {
      commands = new Map();
      this.commandOutcomes.set(requestId, commands);
    }
    const retained = {
      kind,
      fingerprint: runtimeCommandFingerprint(kind, payload),
      result: result as Promise<QuestionChatSendResponse | QuestionChatStopResponse>,
      settled: false,
      expiresAt: Number.POSITIVE_INFINITY
    };
    commands.set(commandId, retained);
    void result.finally(() => {
      retained.settled = true;
      retained.expiresAt = Date.now() + 5 * 60_000;
    }).catch(() => undefined);
  }

  private pruneCommandOutcomes(): void {
    const now = Date.now();
    for (const [retainedRequestId, commands] of this.commandOutcomes) {
      for (const [commandId, retained] of commands) {
        if (retained.settled && retained.expiresAt <= now) commands.delete(commandId);
      }
      if (commands.size === 0) this.commandOutcomes.delete(retainedRequestId);
    }
  }

  private assertCommandCapacity(requestId: string): void {
    this.pruneCommandOutcomes();
    const commands = this.commandOutcomes.get(requestId);
    if (commands && commands.size >= 256) {
      const removable = [...commands].find(([, retained]) => retained.settled);
      if (!removable) throw runtimeCommandCapacityError();
      commands.delete(removable[0]);
    }
    if (!commands && this.commandOutcomes.size >= 256) {
      const removable = [...this.commandOutcomes].find(([, retained]) =>
        [...retained.values()].every((command) => command.settled)
      );
      if (!removable) throw runtimeCommandCapacityError();
      this.commandOutcomes.delete(removable[0]);
    }
  }

  private retainTerminalTombstone(requestId: string, ownerSessionId: string): void {
    this.pruneTerminalTombstones();
    while (this.terminalTombstones.size >= 256) {
      const oldestRequestId = this.terminalTombstones.keys().next().value!;
      this.terminalTombstones.delete(oldestRequestId);
      this.commandOutcomes.delete(oldestRequestId);
    }
    this.terminalTombstones.set(requestId, { ownerSessionId, expiresAt: Date.now() + 5 * 60_000 });
  }

  private pruneTerminalTombstones(): void {
    const now = Date.now();
    for (const [requestId, tombstone] of this.terminalTombstones) {
      if (tombstone.expiresAt <= now) {
        this.terminalTombstones.delete(requestId);
        this.commandOutcomes.delete(requestId);
      }
    }
  }
}

function runtimeCommandFingerprint(kind: "send" | "stop", payload: unknown): string {
  return createHash("sha256").update(`${kind}\u0000${JSON.stringify(payload)}`).digest("hex");
}

function runtimeCommandCapacityError(): QuestionChatRuntimeError {
  return new QuestionChatRuntimeError(
    "rate_limited",
    "Question Chat has too many commands in flight. Retry after an active command settles."
  );
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

function isQuestionChatTool(
  value: unknown
): value is (typeof REPOSITORY_EVIDENCE_TOOL_NAMES)[number] | typeof PROPOSE_ANSWER_TOOL_NAME {
  return isRepositoryEvidenceTool(value) || value === PROPOSE_ANSWER_TOOL_NAME;
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

function sanitizeProposalTarget(args: unknown): string {
  if (!isRecord(args) || typeof args.label !== "string") return "Suggested option";
  return sanitizeToolText(args.label, QUESTION_CHAT_TOOL_TARGET_MAX) || "Suggested option";
}

function sanitizeQuestionChatToolTarget(
  tool: (typeof REPOSITORY_EVIDENCE_TOOL_NAMES)[number] | typeof PROPOSE_ANSWER_TOOL_NAME,
  args: unknown
): string {
  return isRepositoryEvidenceTool(tool) ? sanitizeToolTarget(args) : sanitizeProposalTarget(args);
}

function sanitizeQuestionChatToolArguments(
  tool: (typeof REPOSITORY_EVIDENCE_TOOL_NAMES)[number] | typeof PROPOSE_ANSWER_TOOL_NAME,
  args: unknown
): { details?: string } {
  return isRepositoryEvidenceTool(tool) ? sanitizeToolArguments(tool, args) : {};
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

function sanitizeProposalAction(
  result: unknown
): { type: "show-question"; optionValue: string } | undefined {
  if (!isRecord(result) || !isRecord(result.details) || !isRecord(result.details.action)) return undefined;
  const action = result.details.action;
  if (action.type !== "show-question" || typeof action.optionValue !== "string") return undefined;
  const optionValue = stripToolControls(action.optionValue);
  if (!optionValue || optionValue.length > 200) return undefined;
  return { type: "show-question", optionValue };
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
