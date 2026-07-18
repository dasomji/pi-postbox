import {
  QuestionChatActivationResponseSchema,
  type ExtensionServerMessage,
  type QuestionChatActivationResponse,
  type QuestionChatAvailabilityError,
  type QuestionChatSnapshot,
  type QuestionChatSource
} from "@pi-postbox/protocol";
import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";

interface BoundExtension {
  connectionId: string;
  socket: WebSocket;
}

interface PendingActivation {
  connectionId: string;
  requestId: string;
  ownerSessionId: string;
  resolve(response: QuestionChatActivationResponse): void;
  timer: NodeJS.Timeout;
}

export type QuestionChatTerminalReason = "answered" | "cancelled" | "expired" | "session_shutdown";

export class QuestionChatRelay {
  private readonly extensions = new Map<string, BoundExtension>();
  private readonly pending = new Map<string, PendingActivation>();
  private readonly activeChats = new Map<string, string>();
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
    const extension = this.extensions.get(ownerSessionId);
    if (!extension || extension.socket.readyState !== 1) {
      return unavailable("extension_offline", "The originating Pi extension is offline. Retry when it reconnects.");
    }

    const commandId = `chat_${randomUUID()}`;
    const response = new Promise<QuestionChatActivationResponse>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(commandId);
        resolve(unavailable("command_timeout", "The originating Pi extension did not respond in time."));
      }, this.commandTimeoutMs);
      timer.unref?.();
      this.pending.set(commandId, {
        connectionId: extension.connectionId,
        requestId,
        ownerSessionId,
        resolve,
        timer
      });
    });

    // From this point the extension may have begun allocating a runtime. Track
    // it before sending so a terminal transition that races activation still
    // has cleanup authority, even if chat.ready has not arrived yet.
    this.activeChats.set(requestId, ownerSessionId);
    this.send(extension.socket, {
      type: "chat.activate",
      requestId: commandId,
      payload: { requestId, ownerSessionId, source }
    });
    return response;
  }

  resolveReady(commandId: string, connectionId: string, snapshot: QuestionChatSnapshot): void {
    this.resolve(commandId, connectionId, { status: "ready", snapshot });
  }

  resolveError(commandId: string, connectionId: string, error: QuestionChatAvailabilityError): void {
    const pending = this.pending.get(commandId);
    if (pending?.connectionId === connectionId && this.activeChats.get(pending.requestId) === pending.ownerSessionId) {
      this.activeChats.delete(pending.requestId);
    }
    this.resolve(commandId, connectionId, { status: "unavailable", error });
  }

  cleanup(requestId: string, ownerSessionId: string, reason: QuestionChatTerminalReason): void {
    if (this.activeChats.get(requestId) !== ownerSessionId) return;
    for (const [commandId, pending] of this.pending) {
      if (pending.requestId !== requestId || pending.ownerSessionId !== ownerSessionId) continue;
      clearTimeout(pending.timer);
      this.pending.delete(commandId);
      pending.resolve(unavailable("request_not_pending", "The Question became terminal while Chat was starting."));
    }
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
      pending.resolve(unavailable("extension_offline", "The Postbox server stopped before Chat became ready."));
      this.pending.delete(commandId);
    }
    this.extensions.clear();
    this.activeChats.clear();
    this.deferredCleanup.clear();
  }

  private resolve(commandId: string, connectionId: string, response: QuestionChatActivationResponse): void {
    const pending = this.pending.get(commandId);
    if (!pending || pending.connectionId !== connectionId) return;
    clearTimeout(pending.timer);
    this.pending.delete(commandId);
    pending.resolve(QuestionChatActivationResponseSchema.parse(response));
  }

  private send(socket: WebSocket, message: ExtensionServerMessage): void {
    socket.send(JSON.stringify(message));
  }
}

function unavailable(code: QuestionChatAvailabilityError["code"], message: string): QuestionChatActivationResponse {
  return { status: "unavailable", error: { code, message } };
}
