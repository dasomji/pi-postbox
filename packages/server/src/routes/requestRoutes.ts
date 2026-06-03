import { AskAnswerPayloadSchema, AskCancelPayloadSchema, AskStatusSchema } from "@pi-postbox/protocol";
import type { FastifyInstance } from "fastify";
import type { StateBroadcaster } from "../services/broadcaster.js";
import { RequestStore, RequestStoreError } from "../services/requestStore.js";

export async function registerRequestRoutes(
  app: FastifyInstance,
  requestStore: RequestStore,
  broadcaster: StateBroadcaster,
  expireDue: () => unknown = () => undefined
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
}

function sendRequestError(reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }, error: unknown): unknown {
  if (error instanceof RequestStoreError) {
    const statusCode = error.code === "request_already_resolved" || error.code === "request_not_pending" ? 409 : error.code === "request_not_found" ? 404 : 400;
    return reply.code(statusCode).send({ error: error.code, message: error.message });
  }
  throw error;
}
