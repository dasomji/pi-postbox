import { z } from "zod";
import { AskAnswerPayloadSchema, AskCancelPayloadSchema, AskCreatePayloadSchema, AskResultSchema } from "./ask.js";
import {
  QuestionChatAvailabilityErrorSchema,
  QuestionChatEventSchema,
  QuestionChatSendPayloadSchema,
  QuestionChatSendResponseSchema,
  QuestionChatSnapshotSchema,
  QuestionChatSourceSchema
} from "./chat.js";
import {
  HeartbeatPayloadSchema,
  SessionRegisterPayloadSchema,
  SessionShutdownPayloadSchema,
  SessionUpdatePayloadSchema
} from "./session.js";

export const ExtensionClientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("session.register"),
    requestId: z.string().min(1).optional(),
    payload: SessionRegisterPayloadSchema
  }),
  z.object({
    type: z.literal("heartbeat"),
    requestId: z.string().min(1).optional(),
    payload: HeartbeatPayloadSchema
  }),
  z.object({
    type: z.literal("session.update"),
    requestId: z.string().min(1).optional(),
    payload: SessionUpdatePayloadSchema
  }),
  z.object({
    type: z.literal("session.shutdown"),
    requestId: z.string().min(1).optional(),
    payload: SessionShutdownPayloadSchema
  }),
  z.object({
    type: z.literal("ask.create"),
    requestId: z.string().min(1).optional(),
    payload: AskCreatePayloadSchema
  }),
  z.object({
    type: z.literal("ask.answer"),
    requestId: z.string().min(1).optional(),
    payload: z.object({ requestId: z.string().min(1), answer: AskAnswerPayloadSchema })
  }),
  z.object({
    type: z.literal("ask.cancel"),
    requestId: z.string().min(1).optional(),
    payload: z.object({ requestId: z.string().min(1), cancel: AskCancelPayloadSchema.default({}) })
  }),
  z.object({
    type: z.literal("chat.ready"),
    requestId: z.string().min(1),
    payload: QuestionChatSnapshotSchema
  }),
  z.object({
    type: z.literal("chat.error"),
    requestId: z.string().min(1),
    payload: z.object({ requestId: z.string().min(1), error: QuestionChatAvailabilityErrorSchema })
  }),
  z.object({
    type: z.literal("chat.snapshot"),
    requestId: z.string().min(1),
    payload: QuestionChatSnapshotSchema
  }),
  z.object({
    type: z.literal("chat.send.accepted"),
    requestId: z.string().min(1),
    payload: z.object({ requestId: z.string().min(1), response: QuestionChatSendResponseSchema })
  }),
  z.object({
    type: z.literal("chat.event"),
    payload: QuestionChatEventSchema
  })
]);

export const ExtensionServerMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("registered"),
    requestId: z.string().min(1).optional(),
    payload: z.object({ sessionId: z.string().min(1), presence: z.literal("live") })
  }),
  z.object({
    type: z.literal("ack"),
    requestId: z.string().min(1).optional(),
    payload: z.object({ type: z.string().min(1) })
  }),
  z.object({
    type: z.literal("ask.created"),
    requestId: z.string().min(1).optional(),
    payload: z.object({ requestId: z.string().min(1), status: z.literal("pending") })
  }),
  z.object({
    type: z.literal("ask.resolved"),
    requestId: z.string().min(1).optional(),
    payload: AskResultSchema
  }),
  z.object({
    type: z.literal("chat.activate"),
    requestId: z.string().min(1),
    payload: z.object({
      requestId: z.string().min(1),
      ownerSessionId: z.string().min(1).max(200),
      source: QuestionChatSourceSchema
    })
  }),
  z.object({
    type: z.literal("chat.cleanup"),
    requestId: z.string().min(1).optional(),
    payload: z.object({
      requestId: z.string().min(1).max(200),
      reason: z.enum(["answered", "cancelled", "expired", "session_shutdown"])
    })
  }),
  z.object({
    type: z.literal("chat.snapshot"),
    requestId: z.string().min(1),
    payload: z.object({
      requestId: z.string().min(1).max(200),
      ownerSessionId: z.string().min(1).max(200)
    })
  }),
  z.object({
    type: z.literal("chat.send"),
    requestId: z.string().min(1),
    payload: z.object({
      requestId: z.string().min(1).max(200),
      ownerSessionId: z.string().min(1).max(200),
      command: QuestionChatSendPayloadSchema
    })
  }),
  z.object({
    type: z.literal("error"),
    requestId: z.string().min(1).optional(),
    error: z.object({ code: z.string().min(1), message: z.string().min(1) })
  })
]);

export type ExtensionClientMessage = z.infer<typeof ExtensionClientMessageSchema>;
export type ExtensionServerMessage = z.infer<typeof ExtensionServerMessageSchema>;
