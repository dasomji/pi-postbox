import {
  ExtensionClientMessageSchema,
  type ExtensionServerMessage
} from "@pi-postbox/protocol";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import type { StateBroadcaster } from "../services/broadcaster.js";
import type { PushNotifier } from "../services/pushNotifier.js";
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

export async function registerExtensionSocket(
  app: FastifyInstance,
  sessionStore: SessionStore,
  requestStore: RequestStore,
  broadcaster: StateBroadcaster,
  expireDue: () => unknown = () => undefined,
  pushNotifier?: PushNotifier
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
      if (message.type === "session.register") {
        sessionStore.register(connectionId, message.payload);
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
      broadcaster.broadcast();
    });
  });
}
