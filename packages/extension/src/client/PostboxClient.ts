import {
  ExtensionServerMessageSchema,
  type AskAnswerPayload,
  type AskCancelPayload,
  type AskCreatePayload,
  type AskOption,
  type AskResult,
  type ExtensionClientMessage,
  type SemanticState,
  type SessionRegisterPayload
} from "@pi-postbox/protocol";
import WebSocket from "ws";

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
  WebSocketImpl?: WebSocketConstructor;
  onStatus?: (status: string) => void;
  onLocalFallbackStatus?: (status: LocalFallbackStatus | undefined) => void;
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
}

interface PendingAsk {
  payload: AskCreatePayload;
  resolve: (result: AskResult) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
  sentAtLeastOnce: boolean;
  unavailableTimer?: NodeJS.Timeout;
  expiryTimer?: NodeJS.Timeout;
}

const DEFAULT_UNAVAILABLE_AFTER_MS = 30_000;
const DEFAULT_RECONNECT_MAX_MS = 30_000;

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

  constructor(private readonly options: PostboxClientOptions) {
    this.heartbeatMs = options.heartbeatMs ?? 15_000;
    this.reconnectMs = options.reconnectMs ?? 5_000;
    this.reconnectMaxMs = options.reconnectMaxMs ?? DEFAULT_RECONNECT_MAX_MS;
    this.nextReconnectMs = this.reconnectMs;
    this.reconnect = options.reconnect ?? true;
    this.askUnavailableAfterMs = options.askUnavailableAfterMs ?? DEFAULT_UNAVAILABLE_AFTER_MS;
    this.WebSocketImpl = options.WebSocketImpl ?? (WebSocket as unknown as WebSocketConstructor);
    this.currentSemanticState = options.registration.session.semanticState;
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    for (const [, pending] of this.pendingAsks) {
      pending.cleanup();
      pending.reject(new Error("Postbox client stopped"));
    }
    this.pendingAsks.clear();
    this.localResolutions.clear();
    this.publishLocalFallbackStatus();
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

  shutdownSession(): boolean {
    return this.send({
      type: "session.shutdown",
      payload: { sessionId: this.options.registration.session.sessionId }
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
        this.publishLocalFallbackStatus();
      };
      const complete = (result: AskResult) => {
        cleanup();
        resolve(result);
      };
      const abort = () => {
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
        sentAtLeastOnce: false
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
      this.socket = new this.WebSocketImpl(toExtensionSocketUrl(this.options.serverUrl));
    } catch (error) {
      this.options.onStatus?.(`connect-error:${messageFrom(error)}`);
      this.scheduleReconnect();
      return;
    }

    const socket = this.socket;
    socket.on("open", () => {
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
      this.options.onStatus?.(`socket-error:${messageFrom(error)}`);
    });

    socket.on("close", () => {
      this.options.onStatus?.("disconnected");
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      this.scheduleReconnect();
    });
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
    const sent = this.send({ type: "ask.create", requestId: pending.payload.requestId, payload: pending.payload });
    if (sent) {
      pending.sentAtLeastOnce = true;
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
    this.localResolutions.set(pending.payload.requestId, { payload: pending.payload, result, message });
    pending.resolve(result);
    this.flushLocalResolutions();
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
    const allowed = new Set(payload.options.map((option) => option.value));
    const invalid = selectedValues.find((value) => !allowed.has(value));
    if (invalid) throw new LocalFallbackError("invalid_selection", `Unknown option value: ${invalid}`);
  }

  private flushLocalResolutions(): void {
    if (!this.isConnected()) return;
    for (const [requestId, resolution] of [...this.localResolutions]) {
      const createSent = this.send({ type: "ask.create", requestId, payload: resolution.payload });
      const resolutionSent = createSent && this.send(resolution.message);
      if (resolutionSent) this.localResolutions.delete(requestId);
    }
  }

  private publishLocalFallbackStatus(): void {
    if (!this.options.onLocalFallbackStatus) return;
    const active = this.listPendingAsks()[0];
    if (!active) {
      this.options.onLocalFallbackStatus(undefined);
      return;
    }
    const values = active.options.map((option) => option.value).join(",");
    this.options.onLocalFallbackStatus({
      requestId: active.requestId,
      message: `Postbox waiting ${active.requestId}. Local fallback: /postbox-answer ${active.requestId} ${values} [--note ...] or /postbox-cancel ${active.requestId} [--note ...]`
    });
  }

  private isConnected(): boolean {
    return !!this.socket && this.socket.readyState === WebSocket.OPEN;
  }

  private scheduleReconnect(): void {
    if (this.stopped || !this.reconnect) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const delay = this.nextReconnectMs;
    this.nextReconnectMs = Math.min(this.nextReconnectMs * 2, this.reconnectMaxMs);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
    this.reconnectTimer.unref?.();
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
