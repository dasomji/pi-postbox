import {
  AskAnswerPayloadSchema,
  AskCancelPayloadSchema,
  AskStatusSchema,
  QuestionChatActivationResponseSchema,
  QuestionChatContextActivationPayloadSchema,
  QuestionChatContextSourceSchema,
  QuestionChatSendHttpResponseSchema,
  QuestionChatSendPayloadSchema,
  QuestionChatSnapshotHttpResponseSchema,
  QuestionChatStopHttpResponseSchema,
  QuestionChatStopPayloadSchema,
  QuestionChatUnavailableResponseSchema,
  type QuestionChatAvailabilityError,
  type QuestionChatContextFallbackAvailability
} from "@pi-postbox/protocol";
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
    const contextFallback = contextFallbackAvailability(snapshot.context);
    if (!source) {
      const session = questionChat.sessionStore.getQuestionChatSourceState(snapshot.sessionId);
      const code = session === "missing_leaf" ? "source_leaf_missing" : "source_path_missing";
      const message = code === "source_leaf_missing" ? "The originating Pi session leaf is unavailable." : "The originating Pi session file is unavailable.";
      return reply.code(409).send(QuestionChatActivationResponseSchema.parse({
        status: "unavailable",
        error: { code, message, contextFallback }
      }));
    }
    const response = await questionChat.relay.activate(requestId, snapshot.sessionId, source, chatCallerKey(request));
    const disclosed = response.status === "unavailable" &&
      (response.error.code === "source_path_missing" || response.error.code === "source_leaf_missing")
      ? { ...response, error: { ...response.error, contextFallback } }
      : response;
    return reply
      .code(disclosed.status === "ready" ? 200 : chatErrorStatus(disclosed.error.code))
      .send(QuestionChatActivationResponseSchema.parse(disclosed));
  });

  app.post("/api/requests/:requestId/chat/context", async (request, reply) => {
    const body = QuestionChatContextActivationPayloadSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send(chatUnavailable({ code: "invalid_command", message: body.error.message }));
    }
    const state = pendingChatRequest(request.params as { requestId: string }, requestStore, expireDue, questionChat);
    if (state.error) return reply.code(state.error.status).send(state.error.body);
    const snapshot = state.snapshot!;
    const contextFallback = contextFallbackAvailability(snapshot.context);
    if (contextFallback.status === "unavailable") {
      return reply.code(409).send(chatUnavailable({
        code: "context_fallback_unavailable",
        message: contextFallbackMessage(contextFallback.reason),
        contextFallback
      }));
    }
    const cwd = questionChat!.sessionStore.questionChatCwd(snapshot.sessionId);
    if (!cwd) {
      return reply.code(409).send(chatUnavailable({
        code: "runtime_failure",
        message: "The originating working directory is unavailable."
      }));
    }
    const source = QuestionChatContextSourceSchema.parse({
      cwd,
      model: snapshot.forkReference?.model,
      mode: snapshot.mode,
      question: snapshot.question,
      options: snapshot.options,
      context: snapshot.context
    });
    const response = await questionChat!.relay.activateContext(
      snapshot.requestId,
      snapshot.sessionId,
      source,
      chatCallerKey(request)
    );
    return reply
      .code(response.status === "ready" ? 200 : chatErrorStatus(response.error.code))
      .send(QuestionChatActivationResponseSchema.parse(response));
  });

  app.get("/api/requests/:requestId/chat", async (request, reply) => {
    const state = pendingChatRequest(request.params as { requestId: string }, requestStore, expireDue, questionChat);
    if (state.error) return reply.code(state.error.status).send(state.error.body);
    const response = await questionChat!.relay.snapshot(state.snapshot!.requestId, state.snapshot!.sessionId);
    if (response.status === "unavailable") return reply.code(chatErrorStatus(response.error.code)).send(chatUnavailable(response.error));
    return QuestionChatSnapshotHttpResponseSchema.parse({ status: "ready", snapshot: response.value });
  });

  app.post("/api/requests/:requestId/chat/messages", async (request, reply) => {
    const body = QuestionChatSendPayloadSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send(chatUnavailable({ code: "invalid_command", message: body.error.message }));
    const { requestId } = request.params as { requestId: string };
    const retained = questionChat?.relay.replaySend(requestId, body.data);
    if (retained) return sendChatCommandResult(reply, await retained);
    const state = pendingChatRequest(request.params as { requestId: string }, requestStore, expireDue, questionChat);
    if (state.error) return reply.code(state.error.status).send(state.error.body);
    const response = await questionChat!.relay.sendMessage(
      state.snapshot!.requestId,
      state.snapshot!.sessionId,
      body.data,
      chatCallerKey(request)
    );
    return sendChatCommandResult(reply, response);
  });

  app.post("/api/requests/:requestId/chat/stop", async (request, reply) => {
    const body = QuestionChatStopPayloadSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send(chatUnavailable({ code: "invalid_command", message: body.error.message }));
    const { requestId } = request.params as { requestId: string };
    const retained = questionChat?.relay.replayStop(requestId, body.data);
    if (retained) return sendChatStopResult(reply, await retained);
    const state = pendingChatRequest(request.params as { requestId: string }, requestStore, expireDue, questionChat);
    if (state.error) return reply.code(state.error.status).send(state.error.body);
    const response = await questionChat!.relay.stop(
      state.snapshot!.requestId,
      state.snapshot!.sessionId,
      body.data,
      chatCallerKey(request)
    );
    return sendChatStopResult(reply, response);
  });

  app.get("/api/requests/:requestId/chat/events", async (request, reply) => {
    const state = pendingChatRequest(request.params as { requestId: string }, requestStore, expireDue, questionChat);
    if (state.error) return reply.code(state.error.status).send(state.error.body);
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    reply.raw.write(": question-chat-connected\n\n");
    const unsubscribe = questionChat!.relay.subscribe(state.snapshot!.requestId, (event) => {
      if (!reply.raw.destroyed) reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    });
    request.raw.once("close", unsubscribe);
  });
}

function pendingChatRequest(
  params: { requestId: string },
  requestStore: RequestStore,
  expireDue: () => unknown,
  questionChat: { relay: QuestionChatRelay; sessionStore: SessionStore } | undefined
): { snapshot?: NonNullable<ReturnType<RequestStore["get"]>>; error?: { status: number; body: unknown } } {
  expireDue();
  const snapshot = requestStore.get(params.requestId);
  if (!snapshot) {
    return { error: { status: 404, body: chatUnavailable({ code: "request_missing", message: "This Postbox Question no longer exists." }) } };
  }
  if (snapshot.status !== "pending") {
    return { error: { status: 409, body: chatUnavailable({ code: "request_not_pending", message: "Chat is available only while the Postbox Question is pending." }) } };
  }
  if (!questionChat) {
    return { error: { status: 503, body: chatUnavailable({ code: "extension_offline", message: "The originating Pi extension is unavailable." }) } };
  }
  return { snapshot };
}

function chatErrorStatus(code: string): number {
  if (code === "extension_offline" || code === "command_timeout") return 503;
  if (code === "request_missing") return 404;
  if (code === "forbidden_origin") return 403;
  if (code === "rate_limited") return 429;
  return 409;
}

function chatCallerKey(request: { headers: { origin?: string }; ip: string }): string {
  return request.headers.origin ? `origin:${request.headers.origin}` : `client:${request.ip}`;
}

function sendChatCommandResult(
  reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } },
  response: Awaited<ReturnType<QuestionChatRelay["sendMessage"]>>
): unknown {
  if (response.status === "unavailable") {
    return reply.code(chatErrorStatus(response.error.code)).send(chatUnavailable(response.error));
  }
  return QuestionChatSendHttpResponseSchema.parse(response.value);
}

function sendChatStopResult(
  reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } },
  response: Awaited<ReturnType<QuestionChatRelay["stop"]>>
): unknown {
  if (response.status === "unavailable") {
    return reply.code(chatErrorStatus(response.error.code)).send(chatUnavailable(response.error));
  }
  return QuestionChatStopHttpResponseSchema.parse(response.value);
}

function chatUnavailable(error: QuestionChatAvailabilityError) {
  return QuestionChatUnavailableResponseSchema.parse({ status: "unavailable", error });
}

function contextFallbackAvailability(
  context: { codebaseContext?: string; problemContext?: string } | undefined
): QuestionChatContextFallbackAvailability {
  const hasCodebase = Boolean(context?.codebaseContext?.trim());
  const hasProblem = Boolean(context?.problemContext?.trim());
  if (hasCodebase && hasProblem) return { status: "available" };
  if (!hasCodebase && !hasProblem) return { status: "unavailable", reason: "missing_codebase_and_problem_context" };
  return {
    status: "unavailable",
    reason: hasCodebase ? "missing_problem_context" : "missing_codebase_context"
  };
}

function contextFallbackMessage(reason: Extract<QuestionChatContextFallbackAvailability, { status: "unavailable" }>["reason"]): string {
  if (reason === "missing_codebase_context") return "Context-only Chat requires persisted codebase context.";
  if (reason === "missing_problem_context") return "Context-only Chat requires persisted problem context.";
  return "Context-only Chat requires persisted codebase and problem context.";
}

function sendRequestError(reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }, error: unknown): unknown {
  if (error instanceof RequestStoreError) {
    const statusCode = error.code === "request_already_resolved" || error.code === "request_not_pending" ? 409 : error.code === "request_not_found" ? 404 : 400;
    return reply.code(statusCode).send({ error: error.code, message: error.message });
  }
  throw error;
}
