import {
  QUESTION_CHAT_RETRY_AFTER_MS_MAX,
  QuestionChatActivationResponseSchema,
  QuestionChatEventSchema,
  QuestionChatSendResponseSchema,
  QuestionChatSnapshotSchema,
  QuestionChatStopResponseSchema,
  type ExtensionServerMessage,
  type QuestionChatActivationResponse,
  type QuestionChatAvailabilityError,
  type QuestionChatContextSource,
  type QuestionChatEvent,
  type QuestionChatSendPayload,
  type QuestionChatSendResponse,
  type QuestionChatSnapshot,
  type QuestionChatStreamEvent,
  type QuestionChatSource,
  type QuestionChatStopPayload,
  type QuestionChatStopResponse
} from "@pi-postbox/protocol";
import { createHash, randomUUID } from "node:crypto";
import type { WebSocket } from "ws";

interface BoundExtension {
  connectionId: string;
  socket: WebSocket;
}

export interface QuestionChatRelayOptions {
  commandTimeoutMs?: number;
  now?: () => number;
  authorize?: (requestId: string, ownerSessionId: string) => QuestionChatAvailabilityError | undefined;
  commandRateLimitMax?: number;
  commandRateLimitWindowMs?: number;
  commandDedupeTtlMs?: number;
  commandDedupeCapacity?: number;
}

type PendingKind = "activate-exact" | "activate-context" | "snapshot" | "send" | "stop";
export interface QuestionChatIdentity {
  requestId: string;
  ownerSessionId: string;
  forkKind: "exact" | "context-only";
}
interface PendingCommand {
  kind: PendingKind;
  connectionId: string;
  identity: QuestionChatIdentity;
  resolve(response: unknown): void;
  timer: NodeJS.Timeout;
}

export type QuestionChatCommandResult<T> = { status: "ok"; value: T } | { status: "unavailable"; error: QuestionChatAvailabilityError };
export type QuestionChatTerminalReason = "answered" | "cancelled" | "expired" | "session_shutdown";
type QuestionChatCleanupReason = QuestionChatTerminalReason | "missing" | "wrong_owner";
type BrowserCommandKind = "send" | "stop";
interface RetainedBrowserCommand {
  kind: BrowserCommandKind;
  fingerprint: string;
  result: Promise<QuestionChatCommandResult<unknown>>;
  settled: boolean;
  expiresAt: number;
}

const DEFAULT_COMMAND_TIMEOUT_MS = 10_000;
const DEFAULT_RATE_LIMIT_MAX = 30;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_DEDUPE_TTL_MS = 5 * 60_000;
const DEFAULT_DEDUPE_CAPACITY = 256;
const RATE_BUCKET_CAPACITY = 1_024;
const RETAINED_REQUEST_CAPACITY = 1_024;
const MAX_COMMAND_TIMEOUT_MS = 60_000;
const MAX_RATE_LIMIT_COMMANDS = 10_000;
const MAX_DEDUPE_TTL_MS = 60 * 60_000;
const MAX_DEDUPE_CAPACITY = 4_096;

export class QuestionChatRelay {
  private readonly extensions = new Map<string, BoundExtension>();
  private readonly pending = new Map<string, PendingCommand>();
  private readonly activeChats = new Map<string, QuestionChatIdentity>();
  private readonly reconcilingSessions = new Set<string>();
  private readonly subscribers = new Map<string, Set<(event: QuestionChatStreamEvent) => void>>();
  private readonly deferredCleanup = new Map<string, { identity: QuestionChatIdentity; reason: QuestionChatCleanupReason }>();
  private readonly retainedBrowserCommands = new Map<string, Map<string, RetainedBrowserCommand>>();
  private readonly rateBuckets = new Map<string, number[]>();
  private readonly commandTimeoutMs: number;
  private readonly now: () => number;
  private readonly authorize: QuestionChatRelayOptions["authorize"];
  private readonly commandRateLimitMax: number;
  private readonly commandRateLimitWindowMs: number;
  private readonly commandDedupeTtlMs: number;
  private readonly commandDedupeCapacity: number;

  constructor(options: QuestionChatRelayOptions | number = {}) {
    const configured = typeof options === "number" ? { commandTimeoutMs: options } : options;
    this.commandTimeoutMs = finitePositiveInteger(configured.commandTimeoutMs, DEFAULT_COMMAND_TIMEOUT_MS, MAX_COMMAND_TIMEOUT_MS);
    this.now = configured.now ?? (() => Date.now());
    this.authorize = configured.authorize;
    this.commandRateLimitMax = finitePositiveInteger(configured.commandRateLimitMax, DEFAULT_RATE_LIMIT_MAX, MAX_RATE_LIMIT_COMMANDS);
    this.commandRateLimitWindowMs = finitePositiveInteger(
      configured.commandRateLimitWindowMs,
      DEFAULT_RATE_LIMIT_WINDOW_MS,
      QUESTION_CHAT_RETRY_AFTER_MS_MAX
    );
    this.commandDedupeTtlMs = finitePositiveInteger(configured.commandDedupeTtlMs, DEFAULT_DEDUPE_TTL_MS, MAX_DEDUPE_TTL_MS);
    this.commandDedupeCapacity = finitePositiveInteger(configured.commandDedupeCapacity, DEFAULT_DEDUPE_CAPACITY, MAX_DEDUPE_CAPACITY);
  }

  bind(sessionId: string, connectionId: string, socket: WebSocket): void {
    this.extensions.set(sessionId, { connectionId, socket });
    this.reconcilingSessions.add(sessionId);
    for (const [requestId, cleanup] of this.deferredCleanup) {
      if (!this.assertOwner(cleanup.identity, sessionId)) continue;
      this.send(socket, { type: "chat.cleanup", payload: { requestId: cleanup.identity.requestId, reason: cleanup.reason } });
      this.deferredCleanup.delete(requestId);
      this.activeChats.delete(requestId);
    }
  }

  unbind(connectionId: string): void {
    for (const [sessionId, extension] of this.extensions) {
      if (extension.connectionId === connectionId) {
        this.extensions.delete(sessionId);
        this.reconcilingSessions.delete(sessionId);
        for (const requestId of this.activeRequestIds(sessionId)) {
          this.publishTransport(requestId, "offline");
        }
      }
    }
  }

  finishRecovery(sessionId: string): void {
    this.reconcilingSessions.delete(sessionId);
  }

  isLiveOwner(connectionId: string, ownerSessionId: string, requestId: string): boolean {
    const identity = this.assertOwner(this.activeChats.get(requestId), ownerSessionId);
    if (!identity) return false;
    const extension = this.extensions.get(identity.ownerSessionId);
    return extension?.connectionId === connectionId
      && extension.socket.readyState === 1;
  }

  restore(
    connectionId: string,
    ownerSessionId: string,
    forkKind: QuestionChatIdentity["forkKind"],
    snapshot: QuestionChatSnapshot
  ): boolean {
    const extension = this.extensions.get(ownerSessionId);
    if (!extension || extension.connectionId !== connectionId || snapshot.forkKind !== forkKind) return false;
    this.activeChats.set(snapshot.requestId, { requestId: snapshot.requestId, ownerSessionId, forkKind });
    this.publishTransport(snapshot.requestId, "online");
    return true;
  }

  async activate(requestId: string, ownerSessionId: string, source: QuestionChatSource, callerKey?: string): Promise<QuestionChatActivationResponse> {
    const identity: QuestionChatIdentity = { requestId, ownerSessionId, forkKind: "exact" };
    return this.activateKind(identity, "activate-exact", {
      type: "chat.activate",
      requestId: "",
      payload: { requestId, ownerSessionId, source }
    }, callerKey);
  }

  async activateContext(
    requestId: string,
    ownerSessionId: string,
    source: QuestionChatContextSource,
    callerKey?: string
  ): Promise<QuestionChatActivationResponse> {
    const identity: QuestionChatIdentity = { requestId, ownerSessionId, forkKind: "context-only" };
    return this.activateKind(identity, "activate-context", {
      type: "chat.activate-context",
      requestId: "",
      payload: { requestId, ownerSessionId, source }
    }, callerKey);
  }

  private async activateKind(
    identity: QuestionChatIdentity,
    pendingKind: Extract<PendingKind, "activate-exact" | "activate-context">,
    message: ExtensionServerMessage & { requestId: string },
    callerKey?: string
  ): Promise<QuestionChatActivationResponse> {
    const previousIdentity = this.activeChats.get(identity.requestId);
    if (
      previousIdentity &&
      (!this.assertOwner(previousIdentity, identity.ownerSessionId) || previousIdentity.forkKind !== identity.forkKind)
    ) {
      return {
        status: "unavailable",
        error: { code: "runtime_busy", message: `A ${previousIdentity.forkKind} Question Chat is already running.` }
      };
    }
    const activeAttempt = identity;
    this.activeChats.set(identity.requestId, activeAttempt);
    const result = await this.dispatch<QuestionChatSnapshot>(pendingKind, identity, message, callerKey);
    if (result.status === "unavailable") {
      // A timeout occurs after a command was sent and the extension may have
      // allocated the fork. Retain cleanup authority for a later terminal
      // transition instead of orphaning that private runtime.
      if (result.error.code !== "command_timeout" && this.activeChats.get(identity.requestId) === activeAttempt) {
        if (previousIdentity) this.activeChats.set(identity.requestId, previousIdentity);
        else this.activeChats.delete(identity.requestId);
      }
      return { status: "unavailable", error: result.error };
    }
    return QuestionChatActivationResponseSchema.parse({ status: "ready", snapshot: result.value });
  }

  snapshot(requestId: string, ownerSessionId: string): Promise<QuestionChatCommandResult<QuestionChatSnapshot>> {
    const identity = this.assertOwner(this.activeChats.get(requestId), ownerSessionId);
    if (!identity) {
      return Promise.resolve(this.inactiveResult(ownerSessionId));
    }
    return this.dispatch("snapshot", identity, {
      type: "chat.snapshot",
      requestId: "",
      payload: { requestId, ownerSessionId }
    });
  }

  sendMessage(
    requestId: string,
    ownerSessionId: string,
    command: QuestionChatSendPayload,
    callerKey?: string
  ): Promise<QuestionChatCommandResult<QuestionChatSendResponse>> {
    const identity = this.assertOwner(this.activeChats.get(requestId), ownerSessionId);
    if (!identity) {
      return Promise.resolve(this.inactiveResult(ownerSessionId));
    }
    const retained = this.replaySend(requestId, command);
    if (retained) return retained;
    const capacityError = this.commandCapacityError(requestId);
    if (capacityError) return Promise.resolve({ status: "unavailable", error: capacityError });
    const preflight = this.preflight(identity, callerKey);
    if (preflight.status === "unavailable") return Promise.resolve(preflight);
    return this.retainBrowserCommand(requestId, "send", command.clientCommandId, command, () => this.dispatchPrepared("send", identity, {
      type: "chat.send",
      requestId: "",
      payload: { requestId, ownerSessionId, command }
    }, preflight.extension));
  }

  stop(
    requestId: string,
    ownerSessionId: string,
    command: QuestionChatStopPayload,
    callerKey?: string
  ): Promise<QuestionChatCommandResult<QuestionChatStopResponse>> {
    const identity = this.assertOwner(this.activeChats.get(requestId), ownerSessionId);
    if (!identity) {
      return Promise.resolve(this.inactiveResult(ownerSessionId));
    }
    const retained = this.replayStop(requestId, command);
    if (retained) return retained;
    const capacityError = this.commandCapacityError(requestId);
    if (capacityError) return Promise.resolve({ status: "unavailable", error: capacityError });
    const preflight = this.preflight(identity, callerKey);
    if (preflight.status === "unavailable") return Promise.resolve(preflight);
    return this.retainBrowserCommand(requestId, "stop", command.clientCommandId, command, () => this.dispatchPrepared("stop", identity, {
      type: "chat.stop",
      requestId: "",
      payload: { requestId, ownerSessionId, command }
    }, preflight.extension));
  }

  replaySend(requestId: string, command: QuestionChatSendPayload): Promise<QuestionChatCommandResult<QuestionChatSendResponse>> | undefined {
    return this.replayBrowserCommand(requestId, "send", command.clientCommandId, command) as
      Promise<QuestionChatCommandResult<QuestionChatSendResponse>> | undefined;
  }

  replayStop(requestId: string, command: QuestionChatStopPayload): Promise<QuestionChatCommandResult<QuestionChatStopResponse>> | undefined {
    return this.replayBrowserCommand(requestId, "stop", command.clientCommandId, command) as
      Promise<QuestionChatCommandResult<QuestionChatStopResponse>> | undefined;
  }

  resolveReady(commandId: string, connectionId: string, snapshot: QuestionChatSnapshot): void {
    const pending = this.pending.get(commandId);
    if (!pending || (pending.kind !== "activate-exact" && pending.kind !== "activate-context")) return;
    const normalized = QuestionChatSnapshotSchema.parse(snapshot);
    const expectedKind = pending.kind === "activate-exact" ? "exact" : "context-only";
    if (normalized.forkKind !== expectedKind) {
      this.resolveError(commandId, connectionId, normalized.requestId, {
        code: "runtime_failure",
        message: `Question Chat returned a ${normalized.forkKind} runtime for a requested ${expectedKind} activation.`
      });
      return;
    }
    this.resolve(commandId, connectionId, pending.kind, normalized.requestId, normalized);
  }

  resolveSnapshot(commandId: string, connectionId: string, snapshot: QuestionChatSnapshot): void {
    this.resolve(commandId, connectionId, "snapshot", snapshot.requestId, QuestionChatSnapshotSchema.parse(snapshot));
  }

  resolveSend(commandId: string, connectionId: string, requestId: string, response: QuestionChatSendResponse): void {
    this.resolve(commandId, connectionId, "send", requestId, QuestionChatSendResponseSchema.parse(response));
  }

  resolveStop(commandId: string, connectionId: string, requestId: string, response: QuestionChatStopResponse): void {
    this.resolve(commandId, connectionId, "stop", requestId, QuestionChatStopResponseSchema.parse(response));
  }

  resolveError(commandId: string, connectionId: string, requestId: string, error: QuestionChatAvailabilityError): void {
    const pending = this.pending.get(commandId);
    if (!pending || pending.connectionId !== connectionId || pending.identity.requestId !== requestId) return;
    clearTimeout(pending.timer);
    this.pending.delete(commandId);
    pending.resolve({ status: "unavailable", error });
  }

  publishEvent(connectionId: string, event: QuestionChatEvent): void {
    const normalized = QuestionChatEventSchema.parse(event);
    const ownerSessionId = this.activeChats.get(normalized.requestId)?.ownerSessionId;
    const extension = ownerSessionId ? this.extensions.get(ownerSessionId) : undefined;
    if (!extension || extension.connectionId !== connectionId || this.authorize?.(normalized.requestId, ownerSessionId!)) return;
    for (const listener of this.subscribers.get(normalized.requestId) ?? []) listener(normalized);
  }

  subscribe(requestId: string, listener: (event: QuestionChatStreamEvent) => void): () => void {
    let listeners = this.subscribers.get(requestId);
    if (!listeners) {
      listeners = new Set();
      this.subscribers.set(requestId, listeners);
    }
    listeners.add(listener);
    const active = this.activeChats.get(requestId);
    if (active) {
      const extension = this.extensions.get(active.ownerSessionId);
      if (extension?.socket.readyState !== 1) listener({ requestId, type: "transport", state: "offline" });
    }
    return () => {
      listeners?.delete(listener);
      if (listeners?.size === 0) this.subscribers.delete(requestId);
    };
  }

  cleanup(requestId: string, ownerSessionId: string, reason: QuestionChatTerminalReason): void {
    const identity = this.assertOwner(this.activeChats.get(requestId), ownerSessionId);
    if (!identity) return;
    for (const [commandId, pending] of this.pending) {
      if (
        pending.identity.requestId !== identity.requestId ||
        pending.identity.forkKind !== identity.forkKind ||
        !this.assertOwner(pending.identity, identity.ownerSessionId)
      ) continue;
      clearTimeout(pending.timer);
      this.pending.delete(commandId);
      pending.resolve(unavailableResult("request_not_pending", "The Question became terminal while Chat was active."));
    }
    this.subscribers.delete(requestId);
    const extension = this.extensions.get(ownerSessionId);
    if (!extension || extension.socket.readyState !== 1) {
      this.deferredCleanup.set(requestId, { identity, reason });
      return;
    }
    this.send(extension.socket, { type: "chat.cleanup", payload: { requestId, reason } });
    this.activeChats.delete(requestId);
  }

  rejectRecovery(identity: QuestionChatIdentity, reason: QuestionChatCleanupReason): void {
    const { requestId, ownerSessionId } = identity;
    this.activeChats.delete(requestId);
    const extension = this.extensions.get(ownerSessionId);
    if (!extension || extension.socket.readyState !== 1) {
      this.deferredCleanup.set(requestId, { identity, reason });
      return;
    }
    this.send(extension.socket, { type: "chat.cleanup", payload: { requestId, reason } });
  }

  close(): void {
    for (const [commandId, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.resolve(unavailableResult("extension_offline", "The Postbox server stopped before Chat responded."));
      this.pending.delete(commandId);
    }
    this.extensions.clear();
    this.activeChats.clear();
    this.subscribers.clear();
    this.deferredCleanup.clear();
    this.reconcilingSessions.clear();
    this.retainedBrowserCommands.clear();
    this.rateBuckets.clear();
  }

  private dispatch<T>(
    kind: PendingKind,
    identity: QuestionChatIdentity,
    message: ExtensionServerMessage & { requestId: string },
    callerKey?: string
  ): Promise<QuestionChatCommandResult<T>> {
    const preflight = this.preflight(identity, callerKey);
    if (preflight.status === "unavailable") return Promise.resolve(preflight);
    return this.dispatchPrepared(kind, identity, message, preflight.extension);
  }

  private dispatchPrepared<T>(
    kind: PendingKind,
    identity: QuestionChatIdentity,
    message: ExtensionServerMessage & { requestId: string },
    extension: BoundExtension
  ): Promise<QuestionChatCommandResult<T>> {
    const commandId = `chat_${randomUUID()}`;
    const response = new Promise<QuestionChatCommandResult<T>>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(commandId);
        resolve(unavailableResult("command_timeout", "The originating Pi extension did not respond in time."));
      }, this.commandTimeoutMs);
      timer.unref?.();
      this.pending.set(commandId, { kind, connectionId: extension.connectionId, identity, resolve, timer });
    });
    try {
      this.send(extension.socket, { ...message, requestId: commandId });
    } catch {
      const pending = this.pending.get(commandId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(commandId);
        pending.resolve(unavailableResult("extension_offline", "The originating Pi extension disconnected before the command was sent."));
      }
    }
    return response;
  }

  private preflight(
    identity: QuestionChatIdentity,
    callerKey?: string
  ): { status: "ok"; extension: BoundExtension } | { status: "unavailable"; error: QuestionChatAvailabilityError } {
    const authorizationError = this.authorize?.(identity.requestId, identity.ownerSessionId);
    if (authorizationError) return { status: "unavailable", error: authorizationError };
    const extension = this.extensions.get(identity.ownerSessionId);
    if (!extension || extension.socket.readyState !== 1) {
      return unavailableResult("extension_offline", "The originating Pi extension is offline. Retry when it reconnects.");
    }
    if (callerKey) {
      const rateError = this.consumeRateLimit(callerKey, identity.requestId);
      if (rateError) return { status: "unavailable", error: rateError };
    }
    return { status: "ok", extension };
  }

  private resolve(commandId: string, connectionId: string, kind: PendingKind, requestId: string, value: unknown): void {
    const pending = this.pending.get(commandId);
    if (!pending || pending.connectionId !== connectionId || pending.kind !== kind || pending.identity.requestId !== requestId) return;
    const authorizationError = this.authorize?.(requestId, pending.identity.ownerSessionId);
    clearTimeout(pending.timer);
    this.pending.delete(commandId);
    pending.resolve(authorizationError ? { status: "unavailable", error: authorizationError } : { status: "ok", value });
  }

  private replayBrowserCommand(
    requestId: string,
    kind: BrowserCommandKind,
    commandId: string,
    payload: unknown
  ): Promise<QuestionChatCommandResult<unknown>> | undefined {
    this.pruneRetainedCommands();
    const retained = this.retainedBrowserCommands.get(requestId)?.get(commandId);
    if (!retained) return undefined;
    if (retained.kind !== kind || retained.fingerprint !== commandFingerprint(kind, payload)) {
      return Promise.resolve(unavailableResult(
        "duplicate_command",
        "This command ID was already used for different Question Chat input."
      ));
    }
    return retained.result;
  }

  private retainBrowserCommand<T>(
    requestId: string,
    kind: BrowserCommandKind,
    commandId: string,
    payload: unknown,
    run: () => Promise<QuestionChatCommandResult<T>>
  ): Promise<QuestionChatCommandResult<T>> {
    this.pruneRetainedCommands();
    let commands = this.retainedBrowserCommands.get(requestId);
    if (!commands) {
      while (this.retainedBrowserCommands.size >= RETAINED_REQUEST_CAPACITY) {
        const removable = [...this.retainedBrowserCommands].find(([, retained]) =>
          [...retained.values()].every((command) => command.settled)
        );
        if (!removable) {
          return Promise.resolve(unavailableResult("rate_limited", "Question Chat has too many commands in flight.", 1));
        }
        this.retainedBrowserCommands.delete(removable[0]);
      }
      commands = new Map();
      this.retainedBrowserCommands.set(requestId, commands);
    }
    while (commands.size >= this.commandDedupeCapacity) {
      const removable = [...commands].find(([, retained]) => retained.settled);
      if (!removable) {
        return Promise.resolve(unavailableResult("rate_limited", "Question Chat has too many commands in flight.", 1));
      }
      commands.delete(removable[0]);
    }
    const result = run();
    const retained: RetainedBrowserCommand = {
      kind,
      fingerprint: commandFingerprint(kind, payload),
      result: result as Promise<QuestionChatCommandResult<unknown>>,
      settled: false,
      expiresAt: Number.POSITIVE_INFINITY
    };
    commands.set(commandId, retained);
    void result.finally(() => {
      retained.settled = true;
      retained.expiresAt = this.now() + this.commandDedupeTtlMs;
    }).catch(() => undefined);
    return result;
  }

  private commandCapacityError(requestId: string): QuestionChatAvailabilityError | undefined {
    this.pruneRetainedCommands();
    const commands = this.retainedBrowserCommands.get(requestId);
    const hasPerRequestCapacity = !commands
      || commands.size < this.commandDedupeCapacity
      || [...commands.values()].some((retained) => retained.settled);
    const hasRequestCapacity = Boolean(commands)
      || this.retainedBrowserCommands.size < RETAINED_REQUEST_CAPACITY
      || [...this.retainedBrowserCommands.values()].some((retained) =>
        [...retained.values()].every((command) => command.settled)
      );
    if (hasPerRequestCapacity && hasRequestCapacity) {
      return undefined;
    }
    return {
      code: "rate_limited",
      message: "Question Chat has too many commands in flight.",
      retryAfterMs: 1
    };
  }

  private pruneRetainedCommands(): void {
    const now = this.now();
    for (const [retainedRequestId, commands] of this.retainedBrowserCommands) {
      for (const [commandId, retained] of commands) {
        if (retained.settled && retained.expiresAt <= now) commands.delete(commandId);
      }
      if (commands.size === 0) this.retainedBrowserCommands.delete(retainedRequestId);
    }
  }

  private consumeRateLimit(callerKey: string, requestId: string): QuestionChatAvailabilityError | undefined {
    const now = this.now();
    const cutoff = now - this.commandRateLimitWindowMs;
    for (const [key, timestamps] of this.rateBuckets) {
      const active = timestamps.filter((timestamp) => timestamp > cutoff);
      if (active.length === 0) this.rateBuckets.delete(key);
      else if (active.length !== timestamps.length) this.rateBuckets.set(key, active);
    }
    const key = `${callerKey}\u0000${requestId}`;
    const timestamps = this.rateBuckets.get(key) ?? [];
    if (timestamps.length >= this.commandRateLimitMax) {
      return {
        code: "rate_limited",
        message: "Question Chat command rate limit exceeded.",
        retryAfterMs: Math.min(
          QUESTION_CHAT_RETRY_AFTER_MS_MAX,
          Math.max(1, timestamps[0]! + this.commandRateLimitWindowMs - now)
        )
      };
    }
    if (!this.rateBuckets.has(key) && this.rateBuckets.size >= RATE_BUCKET_CAPACITY) {
      this.rateBuckets.delete(this.rateBuckets.keys().next().value!);
    }
    timestamps.push(now);
    this.rateBuckets.set(key, timestamps);
    return undefined;
  }

  private send(socket: WebSocket, message: ExtensionServerMessage): void {
    socket.send(JSON.stringify(message));
  }

  private assertOwner(identity: QuestionChatIdentity | undefined, ownerSessionId: string): QuestionChatIdentity | undefined {
    return identity?.ownerSessionId === ownerSessionId ? identity : undefined;
  }

  private inactiveResult(ownerSessionId: string): { status: "unavailable"; error: QuestionChatAvailabilityError } {
    const extension = this.extensions.get(ownerSessionId);
    if (!extension || extension.socket.readyState !== 1 || this.reconcilingSessions.has(ownerSessionId)) {
      return unavailableResult("extension_offline", "The originating Pi extension is offline or still recovering Chat. Retry when it reconnects.");
    }
    return unavailableResult("chat_not_started", "Start Question Chat before fetching its snapshot.");
  }

  private activeRequestIds(ownerSessionId: string): string[] {
    return [...this.activeChats]
      .filter(([, identity]) => Boolean(this.assertOwner(identity, ownerSessionId)))
      .map(([requestId]) => requestId);
  }

  private publishTransport(requestId: string, state: "offline" | "online"): void {
    const event: QuestionChatStreamEvent = { requestId, type: "transport", state };
    for (const listener of this.subscribers.get(requestId) ?? []) listener(event);
  }
}

function unavailableResult(
  code: QuestionChatAvailabilityError["code"],
  message: string,
  retryAfterMs?: number
): { status: "unavailable"; error: QuestionChatAvailabilityError } {
  return { status: "unavailable", error: { code, message, ...(retryAfterMs ? { retryAfterMs } : {}) } };
}

function commandFingerprint(kind: BrowserCommandKind, payload: unknown): string {
  return createHash("sha256").update(`${kind}\u0000${JSON.stringify(payload)}`).digest("hex");
}

function finitePositiveInteger(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(1, Math.floor(value)));
}
