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
  const activeSessionWaits = new Map<string, { connectionId: string; requestId: string; controller: AbortController; socket: WebSocket }>();
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
    const waitAbortControllers = new Map<string, AbortController>();
    const flushAnswerNotifications = () => {
      if (!registeredSessionId || socket.readyState !== 1 || !sessionStore.isCurrentConnection(registeredSessionId, connectionId)) return;
      const owner = sessionStore.ownerForSession(registeredSessionId);
      if (!owner || !sessionStore.isConnectedNonWaitingOwner(registeredSessionId, owner)) return;
      for (const answer of requestStore.claimProactiveAnswerNotifications(owner, connectionId, sessionStore)) {
        send(socket, {
          type: "answer.available",
          requestId: `answer_available_${answer.answerId}`,
          payload: { questionId: answer.questionId, question: answer.question, answerId: answer.answerId }
        });
      }
    };
    unsubscribers.add(requestStore.onAnswerAvailable(() => flushAnswerNotifications()));
    let recoveryOffersComplete = false;
    const pendingRecoveries = new Map<string, {
      requestId: string;
      forkKind: "exact";
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
            questionChatRelay?.rejectRecovery({
              requestId: pendingRecovery.requestId,
              ownerSessionId: registeredSessionId,
              forkKind: pendingRecovery.forkKind
            }, cleanupReason);
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
        const displacedWait = activeSessionWaits.get(message.payload.session.sessionId);
        if (displacedWait) {
          send(displacedWait.socket, { type: "postbox.wait.result", requestId: displacedWait.requestId,
            payload: { type: "lifecycle", event: "connection_replaced", sessionId: message.payload.session.sessionId } });
          displacedWait.controller.abort();
        }
        try {
          const feature = sessionStore.register(connectionId, message.payload);
          registeredSessionId = message.payload.session.sessionId;
          recoveryOffersComplete = false;
          pendingRecoveries.clear();
          questionChatRelay?.bind(message.payload.session.sessionId, connectionId, socket);
          broadcaster.broadcast();
          send(socket, {
            type: "registered",
            requestId: message.requestId,
            payload: { sessionId: message.payload.session.sessionId, presence: "live", feature }
          });
          flushAnswerNotifications();
        } catch (error) {
          sendAskError(socket, message.requestId, "session_registration_failed", error);
        }
        return;
      }

      if (message.type === "feature.action") {
        try {
          if (message.payload.sessionId !== registeredSessionId || !sessionStore.isCurrentConnection(message.payload.sessionId, connectionId)) {
            throw new Error("Feature actions require this connection's registered session");
          }
          const feature = sessionStore.selectFeature(message.payload.sessionId, message.payload);
          broadcaster.broadcast();
          send(socket, { type: "registered", requestId: message.requestId,
            payload: { sessionId: message.payload.sessionId, presence: "live", feature } });
        } catch (error) { sendAskError(socket, message.requestId, "feature_action_failed", error); }
        return;
      }

      if (message.type === "answer.available.ack") {
        if (!registeredSessionId || !sessionStore.isCurrentConnection(registeredSessionId, connectionId)) return;
        const owner = sessionStore.ownerForSession(registeredSessionId);
        if (owner) requestStore.acknowledgeOwnerNotification(message.payload.answerId, owner, connectionId);
        return;
      }

      if (message.type === "question.list") {
        if (message.payload.sessionId !== registeredSessionId || !sessionStore.isCurrentConnection(message.payload.sessionId, connectionId)) {
          sendAskError(socket, message.requestId, "scope_not_found", new Error("Question discovery requires this connection's registered session"));
          return;
        }
        const scope = sessionStore.groupingForSession(message.payload.sessionId);
        if (!scope) { sendAskError(socket, message.requestId, "scope_not_found", new Error("Session has no discovery scope")); return; }
        const owner = sessionStore.ownerForSession(message.payload.sessionId) ?? { harness: "legacy", ownerId: message.payload.sessionId };
        const level = message.payload.scope ?? (message.payload.global ? "global" : "owner");
        const result = requestStore.listQuestions({ caller: { owner, repository: scope.repositoryId, worktree: scope.worktreeId, feature: scope.featureId }, ...message.payload });
        const resultScope = { ...scope, level };
        send(socket, { type: "question.list.result", requestId: message.requestId, payload: { scope: resultScope, ...result } });
        return;
      }
      if (message.type === "questions.get") { send(socket, { type: "query.result", requestId: message.requestId, payload: requestStore.getQuestions(message.payload) }); return; }
      if (message.type === "question.status.list") {
        if (message.payload.sessionId !== registeredSessionId || !sessionStore.isCurrentConnection(message.payload.sessionId, connectionId)) {
          sendAskError(socket, message.requestId, "scope_not_found", new Error("Question status requires this connection's registered session"));
          return;
        }
        const scope = sessionStore.groupingForSession(message.payload.sessionId);
        const owner = sessionStore.ownerForSession(message.payload.sessionId) ?? { harness: "legacy", ownerId: message.payload.sessionId };
        if (!scope) { sendAskError(socket, message.requestId, "scope_not_found", new Error("Session has no discovery scope")); return; }
        send(socket, { type: "query.result", requestId: message.requestId, payload: requestStore.listQuestionStatusPage({ caller: { owner, repository: scope.repositoryId, worktree: scope.worktreeId, feature: scope.featureId }, ...message.payload }) }); return;
      }
      if (message.type === "owner.list") {
        if (message.payload.sessionId !== registeredSessionId || !sessionStore.isCurrentConnection(message.payload.sessionId, connectionId)) {
          sendAskError(socket, message.requestId, "scope_not_found", new Error("Owner discovery requires this connection's registered session"));
          return;
        }
        try {
          send(socket, { type: "query.result", requestId: message.requestId,
            payload: sessionStore.listPostboxOwnersPage(message.payload.sessionId, message.payload) });
        } catch (error) {
          sendAskError(socket, message.requestId, "scope_not_found", error);
        }
        return;
      }
      if (message.type === "owner.status.get") { send(socket, { type: "query.result", requestId: message.requestId, payload: sessionStore.getPostboxOwnerStatus(message.payload.owners) }); return; }
      if (message.type === "question.update") {
        if (message.payload.sessionId !== registeredSessionId || !sessionStore.isCurrentConnection(message.payload.sessionId, connectionId)) { sendAskError(socket, message.requestId, "wrong_owner", new Error("Question updates require this connection's registered session")); return; }
        const actor = sessionStore.ownerForSession(message.payload.sessionId);
        if (!actor) { sendAskError(socket, message.requestId, "wrong_owner", new Error("Session has no owner")); return; }
        try {
          const payload = requestStore.updateQuestion(message.payload.questionId, actor, message.payload.update, sessionStore);
          if (message.payload.update.action === "transfer" || message.payload.update.action === "takeover") questionChatRelay?.disposeNonTerminal(message.payload.questionId);
          broadcaster.broadcast();
          send(socket, { type: "query.result", requestId: message.requestId, payload });
        }
        catch (error) { sendAskError(socket, message.requestId, "question_update_failed", error); }
        return;
      }
      if (message.type === "question.history.get") { send(socket, { type: "query.result", requestId: message.requestId, payload: requestStore.getQuestionHistoryPage(message.payload) }); return; }
      if (message.type === "question.answer.recover") {
        if (message.payload.sessionId !== registeredSessionId || !sessionStore.isCurrentConnection(message.payload.sessionId, connectionId)) { sendAskError(socket, message.requestId, "wrong_owner", new Error("Recovery reads require this connection's registered session")); return; }
        const reader = sessionStore.ownerForSession(message.payload.sessionId);
        if (!reader) { sendAskError(socket, message.requestId, "wrong_owner", new Error("Session has no owner")); return; }
        const question = requestStore.getQuestions({ questionIds: [message.payload.questionId] })[0] as any;
        if (!question || sessionStore.presenceForOwner(question.owner) !== "offline") { sendAskError(socket, message.requestId, "owner_not_offline", new Error("Recovery reads require an offline owner")); return; }
        try { send(socket, { type: "query.result", requestId: message.requestId, payload: requestStore.getAnswerForRecovery(message.payload.questionId, reader, message.payload.view) }); }
        catch (error) { sendAskError(socket, message.requestId, "recovery_read_failed", error); }
        return;
      }
      if (message.type === "postbox.wait") {
        if (message.payload.sessionId !== registeredSessionId || !sessionStore.isCurrentConnection(message.payload.sessionId, connectionId)) {
          sendAskError(socket, message.requestId, "wait_not_owner", new Error("Postbox wait requires this connection's registered session")); return;
        }
        const owner = sessionStore.ownerForSession(message.payload.sessionId);
        if (!owner) { sendAskError(socket, message.requestId, "wait_owner_missing", new Error("Session has no owner identity")); return; }
        const waitAbortController = new AbortController();
        waitAbortControllers.set(message.requestId, waitAbortController);
        activeSessionWaits.set(message.payload.sessionId, { connectionId, requestId: message.requestId, controller: waitAbortController, socket });
        const priorSemanticState = sessionStore.semanticStateForSession(message.payload.sessionId) ?? "working";
        void requestStore.waitForPostbox({ owner, signal: waitAbortController.signal,
          publishSemanticState: (semanticState) => sessionStore.updateSession({ sessionId: message.payload.sessionId, semanticState: semanticState as any }) })
          .then((payload) => send(socket, { type: "postbox.wait.result", requestId: message.requestId, payload }))
          .catch((error) => { if (error instanceof Error && error.name !== "AbortError") sendAskError(socket, message.requestId, "wait_failed", error); })
          .finally(() => {
            waitAbortControllers.delete(message.requestId);
            const active = activeSessionWaits.get(message.payload.sessionId);
            if (active?.connectionId === connectionId && active.requestId === message.requestId) activeSessionWaits.delete(message.payload.sessionId);
            if (sessionStore.isCurrentConnection(message.payload.sessionId, connectionId)) {
              sessionStore.updateSession({ sessionId: message.payload.sessionId, semanticState: priorSemanticState });
              broadcaster.broadcast();
            }
          });
        broadcaster.broadcast();
        return;
      }
      if (message.type === "postbox.wait.cancel") {
        if (message.payload.sessionId === registeredSessionId && sessionStore.isCurrentConnection(message.payload.sessionId, connectionId)) {
          waitAbortControllers.get(message.payload.waitRequestId)?.abort();
        }
        return;
      }

      if (message.type === "heartbeat") {
        sessionStore.heartbeat(connectionId, message.payload.sessionId, message.payload.semanticState);
        broadcaster.broadcast();
        send(socket, { type: "ack", requestId: message.requestId, payload: { type: "heartbeat" } });
        flushAnswerNotifications();
        return;
      }

      if (message.type === "session.update") {
        sessionStore.updateSession(message.payload);
        broadcaster.broadcast();
        send(socket, { type: "ack", requestId: message.requestId, payload: { type: "session.update" } });
        flushAnswerNotifications();
        return;
      }

      if (message.type === "ask.create") {
        try {
          expireDue();
          const alreadyExisted = requestStore.get(message.payload.requestId) !== undefined;
          const snapshot = requestStore.create(message.payload);
          broadcaster.broadcast();
          send(socket, {
            type: "ask.created",
            requestId: message.requestId,
            payload: {
              requestId: snapshot.requestId,
              questionId: snapshot.requestId,
              revision: snapshot.revision,
              ownerRevision: snapshot.ownerRevision,
              status: snapshot.status,
              disposition: alreadyExisted ? "idempotent" : "created"
            }
          });
          if (snapshot.result) {
            send(socket, { type: "ask.resolved", requestId: message.requestId, payload: snapshot.result });
            return;
          }
          if (!alreadyExisted) {
            void pushNotifier?.notifyNewPendingAsk(snapshot).catch((error: unknown) => {
              app.log.warn({ error, requestId: snapshot.requestId }, "failed to send new ask push notification");
            });
          }
        } catch (error) {
          sendAskError(socket, message.requestId, "ask_create_failed", error);
        }
        return;
      }

      if (message.type === "ask.batch.create") {
        try {
          if (message.payload.sessionId !== registeredSessionId || !sessionStore.isCurrentConnection(message.payload.sessionId, connectionId)) {
            throw new RequestStoreError("wrong_owner", "Question batches require this connection's registered session");
          }
          expireDue();
          const receipt = requestStore.createBatch(message.payload.sessionId, message.payload.questions);
          broadcaster.broadcast();
          send(socket, { type: "ask.batch.result", requestId: message.requestId, payload: receipt });
        } catch (error) {
          sendAskError(socket, message.requestId, "ask_batch_create_failed", error);
        }
        return;
      }

      if (message.type === "answer.get") {
        try {
          if (!registeredSessionId) throw new RequestStoreError("wrong_owner", "Register before reading an Answer");
          const owner = sessionStore.ownerForSession(registeredSessionId);
          if (!owner) throw new RequestStoreError("wrong_owner", "Registered session has no native owner identity");
          const result = requestStore.getAnswer(message.payload.questionId, owner);
          send(socket, { type: "answer.result", requestId: message.requestId, payload: result as never });
        } catch (error) {
          sendAskError(socket, message.requestId, "answer_get_failed", error);
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

      sessionStore.shutdown(message.payload.sessionId);
      broadcaster.broadcast();
      send(socket, { type: "ack", requestId: message.requestId, payload: { type: "session.shutdown" } });
    });

    socket.on("close", () => {
      for (const controller of waitAbortControllers.values()) controller.abort();
      waitAbortControllers.clear();
      if (registeredSessionId) {
        try {
          const owner = sessionStore.ownerForSession(registeredSessionId);
          if (owner) requestStore.releaseProactiveNotificationClaims(owner, connectionId);
        } catch { /* app teardown may close SQLite before the socket close callback */ }
      }
      for (const unsubscribe of unsubscribers) unsubscribe();
      unsubscribers.clear();
      sessionStore.disconnectConnection(connectionId);
      questionChatRelay?.unbind(connectionId);
      broadcaster.broadcast();
    });
  });
}
