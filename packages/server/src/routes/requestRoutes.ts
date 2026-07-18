import { AskAnswerPayloadSchema, AskCancelPayloadSchema, AskStatusSchema } from "@pi-postbox/protocol";
import type { FastifyInstance } from "fastify";
import type { StateBroadcaster } from "../services/broadcaster.js";
import type { QuestionChatRelay } from "../services/questionChatRelay.js";
import { RequestStore, RequestStoreError } from "../services/requestStore.js";
import type { SessionStore } from "../services/sessionStore.js";

export async function registerRequestRoutes(
  app: FastifyInstance,
  requestStore: RequestStore,
  broadcaster: StateBroadcaster,
  expireDue: () => unknown = () => undefined,
  questionChat?: { relay: QuestionChatRelay; sessionStore: SessionStore }
): Promise<void> {
  app.get("/api/requests", async (request, reply) => {
    expireDue();
    const query = request.query as { status?: string };
    const status = query.status ? AskStatusSchema.safeParse(query.status) : undefined;
    if (status && !status.success) return reply.code(400).send({ error: "invalid_status" });
    return { requests: requestStore.list(status?.success ? { status: status.data } : {}) };
  });

  app.post("/api/requests/:requestId/answer", async (request, reply) => {
    const { requestId } = request.params as { requestId: string };
    const body = AskAnswerPayloadSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_answer", message: body.error.message });

    try {
      expireDue();
      const result = requestStore.answer(requestId, body.data);
      broadcaster.broadcast();
      return { result, request: requestStore.get(requestId) };
    } catch (error) {
      return sendRequestError(reply, error);
    }
  });

  app.post("/api/requests/:requestId/cancel", async (request, reply) => {
    const { requestId } = request.params as { requestId: string };
    const body = AskCancelPayloadSchema.safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "invalid_cancel", message: body.error.message });

    try {
      expireDue();
      const result = requestStore.cancel(requestId, body.data);
      broadcaster.broadcast();
      return { result, request: requestStore.get(requestId) };
    } catch (error) {
      return sendRequestError(reply, error);
    }
  });

  app.post("/api/requests/:requestId/chat", async (request, reply) => {
    const { requestId } = request.params as { requestId: string };
    expireDue();
    const snapshot = requestStore.get(requestId);
    if (!snapshot) {
      return reply.code(404).send({
        status: "unavailable",
        error: { code: "request_missing", message: "This Postbox Question no longer exists." }
      });
    }
    if (snapshot.status !== "pending") {
      return reply.code(409).send({
        status: "unavailable",
        error: { code: "request_not_pending", message: "Chat is available only while the Postbox Question is pending." }
      });
    }
    if (!questionChat) {
      return reply.code(503).send({
        status: "unavailable",
        error: { code: "extension_offline", message: "The originating Pi extension is unavailable." }
      });
    }
    const source = questionChat.sessionStore.questionChatSource(snapshot.sessionId);
    if (!source) {
      const session = questionChat.sessionStore.getQuestionChatSourceState(snapshot.sessionId);
      const code = session === "missing_leaf" ? "source_leaf_missing" : "source_path_missing";
      const message = code === "source_leaf_missing" ? "The originating Pi session leaf is unavailable." : "The originating Pi session file is unavailable.";
      return reply.code(409).send({ status: "unavailable", error: { code, message } });
    }
    const response = await questionChat.relay.activate(requestId, snapshot.sessionId, source);
    return reply.code(response.status === "ready" ? 200 : response.error.code === "extension_offline" ? 503 : 409).send(response);
  });
}

function sendRequestError(reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }, error: unknown): unknown {
  if (error instanceof RequestStoreError) {
    const statusCode = error.code === "request_already_resolved" || error.code === "request_not_pending" ? 409 : error.code === "request_not_found" ? 404 : 400;
    return reply.code(statusCode).send({ error: error.code, message: error.message });
  }
  throw error;
}
