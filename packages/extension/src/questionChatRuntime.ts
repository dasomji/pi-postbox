import {
  QUESTION_CHAT_ASSISTANT_TEXT_MAX,
  QUESTION_CHAT_DELTA_MAX,
  QuestionChatEventSchema,
  QuestionChatSendPayloadSchema,
  QuestionChatStopPayloadSchema,
  type QuestionChatAvailabilityCode,
  type QuestionChatEvent,
  type QuestionChatMessage,
  type QuestionChatSendPayload,
  type QuestionChatSendResponse,
  type QuestionChatSnapshot,
  type QuestionChatSource,
  type QuestionChatState,
  type QuestionChatStopPayload,
  type QuestionChatStopResponse
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
  terminate(): Promise<void>;
}

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
        sequence: 0,
        messages: []
      };
      return new ManagedQuestionChatRuntime(snapshot, session, sessionManager, sessionManager.getLeafId(), runtimeDir, this.privateRoot);
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
  private sequence = 0;
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

  constructor(
    private readonly initialSnapshot: QuestionChatSnapshot,
    private readonly session: SessionLifecycle,
    private readonly sessionManager: SessionManager,
    private readonly chatBoundaryId: string | null,
    private readonly runtimeDir: string,
    private readonly privateRoot: string
  ) {
    this.unsubscribeSession = this.session.subscribe?.((event) => this.onSessionEvent(event));
  }

  get snapshot(): QuestionChatSnapshot {
    const messages = this.finalizedMessagesFromFork();
    this.transientMessages = this.transientMessages.filter(({ message, forkOccurrencesAtCreation }) =>
      countMatchingMessages(messages, message) <= forkOccurrencesAtCreation
    );
    messages.push(...this.transientMessages.map(({ message }) => message));
    if (this.streamingAssistant) messages.push(this.streamingAssistant);
    return {
      ...this.initialSnapshot,
      state: this.state,
      sequence: this.sequence,
      messages: messages.slice(-100)
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
    const normalized = QuestionChatEventSchema.parse({
      ...event,
      requestId: this.initialSnapshot.requestId,
      sequence: ++this.sequence
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
          text: visibleAssistantText(entry.message).slice(0, QUESTION_CHAT_ASSISTANT_TEXT_MAX),
          status
        });
      }
    }
    return messages;
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
}

export class QuestionChatRuntimeRegistry {
  private readonly runtimes = new Map<string, Promise<QuestionChatRuntime>>();
  private readonly terminations = new Map<string, Promise<void>>();
  private readonly completedCommands = new Map<string, Map<string, Promise<QuestionChatSendResponse>>>();
  private readonly completedStopCommands = new Map<string, Map<string, Promise<QuestionChatStopResponse>>>();

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

  async getSnapshot(requestId: string): Promise<QuestionChatSnapshot> {
    const runtime = this.runtimes.get(requestId);
    if (!runtime) throw new QuestionChatRuntimeError("runtime_failure", "Question Chat has not started.");
    return (await runtime).snapshot;
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
    const response = runtime.then((active) => active.send(input));
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
    const response = runtime.then((active) => active.stop(input));
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
    void runtime.then((resolved) => {
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
