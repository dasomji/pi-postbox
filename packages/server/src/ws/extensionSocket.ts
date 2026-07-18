import {
  ExtensionClientMessageSchema,
  type ProposeAnswerErrorCode,
  type ProposeAnswerPayload,
  type ProposeAnswerResult,
  type ExtensionServerMessage
} from "@pi-postbox/protocol";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import type { StateBroadcaster } from "../services/broadcaster.js";
import type { PushNotifier } from "../services/pushNotifier.js";
import type { QuestionChatRelay } from "../services/questionChatRelay.js";
import { RequestStoreError, type RequestStore } from "../services/requestStore.js";
import type { SessionStore } from "../services/sessionStore.js";

function send(socket: WebSocket, message: ExtensionServerMessage): void {
  socket.send(JSON.stringify(message));
}

function lifecycleShutdownRationale(reason: string | undefined): string {
  if (reason === "new") return "Originating Pi session was replaced by /new.";
  if (reason === "resume") return "Originating Pi session was replaced by /resume.";
  if (reason === "fork") return "Originating Pi session was replaced by /fork.";
  if (reason === "quit") return "Originating Pi session quit.";
  return "Originating Pi session was shut down.";
}

function sendAskError(socket: WebSocket, requestId: string | undefined, fallbackCode: string, error: unknown): void {
  const isRequestError = error instanceof RequestStoreError;
  send(socket, {
    type: "error",
    requestId,
    error: {
      code: isRequestError ? error.code : fallbackCode,
      message: error instanceof Error ? error.message : String(error)
    }
  });
}

const PROPOSAL_ERROR_CODES = new Set<ProposeAnswerErrorCode>([
  "request_not_found",
  "request_terminal",
  "wrong_owner",
  "invalid_proposal",
  "duplicate_option",
  "option_value_collision",
  "option_limit_reached",
  "internal_error"
]);

function proposalError(error: unknown): ProposeAnswerResult {
  if (error instanceof RequestStoreError && PROPOSAL_ERROR_CODES.has(error.code as ProposeAnswerErrorCode)) {
    return {
      status: "error",
      error: { code: error.code as ProposeAnswerErrorCode, message: error.message }
    };
  }
  return { status: "error", error: { code: "internal_error", message: "Suggested option could not be appended." } };
}

export async function registerExtensionSocket(
  app: FastifyInstance,
  sessionStore: SessionStore,
  requestStore: RequestStore,
  broadcaster: StateBroadcaster,
  expireDue: () => unknown = () => undefined,
  pushNotifier?: PushNotifier,
  questionChatRelay?: QuestionChatRelay
): Promise<void> {
  app.get("/api/extension/ws", { websocket: true }, (socket, request) => {
    const origin = request.headers.origin;
    if (origin) {
      try {
        const originUrl = new URL(origin);
        if (request.headers.host && originUrl.host !== request.headers.host) {
          socket.close(1008, "forbidden_origin");
          return;
        }
      } catch {
        socket.close(1008, "forbidden_origin");
        return;
      }
    }

    const connectionId = randomUUID();
    const unsubscribers = new Set<() => void>();
    let registeredSessionId: string | undefined;
    let recoveryOffersComplete = false;
    const pendingRecoveries = new Map<string, {
      requestId: string;
      forkKind: "exact" | "context-only";
      disposition: "recover" | "delete";
      reason: "pending" | "missing" | "terminal" | "wrong_owner";
    }>();
    const maybeFinishRecovery = () => {
      if (registeredSessionId && recoveryOffersComplete && pendingRecoveries.size === 0) {
        questionChatRelay?.finishRecovery(registeredSessionId);
      }
    };

    socket.on("message", (raw) => {
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(raw.toString());
      } catch {
        send(socket, { type: "error", error: { code: "invalid_json", message: "Message must be JSON" } });
        return;
      }

      const result = ExtensionClientMessageSchema.safeParse(parsedJson);
      if (!result.success) {
        send(socket, {
          type: "error",
          requestId: typeof parsedJson === "object" && parsedJson && "requestId" in parsedJson ? String(parsedJson.requestId) : undefined,
          error: { code: "invalid_message", message: result.error.message }
        });
        return;
      }

      const message = result.data;
      if (message.type === "chat.recover.offer") {
        if (!registeredSessionId || recoveryOffersComplete || pendingRecoveries.size > 0 || pendingRecoveries.has(message.requestId)) {
          send(socket, {
            type: "error",
            requestId: message.requestId,
            error: { code: "invalid_recovery", message: "Question Chat recovery requires one registered, unique offer." }
          });
          return;
        }
        const snapshot = requestStore.get(message.payload.requestId);
        const reason = !snapshot
          ? "missing" as const
          : message.payload.ownerSessionId !== registeredSessionId || snapshot.sessionId !== registeredSessionId
            ? "wrong_owner" as const
            : snapshot.status !== "pending"
              ? "terminal" as const
              : "pending" as const;
        pendingRecoveries.set(message.requestId, {
          requestId: message.payload.requestId,
          forkKind: message.payload.forkKind,
          disposition: reason === "pending" ? "recover" : "delete",
          reason
        });
        send(socket, {
          type: "chat.reconcile",
          requestId: message.requestId,
          payload: reason === "pending"
            ? { requestId: message.payload.requestId, forkKind: message.payload.forkKind, action: "recover", reason }
            : { requestId: message.payload.requestId, forkKind: message.payload.forkKind, action: "delete", reason }
        });
        return;
      }

      if (message.type === "chat.recover.complete") {
        if (!registeredSessionId || recoveryOffersComplete || message.payload.ownerSessionId !== registeredSessionId) {
          send(socket, {
            type: "error",
            requestId: message.requestId,
            error: { code: "wrong_owner", message: "Question Chat recovery completion does not match the registered Pi Session." }
          });
          return;
        }
        recoveryOffersComplete = true;
        maybeFinishRecovery();
        return;
      }

      if (message.type === "chat.reconciled") {
        const pendingRecovery = pendingRecoveries.get(message.requestId);
        if (
          !registeredSessionId ||
          !pendingRecovery ||
          pendingRecovery.requestId !== message.payload.requestId ||
          pendingRecovery.forkKind !== message.payload.forkKind
        ) return;
        pendingRecoveries.delete(message.requestId);
        const current = requestStore.get(pendingRecovery.requestId);
        const stillPending = current?.status === "pending" && current.sessionId === registeredSessionId;
        if (
          pendingRecovery.disposition === "recover" &&
          stillPending &&
          message.payload.result.status === "recovered" &&
          message.payload.result.snapshot.requestId === pendingRecovery.requestId &&
          message.payload.result.snapshot.forkKind === pendingRecovery.forkKind
        ) {
          const restored = questionChatRelay?.restore(
            connectionId,
            registeredSessionId,
            pendingRecovery.forkKind,
            message.payload.result.snapshot
          );
          if (restored) send(socket, { type: "ack", requestId: message.requestId, payload: { type: "chat.reconciled" } });
        } else if (!stillPending || pendingRecovery.disposition === "delete") {
          const cleanupReason = !current
            ? "missing" as const
            : current.sessionId !== registeredSessionId
              ? "wrong_owner" as const
              : current.status === "expired"
                ? "expired" as const
                : current.status === "answered"
                  ? "answered" as const
                  : current.status === "cancelled"
                    ? "cancelled" as const
                    : pendingRecovery.reason === "wrong_owner"
                      ? "wrong_owner" as const
                      : "missing" as const;
          if (message.payload.result.status !== "deleted") {
            questionChatRelay?.rejectRecovery(pendingRecovery.requestId, registeredSessionId, cleanupReason);
          } else {
            send(socket, { type: "ack", requestId: message.requestId, payload: { type: "chat.reconciled" } });
          }
        }
        maybeFinishRecovery();
        return;
      }

      if (message.type === "chat.ready") {
        questionChatRelay?.resolveReady(message.requestId, connectionId, message.payload);
        return;
      }

      if (message.type === "chat.error") {
        questionChatRelay?.resolveError(message.requestId, connectionId, message.payload.requestId, message.payload.error);
        return;
      }

      if (message.type === "chat.snapshot") {
        questionChatRelay?.resolveSnapshot(message.requestId, connectionId, message.payload);
        return;
      }

      if (message.type === "chat.send.accepted") {
        questionChatRelay?.resolveSend(message.requestId, connectionId, message.payload.requestId, message.payload.response);
        return;
      }

      if (message.type === "chat.stop.accepted") {
        questionChatRelay?.resolveStop(message.requestId, connectionId, message.payload.requestId, message.payload.response);
        return;
      }

      if (message.type === "chat.event") {
        questionChatRelay?.publishEvent(connectionId, message.payload);
        return;
      }

      if (message.type === "chat.propose-answer") {
        const current = requestStore.get(message.payload.requestId);
        let proposalResult: ProposeAnswerResult;
        if (
          !registeredSessionId
          || (current && current.sessionId !== registeredSessionId)
          || (current?.status === "pending"
            && !questionChatRelay?.isLiveOwner(connectionId, registeredSessionId, message.payload.requestId))
        ) {
          proposalResult = {
            status: "error",
            error: { code: "wrong_owner", message: "Question Chat does not own this Question." }
          };
        } else {
          try {
            const appended = requestStore.proposeAnswer(
              message.payload.requestId,
              registeredSessionId,
              message.payload.proposal as ProposeAnswerPayload
            );
            proposalResult = { status: "appended", option: appended.option };
            broadcaster.broadcast();
          } catch (error) {
            proposalResult = proposalError(error);
          }
        }
        send(socket, {
          type: "chat.propose-answer.result",
          requestId: message.requestId,
          payload: { requestId: message.payload.requestId, result: proposalResult }
        });
        return;
      }

      if (message.type === "session.register") {
        registeredSessionId = message.payload.session.sessionId;
        recoveryOffersComplete = false;
        pendingRecoveries.clear();
        sessionStore.register(connectionId, message.payload);
        questionChatRelay?.bind(message.payload.session.sessionId, connectionId, socket);
        broadcaster.broadcast();
        send(socket, {
          type: "registered",
          requestId: message.requestId,
          payload: { sessionId: message.payload.session.sessionId, presence: "live" }
        });
        return;
      }

      if (message.type === "heartbeat") {
        sessionStore.heartbeat(connectionId, message.payload.sessionId, message.payload.semanticState);
        broadcaster.broadcast();
        send(socket, { type: "ack", requestId: message.requestId, payload: { type: "heartbeat" } });
        return;
      }

      if (message.type === "session.update") {
        sessionStore.updateSession(message.payload);
        broadcaster.broadcast();
        send(socket, { type: "ack", requestId: message.requestId, payload: { type: "session.update" } });
        return;
      }

      if (message.type === "ask.create") {
        try {
          expireDue();
          const alreadyExisted = requestStore.get(message.payload.requestId) !== undefined;
          const snapshot = requestStore.create(message.payload);
          broadcaster.broadcast();
          if (snapshot.result) {
            send(socket, { type: "ask.resolved", requestId: message.requestId, payload: snapshot.result });
            return;
          }
          send(socket, {
            type: "ask.created",
            requestId: message.requestId,
            payload: { requestId: snapshot.requestId, status: "pending" }
          });
          if (!alreadyExisted) {
            void pushNotifier?.notifyNewPendingAsk(snapshot).catch((error: unknown) => {
              app.log.warn({ error, requestId: snapshot.requestId }, "failed to send new ask push notification");
            });
          }
          const unsubscribe = requestStore.onResolved(snapshot.requestId, (result) => {
            if (socket.readyState === 1) {
              send(socket, { type: "ask.resolved", requestId: snapshot.requestId, payload: result });
            }
          });
          unsubscribers.add(unsubscribe);
        } catch (error) {
          sendAskError(socket, message.requestId, "ask_create_failed", error);
        }
        return;
      }

      if (message.type === "ask.answer") {
        try {
          expireDue();
          const result = requestStore.answer(message.payload.requestId, message.payload.answer);
          broadcaster.broadcast();
          send(socket, { type: "ask.resolved", requestId: message.requestId, payload: result });
        } catch (error) {
          sendAskError(socket, message.requestId, "ask_answer_failed", error);
        }
        return;
      }

      if (message.type === "ask.cancel") {
        try {
          expireDue();
          const result = requestStore.cancel(message.payload.requestId, message.payload.cancel);
          broadcaster.broadcast();
          send(socket, { type: "ask.resolved", requestId: message.requestId, payload: result });
        } catch (error) {
          sendAskError(socket, message.requestId, "ask_cancel_failed", error);
        }
        return;
      }

      if (message.payload.reason !== "reload") {
        requestStore.cancelPendingForSession(message.payload.sessionId, lifecycleShutdownRationale(message.payload.reason));
        sessionStore.shutdown(message.payload.sessionId);
        broadcaster.broadcast();
      }
      send(socket, { type: "ack", requestId: message.requestId, payload: { type: "session.shutdown" } });
    });

    socket.on("close", () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
      unsubscribers.clear();
      sessionStore.disconnectConnection(connectionId);
      questionChatRelay?.unbind(connectionId);
      broadcaster.broadcast();
    });
  });
}
