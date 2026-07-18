import {
  ExtensionServerMessageSchema,
  type AskAnswerPayload,
  type AskCancelPayload,
  type AskCreatePayload,
  type AskOption,
  OTHER_OPTION_VALUE,
  type AskResult,
  type ExtensionClientMessage,
  type SemanticState,
  type ActiveLocalRole,
  type SessionRegisterPayload,
  type SessionShutdownReason
} from "../../../protocol/src/index.js";
import type {
  QuestionChatEvent,
  QuestionChatAvailabilityError,
  QuestionChatContextSource,
  QuestionChatSendPayload,
  QuestionChatSendResponse,
  QuestionChatSnapshot,
  QuestionChatSource,
  QuestionChatStopPayload,
  QuestionChatStopResponse
} from "../../../protocol/src/index.js";
import { QuestionChatRuntimeError } from "../questionChatRuntime.js";
import WebSocket from "ws";
import type { ResolveActiveLocalTargetResult } from "../activeLocalTargetResolver.js";
import {
  createUrlStatusSnapshot,
  enrichStatusSnapshotFromLocalServer,
  type PostboxConnectionState,
  type PostboxStatusSnapshot,
  type PostboxStatusTailscaleInspector
} from "../status.js";
import type { PostboxAutostartStatusSnapshot } from "../autostart.js";

interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  on(event: "open" | "close" | "error" | "message", listener: (...args: unknown[]) => void): void;
}

type WebSocketConstructor = new (url: string) => WebSocketLike;

export interface PostboxClientOptions {
  serverUrl: string;
  registration: SessionRegisterPayload;
  heartbeatMs?: number;
  reconnectMs?: number;
  reconnectMaxMs?: number;
  reconnect?: boolean;
  askUnavailableAfterMs?: number;
  resolveTarget?: () => Promise<ResolveActiveLocalTargetResult>;
  activeLocalPollingEnabled?: boolean;
  activeLocalPollMs?: number;
  targetAffinityTimeoutMs?: number;
  targetSource?: string;
  targetRole?: ActiveLocalRole;
  inspectTailscale?: PostboxStatusTailscaleInspector;
  WebSocketImpl?: WebSocketConstructor;
  onStatus?: (status: string) => void;
  onLocalFallbackStatus?: (status: LocalFallbackStatus | undefined) => void;
  questionChats?: {
    activate(input: { requestId: string; source: QuestionChatSource }): Promise<QuestionChatSnapshot>;
    activateContext(input: { requestId: string; source: QuestionChatContextSource }): Promise<QuestionChatSnapshot>;
    getSnapshot(requestId: string): Promise<QuestionChatSnapshot>;
    send(requestId: string, command: QuestionChatSendPayload): Promise<QuestionChatSendResponse>;
    stop(requestId: string, command: QuestionChatStopPayload): Promise<QuestionChatStopResponse>;
    subscribe(requestId: string, listener: (event: QuestionChatEvent) => void): () => void;
    cleanup(requestId: string): Promise<void>;
  };
}

export interface PendingAskSnapshot {
  requestId: string;
  prompt: string;
  mode: AskCreatePayload["mode"];
  options: AskOption[];
  sentAtLeastOnce: boolean;
  expiresAt?: string;
}

export interface LocalFallbackStatus {
  requestId: string;
  serverUrl: string;
  message: string;
}

export interface LocalAnswerInput {
  requestId?: string;
  selectedValues: string[];
  note?: string;
  rationale?: string;
}

export interface LocalCancelInput {
  requestId?: string;
  note?: string;
  rationale?: string;
}

interface LocalResolution {
  payload: AskCreatePayload;
  result: AskResult;
  message: ExtensionClientMessage;
  originServerUrl: string;
  targetAffinityTimer?: NodeJS.Timeout;
}

interface PendingAsk {
  payload: AskCreatePayload;
  resolve: (result: AskResult) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
  sentAtLeastOnce: boolean;
  createdServerUrl: string;
  originServerUrl?: string;
  unavailableTimer?: NodeJS.Timeout;
  expiryTimer?: NodeJS.Timeout;
  targetAffinityTimer?: NodeJS.Timeout;
}

const DEFAULT_UNAVAILABLE_AFTER_MS = 30_000;
const DEFAULT_RECONNECT_MAX_MS = 30_000;
const DEFAULT_ACTIVE_LOCAL_POLL_MS = 5_000;
const DEFAULT_TARGET_AFFINITY_TIMEOUT_MS = 30_000;

export class PostboxClient {
  private socket: WebSocketLike | undefined;
  private stopped = false;
  private heartbeatTimer: NodeJS.Timeout | undefined;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private readonly heartbeatMs: number;
  private readonly reconnectMs: number;
  private readonly reconnectMaxMs: number;
  private nextReconnectMs: number;
  private readonly reconnect: boolean;
  private readonly askUnavailableAfterMs: number;
  private readonly WebSocketImpl: WebSocketConstructor;
  private readonly pendingAsks = new Map<string, PendingAsk>();
  private readonly localResolutions = new Map<string, LocalResolution>();
  private currentSemanticState: SemanticState;
  private currentServerUrl: string;
  private connectionState: PostboxConnectionState = "disconnected";
  private connectionDiagnostics: string[] = ["websocket:disconnected"];
  private currentTargetSource: string | undefined;
  private currentTargetRole: ActiveLocalRole | undefined;
  private activeLocalPollTimer: NodeJS.Timeout | undefined;
  private deferredTargetUrl: string | undefined;
  private readonly suppressReconnectOnClose = new WeakSet<WebSocketLike>();
  private readonly questionChatSubscriptions = new Map<string, () => void>();

  constructor(private readonly options: PostboxClientOptions) {
    this.heartbeatMs = options.heartbeatMs ?? 15_000;
    this.reconnectMs = options.reconnectMs ?? 5_000;
    this.reconnectMaxMs = options.reconnectMaxMs ?? DEFAULT_RECONNECT_MAX_MS;
    this.nextReconnectMs = this.reconnectMs;
    this.reconnect = options.reconnect ?? true;
    this.askUnavailableAfterMs = options.askUnavailableAfterMs ?? DEFAULT_UNAVAILABLE_AFTER_MS;
    this.WebSocketImpl = options.WebSocketImpl ?? (WebSocket as unknown as WebSocketConstructor);
    this.currentSemanticState = options.registration.session.semanticState;
    this.currentServerUrl = options.serverUrl;
    this.currentTargetSource = options.targetSource;
    this.currentTargetRole = options.targetRole;
  }

  start(): void {
    this.stopped = false;
    this.connect();
    this.startActiveLocalPolling();
  }

  stop(): void {
    this.stopped = true;
    this.connectionState = "disconnected";
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.activeLocalPollTimer) clearInterval(this.activeLocalPollTimer);
    for (const [, pending] of this.pendingAsks) {
      pending.cleanup();
      pending.reject(new Error("Postbox client stopped"));
    }
    this.pendingAsks.clear();
    for (const requestId of [...this.localResolutions.keys()]) {
      this.deleteLocalResolution(requestId);
    }
    this.publishLocalFallbackStatus();
    for (const unsubscribe of this.questionChatSubscriptions.values()) unsubscribe();
    this.questionChatSubscriptions.clear();
    this.socket?.close();
  }

  updateSemanticState(state: SemanticState): boolean {
    this.currentSemanticState = state;
    return this.send({
      type: "session.update",
      payload: {
        sessionId: this.options.registration.session.sessionId,
        semanticState: state
      }
    });
  }

  updateQuestionSource(source: { cwd: string; agentSessionPath: string; leafId: string }): boolean {
    this.options.registration = {
      ...this.options.registration,
      session: { ...this.options.registration.session, ...source }
    };
    return this.send({
      type: "session.update",
      payload: {
        sessionId: this.options.registration.session.sessionId,
        cwd: source.cwd,
        agentSessionPath: source.agentSessionPath,
        leafId: source.leafId
      }
    });
  }

  shutdownSession(reason?: SessionShutdownReason): boolean {
    return this.send({
      type: "session.shutdown",
      payload: { sessionId: this.options.registration.session.sessionId, reason }
    });
  }

  ask(payload: AskCreatePayload, signal?: AbortSignal): Promise<AskResult> {
    if (this.stopped) {
      return Promise.resolve(unavailableResult(payload.requestId, "Pi Postbox client is stopped."));
    }
    if (signal?.aborted) {
      return Promise.reject(new Error("ask_postbox was aborted"));
    }

    return new Promise<AskResult>((resolve, reject) => {
      const cleanup = () => {
        this.pendingAsks.delete(payload.requestId);
        signal?.removeEventListener("abort", abort);
        if (pending.unavailableTimer) clearTimeout(pending.unavailableTimer);
        if (pending.expiryTimer) clearTimeout(pending.expiryTimer);
        if (pending.targetAffinityTimer) clearTimeout(pending.targetAffinityTimer);
        this.publishLocalFallbackStatus();
        this.tryApplyDeferredTarget();
      };
      const complete = (result: AskResult) => {
        cleanup();
        resolve(result);
      };
      const abort = () => {
        this.cancelAskOnAbort(pending);
        cleanup();
        reject(new Error("ask_postbox was aborted"));
      };

      const pending: PendingAsk = {
        payload,
        resolve: complete,
        reject: (error) => {
          cleanup();
          reject(error);
        },
        cleanup,
        sentAtLeastOnce: false,
        createdServerUrl: this.currentServerUrl
      };

      this.pendingAsks.set(payload.requestId, pending);
      signal?.addEventListener("abort", abort, { once: true });
      this.startExpiryTimer(pending);
      this.startUnavailableTimerIfNeeded(pending);
      this.ensureConnection();
      this.publishLocalFallbackStatus();
      this.sendPendingAsk(pending);
    });
  }

  listPendingAsks(): PendingAskSnapshot[] {
    return [...this.pendingAsks.values()].map((pending) => ({
      requestId: pending.payload.requestId,
      prompt: pending.payload.question.prompt,
      mode: pending.payload.mode,
      options: pending.payload.options,
      sentAtLeastOnce: pending.sentAtLeastOnce,
      expiresAt: pending.payload.expiresAt
    }));
  }

  async getStatusSnapshot(
    autostart: PostboxAutostartStatusSnapshot = { enabled: true, startedByThisSession: false }
  ): Promise<PostboxStatusSnapshot> {
    const snapshot = createUrlStatusSnapshot({
      state: this.connectionState,
      activeUrl: this.currentServerUrl,
      openQuestionCount: this.pendingAsks.size,
      autostart,
      diagnostics: this.connectionState === "connected" ? [] : this.connectionDiagnostics,
      source: this.currentTargetSource
    });

    return enrichStatusSnapshotFromLocalServer(snapshot, {
      role: this.currentTargetRole,
      inspectTailscale: this.options.inspectTailscale
    });
  }

  answerPendingAsk(input: LocalAnswerInput): AskResult {
    const pending = this.findPendingAsk(input.requestId);
    this.validateSelectedValues(pending.payload, input.selectedValues);
    const answer: AskAnswerPayload = {
      selectedValues: input.selectedValues,
      note: input.note,
      rationale: input.rationale
    };
    const result: AskResult = {
      status: "answered",
      requestId: pending.payload.requestId,
      selectedValues: answer.selectedValues,
      note: answer.note,
      rationale: answer.rationale,
      resolvedAt: new Date().toISOString()
    };
    this.resolveLocally(pending, result, {
      type: "ask.answer",
      requestId: pending.payload.requestId,
      payload: { requestId: pending.payload.requestId, answer }
    });
    return result;
  }

  cancelPendingAsk(input: LocalCancelInput = {}): AskResult {
    const pending = this.findPendingAsk(input.requestId);
    const cancel: AskCancelPayload = { note: input.note, rationale: input.rationale };
    const result: AskResult = {
      status: "cancelled",
      requestId: pending.payload.requestId,
      note: cancel.note,
      rationale: cancel.rationale,
      resolvedAt: new Date().toISOString()
    };
    this.resolveLocally(pending, result, {
      type: "ask.cancel",
      requestId: pending.payload.requestId,
      payload: { requestId: pending.payload.requestId, cancel }
    });
    return result;
  }

  private connect(): void {
    if (this.stopped) return;

    try {
      this.socket = new this.WebSocketImpl(toExtensionSocketUrl(this.currentServerUrl));
    } catch (error) {
      this.connectionState = "disconnected";
      this.recordConnectionDiagnostic(`connect-error:${messageFrom(error)}`);
      this.options.onStatus?.(`connect-error:${messageFrom(error)}`);
      this.scheduleReconnect();
      return;
    }

    const socket = this.socket;
    socket.on("open", () => {
      this.connectionState = "connected";
      this.connectionDiagnostics = [];
      this.options.onStatus?.("connected");
      this.nextReconnectMs = this.reconnectMs;
      this.send({
        type: "session.register",
        payload: {
          ...this.options.registration,
          session: { ...this.options.registration.session, semanticState: this.currentSemanticState }
        }
      });
      this.startHeartbeat();
      this.replayPendingAsks();
      this.flushLocalResolutions();
    });

    socket.on("message", (raw) => {
      try {
        const text = Buffer.isBuffer(raw) ? raw.toString() : String(raw);
        const parsed = ExtensionServerMessageSchema.safeParse(JSON.parse(text));
        if (!parsed.success) return;
        if (parsed.data.type === "chat.activate") {
          void this.activateQuestionChat(parsed.data.requestId, parsed.data.payload);
          return;
        }
        if (parsed.data.type === "chat.activate-context") {
          void this.activateContextQuestionChat(parsed.data.requestId, parsed.data.payload);
          return;
        }
        if (parsed.data.type === "chat.snapshot") {
          void this.snapshotQuestionChat(parsed.data.requestId, parsed.data.payload);
          return;
        }
        if (parsed.data.type === "chat.send") {
          void this.sendQuestionChat(parsed.data.requestId, parsed.data.payload);
          return;
        }
        if (parsed.data.type === "chat.stop") {
          void this.stopQuestionChat(parsed.data.requestId, parsed.data.payload);
          return;
        }
        if (parsed.data.type === "chat.cleanup") {
          this.questionChatSubscriptions.get(parsed.data.payload.requestId)?.();
          this.questionChatSubscriptions.delete(parsed.data.payload.requestId);
          void this.options.questionChats?.cleanup(parsed.data.payload.requestId);
          return;
        }
        if (parsed.data.type === "error") {
          this.options.onStatus?.(`server-error:${parsed.data.error.code}`);
          if (parsed.data.requestId) {
            this.pendingAsks.get(parsed.data.requestId)?.reject(new Error(parsed.data.error.message));
          }
        }
        if (parsed.data.type === "ask.resolved") {
          this.pendingAsks.get(parsed.data.payload.requestId)?.resolve(parsed.data.payload);
        }
      } catch {
        this.options.onStatus?.("server-error:invalid-json");
      }
    });

    socket.on("error", (error) => {
      if (!this.isConnected()) this.connectionState = "disconnected";
      this.recordConnectionDiagnostic(`socket-error:${messageFrom(error)}`);
      this.options.onStatus?.(`socket-error:${messageFrom(error)}`);
    });

    socket.on("close", () => {
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      this.connectionState = "disconnected";
      this.recordConnectionDiagnostic("websocket:disconnected");
      if (this.stopped) return;
      if (this.suppressReconnectOnClose.has(socket)) return;
      this.options.onStatus?.("disconnected");
      this.startTargetAffinityTimersForDisconnectedOrigin();
      this.scheduleReconnect();
    });
  }

  private async activateQuestionChat(
    commandId: string,
    payload: { requestId: string; ownerSessionId: string; source: QuestionChatSource }
  ): Promise<void> {
    await this.handleQuestionChatActivation(commandId, payload, (input) => this.options.questionChats!.activate(input));
  }

  private async activateContextQuestionChat(
    commandId: string,
    payload: { requestId: string; ownerSessionId: string; source: QuestionChatContextSource }
  ): Promise<void> {
    await this.handleQuestionChatActivation(commandId, payload, (input) => this.options.questionChats!.activateContext(input));
  }

  private async handleQuestionChatActivation<Source extends QuestionChatSource | QuestionChatContextSource>(
    commandId: string,
    payload: { requestId: string; ownerSessionId: string; source: Source },
    activate: (input: { requestId: string; source: Source }) => Promise<QuestionChatSnapshot>
  ): Promise<void> {
    if (payload.ownerSessionId !== this.options.registration.session.sessionId) {
      this.sendQuestionChatError(commandId, payload.requestId, {
        code: "wrong_owner",
        message: "Question Chat activation was routed to the wrong Pi Session."
      });
      return;
    }
    if (!this.options.questionChats) {
      this.sendQuestionChatError(commandId, payload.requestId, {
        code: "runtime_failure",
        message: "Question Chat runtime is not configured."
      });
      return;
    }

    try {
      const snapshot = await activate({ requestId: payload.requestId, source: payload.source });
      if (!this.questionChatSubscriptions.has(payload.requestId)) {
        const unsubscribe = this.options.questionChats.subscribe(payload.requestId, (event) => {
          this.send({ type: "chat.event", payload: event });
        });
        this.questionChatSubscriptions.set(payload.requestId, unsubscribe);
      }
      this.send({ type: "chat.ready", requestId: commandId, payload: snapshot });
    } catch (error) {
      const runtimeError = error instanceof QuestionChatRuntimeError ? error : undefined;
      this.sendQuestionChatError(commandId, payload.requestId, {
        code: runtimeError?.code ?? "runtime_failure",
        message: runtimeError?.message ?? (error instanceof Error ? error.message : "Question Chat activation failed.")
      });
    }
  }

  private async snapshotQuestionChat(
    commandId: string,
    payload: { requestId: string; ownerSessionId: string }
  ): Promise<void> {
    if (!this.validateQuestionChatCommandOwner(commandId, payload, "snapshot")) return;
    try {
      const snapshot = await this.options.questionChats!.getSnapshot(payload.requestId);
      this.send({ type: "chat.snapshot", requestId: commandId, payload: snapshot });
    } catch (error) {
      this.sendRuntimeQuestionChatError(commandId, payload.requestId, error, "Question Chat snapshot failed.");
    }
  }

  private async sendQuestionChat(
    commandId: string,
    payload: { requestId: string; ownerSessionId: string; command: QuestionChatSendPayload }
  ): Promise<void> {
    if (!this.validateQuestionChatCommandOwner(commandId, payload, "send")) return;
    try {
      const response = await this.options.questionChats!.send(payload.requestId, payload.command);
      this.send({ type: "chat.send.accepted", requestId: commandId, payload: { requestId: payload.requestId, response } });
    } catch (error) {
      this.sendRuntimeQuestionChatError(commandId, payload.requestId, error, "Question Chat send failed.");
    }
  }

  private async stopQuestionChat(
    commandId: string,
    payload: { requestId: string; ownerSessionId: string; command: QuestionChatStopPayload }
  ): Promise<void> {
    if (!this.validateQuestionChatCommandOwner(commandId, payload, "stop")) return;
    try {
      const response = await this.options.questionChats!.stop(payload.requestId, payload.command);
      this.send({ type: "chat.stop.accepted", requestId: commandId, payload: { requestId: payload.requestId, response } });
    } catch (error) {
      this.sendRuntimeQuestionChatError(commandId, payload.requestId, error, "Question Chat stop failed.");
    }
  }

  private validateQuestionChatCommandOwner(
    commandId: string,
    payload: { requestId: string; ownerSessionId: string },
    action: string
  ): boolean {
    if (payload.ownerSessionId !== this.options.registration.session.sessionId) {
      this.sendQuestionChatError(commandId, payload.requestId, {
        code: "wrong_owner",
        message: `Question Chat ${action} was routed to the wrong Pi Session.`
      });
      return false;
    }
    if (!this.options.questionChats) {
      this.sendQuestionChatError(commandId, payload.requestId, {
        code: "runtime_failure",
        message: "Question Chat runtime is not configured."
      });
      return false;
    }
    return true;
  }

  private sendRuntimeQuestionChatError(commandId: string, requestId: string, error: unknown, fallback: string): void {
    const runtimeError = error instanceof QuestionChatRuntimeError ? error : undefined;
    this.sendQuestionChatError(commandId, requestId, {
      code: runtimeError?.code ?? "runtime_failure",
      message: runtimeError?.message ?? (error instanceof Error ? error.message : fallback)
    });
  }

  private sendQuestionChatError(
    commandId: string,
    requestId: string,
    error: QuestionChatAvailabilityError
  ): void {
    this.send({ type: "chat.error", requestId: commandId, payload: { requestId, error } });
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      this.send({
        type: "heartbeat",
        payload: {
          sessionId: this.options.registration.session.sessionId,
          semanticState: this.currentSemanticState
        }
      });
    }, this.heartbeatMs);
    this.heartbeatTimer.unref?.();
  }

  private send(message: ExtensionClientMessage): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  private ensureConnection(): void {
    if (this.stopped) return;
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) return;
    this.connect();
  }

  private replayPendingAsks(): void {
    for (const pending of this.pendingAsks.values()) {
      this.sendPendingAsk(pending);
    }
  }

  private sendPendingAsk(pending: PendingAsk): boolean {
    if (pending.originServerUrl && pending.originServerUrl !== this.currentServerUrl) return false;
    const sent = this.send({ type: "ask.create", requestId: pending.payload.requestId, payload: pending.payload });
    if (sent) {
      pending.sentAtLeastOnce = true;
      pending.originServerUrl ??= this.currentServerUrl;
      if (pending.unavailableTimer) {
        clearTimeout(pending.unavailableTimer);
        pending.unavailableTimer = undefined;
      }
    }
    return sent;
  }

  private startUnavailableTimerIfNeeded(pending: PendingAsk): void {
    if (this.isConnected()) return;
    if (pending.unavailableTimer) clearTimeout(pending.unavailableTimer);
    pending.unavailableTimer = setTimeout(() => {
      if (!pending.sentAtLeastOnce) {
        pending.resolve(unavailableResult(pending.payload.requestId, "Pi Postbox is unavailable before the request could be sent."));
      }
    }, this.askUnavailableAfterMs);
    pending.unavailableTimer.unref?.();
  }

  private startExpiryTimer(pending: PendingAsk): void {
    if (!pending.payload.expiresAt) return;
    const dueMs = Date.parse(pending.payload.expiresAt) - Date.now();
    if (dueMs <= 0) {
      queueMicrotask(() => pending.resolve(expiredResult(pending.payload.requestId)));
      return;
    }
    pending.expiryTimer = setTimeout(() => pending.resolve(expiredResult(pending.payload.requestId)), dueMs);
    pending.expiryTimer.unref?.();
  }

  private resolveLocally(pending: PendingAsk, result: AskResult, message: ExtensionClientMessage): void {
    this.enqueueLocalResolution(pending, result, message);
    pending.resolve(result);
    this.flushLocalResolutions();
  }

  /**
   * The agent abandoned this ask (the tool call was aborted), so cancel it server-side too;
   * otherwise the question lingers as pending in every Postbox inbox until it expires. Skipped
   * when the ask never reached a server, because there is nothing to cancel there.
   */
  private cancelAskOnAbort(pending: PendingAsk): void {
    if (!pending.sentAtLeastOnce) return;
    const requestId = pending.payload.requestId;
    const cancel: AskCancelPayload = { note: "The agent stopped waiting for this question." };
    const result: AskResult = {
      status: "cancelled",
      requestId,
      note: cancel.note,
      resolvedAt: new Date().toISOString()
    };
    this.enqueueLocalResolution(pending, result, {
      type: "ask.cancel",
      requestId,
      payload: { requestId, cancel }
    });
    this.flushLocalResolutions();
  }

  private enqueueLocalResolution(pending: PendingAsk, result: AskResult, message: ExtensionClientMessage): void {
    const originServerUrl = pending.originServerUrl ?? pending.createdServerUrl;
    const resolution: LocalResolution = { payload: pending.payload, result, message, originServerUrl };
    this.localResolutions.set(pending.payload.requestId, resolution);
    if (!this.isConnected()) this.startLocalResolutionTargetAffinityTimer(pending.payload.requestId, resolution);
  }

  private findPendingAsk(requestId?: string): PendingAsk {
    if (requestId) {
      const pending = this.pendingAsks.get(requestId);
      if (!pending) throw new LocalFallbackError("request_not_pending", `No pending Postbox ask found for ${requestId}`);
      return pending;
    }

    const pending = [...this.pendingAsks.values()];
    if (pending.length === 0) throw new LocalFallbackError("no_pending_request", "No pending Postbox ask is available for local fallback");
    if (pending.length > 1) {
      throw new LocalFallbackError("ambiguous_request", "Multiple Postbox asks are pending; include the request id");
    }
    return pending[0];
  }

  private validateSelectedValues(payload: AskCreatePayload, selectedValues: string[]): void {
    if (selectedValues.length === 0) throw new LocalFallbackError("invalid_selection", "Select at least one option value");
    if (payload.mode === "single" && selectedValues.length !== 1) {
      throw new LocalFallbackError("invalid_selection", "Single-choice asks require exactly one selected value");
    }
    const allowed = new Set([...payload.options.map((option) => option.value), OTHER_OPTION_VALUE]);
    const invalid = selectedValues.find((value) => !allowed.has(value));
    if (invalid) throw new LocalFallbackError("invalid_selection", `Unknown option value: ${invalid}`);
  }

  private flushLocalResolutions(): void {
    if (!this.isConnected()) return;
    for (const [requestId, resolution] of [...this.localResolutions]) {
      if (resolution.originServerUrl !== this.currentServerUrl) continue;
      const createSent = this.send({ type: "ask.create", requestId, payload: resolution.payload });
      const resolutionSent = createSent && this.send(resolution.message);
      if (resolutionSent) this.deleteLocalResolution(requestId);
    }
    this.tryApplyDeferredTarget();
  }

  private publishLocalFallbackStatus(): void {
    if (!this.options.onLocalFallbackStatus) return;
    const active = this.listPendingAsks()[0];
    if (!active) {
      this.options.onLocalFallbackStatus(undefined);
      return;
    }
    const values = [...active.options.map((option) => option.value), OTHER_OPTION_VALUE].join(",");
    const deferred = this.deferredTargetUrl ? ` Active-local switch to ${this.deferredTargetUrl} is deferred until pinned Postbox work is resolved.` : "";
    this.options.onLocalFallbackStatus({
      requestId: active.requestId,
      serverUrl: this.currentServerUrl,
      message: `Postbox waiting ${active.requestId}. Open ${this.currentServerUrl} to answer. Local fallback: /postbox-answer ${active.requestId} ${values} [--note ...] or /postbox-cancel ${active.requestId} [--note ...]${deferred}`
    });
  }

  private isConnected(): boolean {
    return !!this.socket && this.socket.readyState === WebSocket.OPEN;
  }

  private recordConnectionDiagnostic(diagnostic: string): void {
    this.connectionDiagnostics = [...new Set([...this.connectionDiagnostics, diagnostic])].slice(-5);
  }

  private scheduleReconnect(): void {
    if (this.stopped || !this.reconnect) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const delay = this.nextReconnectMs;
    this.nextReconnectMs = Math.min(this.nextReconnectMs * 2, this.reconnectMaxMs);
    this.reconnectTimer = setTimeout(() => {
      void this.reconnectToResolvedTarget();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private activeLocalPollingEnabled(): boolean {
    return !!this.options.resolveTarget && this.options.activeLocalPollingEnabled !== false;
  }

  private startActiveLocalPolling(): void {
    if (!this.activeLocalPollingEnabled()) return;
    if (this.activeLocalPollTimer) clearInterval(this.activeLocalPollTimer);
    const intervalMs = this.options.activeLocalPollMs ?? DEFAULT_ACTIVE_LOCAL_POLL_MS;
    this.activeLocalPollTimer = setInterval(() => {
      void this.checkForActiveLocalTargetChange();
    }, intervalMs);
    this.activeLocalPollTimer.unref?.();
  }

  private async reconnectToResolvedTarget(): Promise<void> {
    if (this.stopped) return;
    await this.checkForActiveLocalTargetChange({ connectWhenDisconnected: false });
    if (this.stopped) return;
    this.connect();
  }

  private async checkForActiveLocalTargetChange(options: { connectWhenDisconnected?: boolean } = {}): Promise<void> {
    if (this.stopped || !this.activeLocalPollingEnabled() || !this.options.resolveTarget) return;

    let result: ResolveActiveLocalTargetResult;
    try {
      result = await this.options.resolveTarget();
    } catch (error) {
      this.options.onStatus?.(`target-resolve-error:${messageFrom(error)}`);
      return;
    }

    if (this.stopped || result.status !== "selected") return;
    const targetUrl = result.target.url;
    if (targetUrl === this.currentServerUrl && !this.deferredTargetUrl) return;

    if (this.hasPinnedWorkBlocking(targetUrl)) {
      this.deferTargetSwitch(targetUrl);
      return;
    }

    this.deferredTargetUrl = undefined;
    this.currentTargetSource = result.target.source;
    this.currentTargetRole = result.target.role;
    if (targetUrl === this.currentServerUrl) return;
    this.retargetNow(targetUrl, options.connectWhenDisconnected ?? true);
  }

  private deferTargetSwitch(targetUrl: string): void {
    this.deferredTargetUrl = targetUrl;
    this.options.onStatus?.(`target-switch-deferred:${targetUrl}`);
    this.startTargetAffinityTimersForPinnedWork();
    this.publishLocalFallbackStatus();
  }

  private tryApplyDeferredTarget(): void {
    if (this.stopped || !this.deferredTargetUrl || this.hasPinnedWorkBlocking(this.deferredTargetUrl)) return;
    const targetUrl = this.deferredTargetUrl;
    this.deferredTargetUrl = undefined;
    if (targetUrl !== this.currentServerUrl) this.retargetNow(targetUrl, true);
    this.publishLocalFallbackStatus();
  }

  private retargetNow(targetUrl: string, connectWhenDisconnected: boolean): void {
    this.currentServerUrl = targetUrl;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    const socket = this.socket;
    const shouldConnect = !socket || socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING || connectWhenDisconnected;
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      this.suppressReconnectOnClose.add(socket);
      socket.close();
    }
    if (shouldConnect) this.connect();
  }

  private hasPinnedWorkBlocking(targetUrl: string): boolean {
    for (const pending of this.pendingAsks.values()) {
      if (pending.sentAtLeastOnce && pending.originServerUrl && pending.originServerUrl !== targetUrl) return true;
    }
    for (const resolution of this.localResolutions.values()) {
      if (resolution.originServerUrl !== targetUrl) return true;
    }
    return false;
  }

  private startTargetAffinityTimersForDisconnectedOrigin(): void {
    for (const pending of this.pendingAsks.values()) {
      if (pending.sentAtLeastOnce && pending.originServerUrl === this.currentServerUrl) {
        this.startTargetAffinityTimer(pending);
      }
    }
    for (const [requestId, resolution] of this.localResolutions) {
      if (resolution.originServerUrl === this.currentServerUrl) {
        this.startLocalResolutionTargetAffinityTimer(requestId, resolution);
      }
    }
  }

  private startTargetAffinityTimersForPinnedWork(): void {
    for (const pending of this.pendingAsks.values()) {
      if (pending.sentAtLeastOnce) this.startTargetAffinityTimer(pending);
    }
    for (const [requestId, resolution] of this.localResolutions) {
      this.startLocalResolutionTargetAffinityTimer(requestId, resolution);
    }
  }

  private startTargetAffinityTimer(pending: PendingAsk): void {
    if (pending.targetAffinityTimer) return;
    pending.targetAffinityTimer = setTimeout(() => {
      pending.targetAffinityTimer = undefined;
      if (!this.pendingAsks.has(pending.payload.requestId)) return;
      pending.resolve(
        unavailableResult(
          pending.payload.requestId,
          "Pinned Postbox request became undeliverable because its origin target is unavailable."
        )
      );
    }, this.options.targetAffinityTimeoutMs ?? DEFAULT_TARGET_AFFINITY_TIMEOUT_MS);
    pending.targetAffinityTimer.unref?.();
  }

  private startLocalResolutionTargetAffinityTimer(requestId: string, resolution: LocalResolution): void {
    if (resolution.targetAffinityTimer) return;
    resolution.targetAffinityTimer = setTimeout(() => {
      resolution.targetAffinityTimer = undefined;
      if (this.localResolutions.get(requestId) !== resolution) return;
      this.deleteLocalResolution(requestId);
      this.options.onStatus?.(
        `target-affinity-undeliverable:${requestId}:origin ${resolution.originServerUrl} unavailable before local resolution could be delivered`
      );
      this.tryApplyDeferredTarget();
    }, this.options.targetAffinityTimeoutMs ?? DEFAULT_TARGET_AFFINITY_TIMEOUT_MS);
    resolution.targetAffinityTimer.unref?.();
  }

  private deleteLocalResolution(requestId: string): void {
    const resolution = this.localResolutions.get(requestId);
    if (!resolution) return;
    if (resolution.targetAffinityTimer) clearTimeout(resolution.targetAffinityTimer);
    this.localResolutions.delete(requestId);
  }
}

export function toExtensionSocketUrl(serverUrl: string): string {
  const url = new URL(serverUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/api/extension/ws";
  url.search = "";
  return url.toString();
}

function unavailableResult(requestId: string, rationale: string): AskResult {
  return { status: "unavailable", requestId, rationale, resolvedAt: new Date().toISOString() };
}

function expiredResult(requestId: string): AskResult {
  return {
    status: "expired",
    requestId,
    rationale: "Postbox request expired before an answer was submitted.",
    resolvedAt: new Date().toISOString()
  };
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class LocalFallbackError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "LocalFallbackError";
  }
}
