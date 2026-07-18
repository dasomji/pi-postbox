import { z } from "zod";

const REQUEST_ID_MAX = 200;
const PATH_MAX = 4_000;
const SHORT_TEXT_MAX = 2_000;
const ERROR_MESSAGE_MAX = 8_000;
export const QUESTION_CHAT_COMMAND_ID_MAX = 128;
export const QUESTION_CHAT_USER_TEXT_MAX = 8_000;
export const QUESTION_CHAT_ASSISTANT_TEXT_MAX = 32_000;
export const QUESTION_CHAT_DELTA_MAX = 4_000;
export const QUESTION_CHAT_MESSAGE_MAX = 100;

export const QUESTION_CHAT_STARTERS = [
  {
    id: "elaborate",
    label: "Elaborate",
    instruction: "Explain the asking agent's language and intent in this question."
  },
  {
    id: "pro-cons",
    label: "Pro–Cons",
    instruction: "Compare the relevant trade-offs of this decision at my current level."
  },
  {
    id: "teach-me",
    label: "Teach me",
    instruction: "Teach me the minimum foundational concepts I need to understand this question."
  }
] as const;

export const QuestionChatAvailabilityCodeSchema = z.enum([
  "request_missing",
  "request_not_pending",
  "extension_offline",
  "source_path_missing",
  "source_leaf_missing",
  "wrong_owner",
  "command_timeout",
  "runtime_failure",
  "chat_not_started",
  "invalid_command",
  "duplicate_command",
  "runtime_busy"
]);

export const QuestionChatAvailabilityErrorSchema = z.object({
  code: QuestionChatAvailabilityCodeSchema,
  message: z.string().min(1).max(ERROR_MESSAGE_MAX)
});

export const QuestionChatSourceSchema = z.object({
  agentSessionPath: z.string().min(1).max(PATH_MAX),
  leafId: z.string().min(1).max(SHORT_TEXT_MAX),
  cwd: z.string().min(1).max(PATH_MAX),
  model: z.string().min(1).max(SHORT_TEXT_MAX).optional()
});

export const QuestionChatModelSchema = z.object({
  id: z.string().min(1).max(SHORT_TEXT_MAX),
  source: z.enum(["originating", "pi-default"]),
  fallbackReason: z.string().min(1).max(ERROR_MESSAGE_MAX).optional()
});

export const QuestionChatStateSchema = z.enum(["ready", "generating"]);

export const QuestionChatMessageSchema = z.discriminatedUnion("role", [
  z.object({
    id: z.string().min(1).max(REQUEST_ID_MAX),
    role: z.literal("user"),
    text: z.string().min(1).max(QUESTION_CHAT_USER_TEXT_MAX),
    status: z.literal("final")
  }),
  z.object({
    id: z.string().min(1).max(REQUEST_ID_MAX),
    role: z.literal("assistant"),
    text: z.string().max(QUESTION_CHAT_ASSISTANT_TEXT_MAX),
    status: z.enum(["streaming", "final"])
  })
]);

export const QuestionChatSnapshotSchema = z.object({
  requestId: z.string().min(1).max(REQUEST_ID_MAX),
  state: QuestionChatStateSchema,
  forkKind: z.literal("exact"),
  model: QuestionChatModelSchema,
  sequence: z.number().int().nonnegative().default(0),
  messages: z.array(QuestionChatMessageSchema).max(QUESTION_CHAT_MESSAGE_MAX)
});

export const QuestionChatSendPayloadSchema = z.object({
  clientCommandId: z.string().min(1).max(QUESTION_CHAT_COMMAND_ID_MAX),
  message: z.string().trim().min(1).max(QUESTION_CHAT_USER_TEXT_MAX)
});

const QuestionChatEventBaseSchema = z.object({
  requestId: z.string().min(1).max(REQUEST_ID_MAX),
  sequence: z.number().int().positive()
});

export const QuestionChatEventSchema = z.discriminatedUnion("type", [
  QuestionChatEventBaseSchema.extend({
    type: z.literal("lifecycle"),
    state: QuestionChatStateSchema
  }),
  QuestionChatEventBaseSchema.extend({
    type: z.literal("message.started"),
    message: QuestionChatMessageSchema
  }),
  QuestionChatEventBaseSchema.extend({
    type: z.literal("assistant.text.delta"),
    messageId: z.string().min(1).max(REQUEST_ID_MAX),
    text: z.string().min(1).max(QUESTION_CHAT_DELTA_MAX)
  }),
  QuestionChatEventBaseSchema.extend({
    type: z.literal("message.finished"),
    messageId: z.string().min(1).max(REQUEST_ID_MAX),
    text: z.string().max(QUESTION_CHAT_ASSISTANT_TEXT_MAX)
  })
]);

export const QuestionChatSendResponseSchema = z.object({
  status: z.literal("accepted"),
  clientCommandId: z.string().min(1).max(QUESTION_CHAT_COMMAND_ID_MAX)
});

export const QuestionChatActivationResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ready"), snapshot: QuestionChatSnapshotSchema }),
  z.object({ status: z.literal("unavailable"), error: QuestionChatAvailabilityErrorSchema })
]);

export type QuestionChatAvailabilityCode = z.infer<typeof QuestionChatAvailabilityCodeSchema>;
export type QuestionChatAvailabilityError = z.infer<typeof QuestionChatAvailabilityErrorSchema>;
export type QuestionChatSource = z.infer<typeof QuestionChatSourceSchema>;
export type QuestionChatModel = z.infer<typeof QuestionChatModelSchema>;
export type QuestionChatState = z.infer<typeof QuestionChatStateSchema>;
export type QuestionChatMessage = z.infer<typeof QuestionChatMessageSchema>;
export type QuestionChatSnapshot = z.infer<typeof QuestionChatSnapshotSchema>;
export type QuestionChatSendPayload = z.infer<typeof QuestionChatSendPayloadSchema>;
export type QuestionChatSendResponse = z.infer<typeof QuestionChatSendResponseSchema>;
export type QuestionChatEvent = z.infer<typeof QuestionChatEventSchema>;
export type QuestionChatActivationResponse = z.infer<typeof QuestionChatActivationResponseSchema>;
