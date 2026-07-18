import {
  QuestionChatActivationResponseSchema,
  QuestionChatEventSchema,
  QuestionChatSendResponseSchema,
  QuestionChatSnapshotSchema,
  type ExtensionServerMessage,
  type QuestionChatActivationResponse,
  type QuestionChatAvailabilityError,
  type QuestionChatEvent,
  type QuestionChatSendPayload,
  type QuestionChatSendResponse,
  type QuestionChatSnapshot,
  type QuestionChatSource
} from "@pi-postbox/protocol";
import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";

interface BoundExtension {
  connectionId: string;
  socket: WebSocket;
}

type PendingKind = "activate" | "snapshot" | "send";
interface PendingCommand {
  kind: PendingKind;
  connectionId: string;
  requestId: string;
  ownerSessionId: string;
  resolve(response: unknown): void;
  timer: NodeJS.Timeout;
}

export type QuestionChatCommandResult<T> = { status: "ok"; value: T } | { status: "unavailable"; error: QuestionChatAvailabilityError };
export type QuestionChatTerminalReason = "answered" | "cancelled" | "expired" | "session_shutdown";

export class QuestionChatRelay {
  private readonly extensions = new Map<string, BoundExtension>();
  private readonly pending = new Map<string, PendingCommand>();
  private readonly activeChats = new Map<string, string>();
  private readonly subscribers = new Map<string, Set<(event: QuestionChatEvent) => void>>();
  private readonly deferredCleanup = new Map<string, { requestId: string; reason: QuestionChatTerminalReason }>();

  constructor(private readonly commandTimeoutMs = 10_000) {}

  bind(sessionId: string, connectionId: string, socket: WebSocket): void {
    this.extensions.set(sessionId, { connectionId, socket });
    for (const [requestId, cleanup] of this.deferredCleanup) {
      if (this.activeChats.get(requestId) !== sessionId) continue;
      this.send(socket, { type: "chat.cleanup", payload: cleanup });
      this.deferredCleanup.delete(requestId);
      this.activeChats.delete(requestId);
    }
  }

  unbind(connectionId: string): void {
    for (const [sessionId, extension] of this.extensions) {
      if (extension.connectionId === connectionId) this.extensions.delete(sessionId);
    }
  }

  async activate(requestId: string, ownerSessionId: string, source: QuestionChatSource): Promise<QuestionChatActivationResponse> {
    this.activeChats.set(requestId, ownerSessionId);
    const result = await this.dispatch<QuestionChatSnapshot>("activate", requestId, ownerSessionId, {
      type: "chat.activate",
      requestId: "",
      payload: { requestId, ownerSessionId, source }
    });
    if (result.status === "unavailable") {
      // A timeout occurs after a command was sent and the extension may have
      // allocated the fork. Retain cleanup authority for a later terminal
      // transition instead of orphaning that private runtime.
      if (result.error.code !== "command_timeout") this.activeChats.delete(requestId);
      return { status: "unavailable", error: result.error };
    }
    return QuestionChatActivationResponseSchema.parse({ status: "ready", snapshot: result.value });
  }

  snapshot(requestId: string, ownerSessionId: string): Promise<QuestionChatCommandResult<QuestionChatSnapshot>> {
    if (this.activeChats.get(requestId) !== ownerSessionId) {
      return Promise.resolve(unavailableResult("chat_not_started", "Start Question Chat before fetching its snapshot."));
    }
    return this.dispatch("snapshot", requestId, ownerSessionId, {
      type: "chat.snapshot",
      requestId: "",
      payload: { requestId, ownerSessionId }
    });
  }

  sendMessage(
    requestId: string,
    ownerSessionId: string,
    command: QuestionChatSendPayload
  ): Promise<QuestionChatCommandResult<QuestionChatSendResponse>> {
    if (this.activeChats.get(requestId) !== ownerSessionId) {
      return Promise.resolve(unavailableResult("chat_not_started", "Start Question Chat before sending a message."));
    }
    return this.dispatch("send", requestId, ownerSessionId, {
      type: "chat.send",
      requestId: "",
      payload: { requestId, ownerSessionId, command }
    });
  }

  resolveReady(commandId: string, connectionId: string, snapshot: QuestionChatSnapshot): void {
    this.resolve(commandId, connectionId, "activate", snapshot.requestId, QuestionChatSnapshotSchema.parse(snapshot));
  }

  resolveSnapshot(commandId: string, connectionId: string, snapshot: QuestionChatSnapshot): void {
    this.resolve(commandId, connectionId, "snapshot", snapshot.requestId, QuestionChatSnapshotSchema.parse(snapshot));
  }

  resolveSend(commandId: string, connectionId: string, requestId: string, response: QuestionChatSendResponse): void {
    this.resolve(commandId, connectionId, "send", requestId, QuestionChatSendResponseSchema.parse(response));
  }

  resolveError(commandId: string, connectionId: string, requestId: string, error: QuestionChatAvailabilityError): void {
    const pending = this.pending.get(commandId);
    if (!pending || pending.connectionId !== connectionId || pending.requestId !== requestId) return;
    if (pending.kind === "activate" && this.activeChats.get(pending.requestId) === pending.ownerSessionId) {
      this.activeChats.delete(pending.requestId);
    }
    clearTimeout(pending.timer);
    this.pending.delete(commandId);
    pending.resolve({ status: "unavailable", error });
  }

  publishEvent(connectionId: string, event: QuestionChatEvent): void {
    const normalized = QuestionChatEventSchema.parse(event);
    const ownerSessionId = this.activeChats.get(normalized.requestId);
    const extension = ownerSessionId ? this.extensions.get(ownerSessionId) : undefined;
    if (!extension || extension.connectionId !== connectionId) return;
    for (const listener of this.subscribers.get(normalized.requestId) ?? []) listener(normalized);
  }

  subscribe(requestId: string, listener: (event: QuestionChatEvent) => void): () => void {
    let listeners = this.subscribers.get(requestId);
    if (!listeners) {
      listeners = new Set();
      this.subscribers.set(requestId, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners?.delete(listener);
      if (listeners?.size === 0) this.subscribers.delete(requestId);
    };
  }

  cleanup(requestId: string, ownerSessionId: string, reason: QuestionChatTerminalReason): void {
    if (this.activeChats.get(requestId) !== ownerSessionId) return;
    for (const [commandId, pending] of this.pending) {
      if (pending.requestId !== requestId || pending.ownerSessionId !== ownerSessionId) continue;
      clearTimeout(pending.timer);
      this.pending.delete(commandId);
      pending.resolve(unavailableResult("request_not_pending", "The Question became terminal while Chat was active."));
    }
    this.subscribers.delete(requestId);
    const extension = this.extensions.get(ownerSessionId);
    if (!extension || extension.socket.readyState !== 1) {
      this.deferredCleanup.set(requestId, { requestId, reason });
      return;
    }
    this.send(extension.socket, { type: "chat.cleanup", payload: { requestId, reason } });
    this.activeChats.delete(requestId);
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
  }

  private dispatch<T>(
    kind: PendingKind,
    requestId: string,
    ownerSessionId: string,
    message: ExtensionServerMessage & { requestId: string }
  ): Promise<QuestionChatCommandResult<T>> {
    const extension = this.extensions.get(ownerSessionId);
    if (!extension || extension.socket.readyState !== 1) {
      return Promise.resolve(unavailableResult("extension_offline", "The originating Pi extension is offline. Retry when it reconnects."));
    }
    const commandId = `chat_${randomUUID()}`;
    const response = new Promise<QuestionChatCommandResult<T>>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(commandId);
        resolve(unavailableResult("command_timeout", "The originating Pi extension did not respond in time."));
      }, this.commandTimeoutMs);
      timer.unref?.();
      this.pending.set(commandId, { kind, connectionId: extension.connectionId, requestId, ownerSessionId, resolve, timer });
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

  private resolve(commandId: string, connectionId: string, kind: PendingKind, requestId: string, value: unknown): void {
    const pending = this.pending.get(commandId);
    if (!pending || pending.connectionId !== connectionId || pending.kind !== kind || pending.requestId !== requestId) return;
    clearTimeout(pending.timer);
    this.pending.delete(commandId);
    pending.resolve({ status: "ok", value });
  }

  private send(socket: WebSocket, message: ExtensionServerMessage): void {
    socket.send(JSON.stringify(message));
  }
}

function unavailableResult(code: QuestionChatAvailabilityError["code"], message: string): { status: "unavailable"; error: QuestionChatAvailabilityError } {
  return { status: "unavailable", error: { code, message } };
}
