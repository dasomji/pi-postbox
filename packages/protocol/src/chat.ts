import { z } from "zod";
import { AskCreateHandoffContextSchema, AskModeSchema, AskOptionSchema, AskQuestionSchema } from "./ask.js";

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
  "context_fallback_unavailable",
  "chat_not_started",
  "invalid_command",
  "duplicate_command",
  "runtime_busy"
]);

export const QuestionChatContextFallbackAvailabilitySchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("available") }),
  z.object({
    status: z.literal("unavailable"),
    reason: z.enum(["missing_codebase_context", "missing_problem_context", "missing_codebase_and_problem_context"])
  })
]);

export const QuestionChatAvailabilityErrorSchema = z.object({
  code: QuestionChatAvailabilityCodeSchema,
  message: z.string().min(1).max(ERROR_MESSAGE_MAX),
  contextFallback: QuestionChatContextFallbackAvailabilitySchema.optional()
});

export const QuestionChatSourceSchema = z.object({
  agentSessionPath: z.string().min(1).max(PATH_MAX),
  leafId: z.string().min(1).max(SHORT_TEXT_MAX),
  cwd: z.string().min(1).max(PATH_MAX),
  model: z.string().min(1).max(SHORT_TEXT_MAX).optional()
});

export const QuestionChatContextSourceSchema = z.object({
  cwd: z.string().min(1).max(PATH_MAX),
  model: z.string().min(1).max(SHORT_TEXT_MAX).optional(),
  mode: AskModeSchema,
  question: AskQuestionSchema,
  options: z.array(AskOptionSchema).min(1).max(20),
  context: AskCreateHandoffContextSchema
}).strict();

export const QuestionChatContextActivationPayloadSchema = z.object({ confirmed: z.literal(true) }).strict();

export const QuestionChatModelSchema = z.object({
  id: z.string().min(1).max(SHORT_TEXT_MAX),
  source: z.enum(["originating", "pi-default"]),
  fallbackReason: z.string().min(1).max(ERROR_MESSAGE_MAX).optional()
});

export const QuestionChatStateSchema = z.enum(["ready", "generating", "stopping", "stopped", "interrupted"]);

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
    status: z.enum(["streaming", "final", "stopped", "interrupted"])
  })
]);

export const QuestionChatSnapshotSchema = z.object({
  requestId: z.string().min(1).max(REQUEST_ID_MAX),
  state: QuestionChatStateSchema,
  forkKind: z.enum(["exact", "context-only"]),
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
    text: z.string().max(QUESTION_CHAT_ASSISTANT_TEXT_MAX),
    status: z.enum(["final", "stopped", "interrupted"]).default("final")
  })
]);

export const QuestionChatTransportEventSchema = z.object({
  requestId: z.string().min(1).max(REQUEST_ID_MAX),
  type: z.literal("transport"),
  state: z.enum(["online", "offline"])
}).strict();

export const QuestionChatStreamEventSchema = z.union([
  QuestionChatEventSchema,
  QuestionChatTransportEventSchema
]);

export const QuestionChatSendResponseSchema = z.object({
  status: z.literal("accepted"),
  clientCommandId: z.string().min(1).max(QUESTION_CHAT_COMMAND_ID_MAX),
  // Optional while older extension peers may still acknowledge without the
  // prompt/steer distinction. All current producers include it.
  mode: z.enum(["prompt", "steer"]).optional()
});

export const QuestionChatStopPayloadSchema = z.object({
  clientCommandId: z.string().min(1).max(QUESTION_CHAT_COMMAND_ID_MAX)
});

export const QuestionChatStopResponseSchema = z.object({
  status: z.literal("accepted"),
  clientCommandId: z.string().min(1).max(QUESTION_CHAT_COMMAND_ID_MAX)
});

export const QuestionChatUnavailableResponseSchema = z.object({
  status: z.literal("unavailable"),
  error: QuestionChatAvailabilityErrorSchema
});

export const QuestionChatSnapshotHttpResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ready"), snapshot: QuestionChatSnapshotSchema }),
  QuestionChatUnavailableResponseSchema
]);

export const QuestionChatSendHttpResponseSchema = z.discriminatedUnion("status", [
  QuestionChatSendResponseSchema,
  QuestionChatUnavailableResponseSchema
]);

export const QuestionChatStopHttpResponseSchema = z.discriminatedUnion("status", [
  QuestionChatStopResponseSchema,
  QuestionChatUnavailableResponseSchema
]);

const QuestionChatActivationUnavailableResponseSchema = z
  .object({ status: z.literal("unavailable"), error: QuestionChatAvailabilityErrorSchema })
  .superRefine((response, context) => {
    if (
      (response.error.code === "source_path_missing" || response.error.code === "source_leaf_missing") &&
      !response.error.contextFallback
    ) {
      context.addIssue({
        code: "custom",
        path: ["error", "contextFallback"],
        message: "Exact source failures must disclose context-only fallback availability."
      });
    }
  });

export const QuestionChatActivationResponseSchema = z.union([
  z.object({ status: z.literal("ready"), snapshot: QuestionChatSnapshotSchema }),
  QuestionChatActivationUnavailableResponseSchema
]);

export type QuestionChatAvailabilityCode = z.infer<typeof QuestionChatAvailabilityCodeSchema>;
export type QuestionChatAvailabilityError = z.infer<typeof QuestionChatAvailabilityErrorSchema>;
export type QuestionChatContextFallbackAvailability = z.infer<typeof QuestionChatContextFallbackAvailabilitySchema>;
export type QuestionChatSource = z.infer<typeof QuestionChatSourceSchema>;
export type QuestionChatContextSource = z.infer<typeof QuestionChatContextSourceSchema>;
export type QuestionChatContextActivationPayload = z.infer<typeof QuestionChatContextActivationPayloadSchema>;
export type QuestionChatModel = z.infer<typeof QuestionChatModelSchema>;
export type QuestionChatState = z.infer<typeof QuestionChatStateSchema>;
export type QuestionChatMessage = z.infer<typeof QuestionChatMessageSchema>;
export type QuestionChatSnapshot = z.infer<typeof QuestionChatSnapshotSchema>;
export type QuestionChatSendPayload = z.infer<typeof QuestionChatSendPayloadSchema>;
export type QuestionChatSendResponse = z.infer<typeof QuestionChatSendResponseSchema>;
export type QuestionChatStopPayload = z.infer<typeof QuestionChatStopPayloadSchema>;
export type QuestionChatStopResponse = z.infer<typeof QuestionChatStopResponseSchema>;
export type QuestionChatStopHttpResponse = z.infer<typeof QuestionChatStopHttpResponseSchema>;
export type QuestionChatUnavailableResponse = z.infer<typeof QuestionChatUnavailableResponseSchema>;
export type QuestionChatSnapshotHttpResponse = z.infer<typeof QuestionChatSnapshotHttpResponseSchema>;
export type QuestionChatSendHttpResponse = z.infer<typeof QuestionChatSendHttpResponseSchema>;
export type QuestionChatEvent = z.infer<typeof QuestionChatEventSchema>;
export type QuestionChatTransportEvent = z.infer<typeof QuestionChatTransportEventSchema>;
export type QuestionChatStreamEvent = z.infer<typeof QuestionChatStreamEventSchema>;
export type QuestionChatActivationResponse = z.infer<typeof QuestionChatActivationResponseSchema>;
