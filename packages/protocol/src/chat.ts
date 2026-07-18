import { z } from "zod";

const REQUEST_ID_MAX = 200;
const PATH_MAX = 4_000;
const SHORT_TEXT_MAX = 2_000;
const ERROR_MESSAGE_MAX = 8_000;

export const QuestionChatAvailabilityCodeSchema = z.enum([
  "request_missing",
  "request_not_pending",
  "extension_offline",
  "source_path_missing",
  "source_leaf_missing",
  "wrong_owner",
  "command_timeout",
  "runtime_failure"
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

export const QuestionChatSnapshotSchema = z.object({
  requestId: z.string().min(1).max(REQUEST_ID_MAX),
  state: z.literal("ready"),
  forkKind: z.literal("exact"),
  model: QuestionChatModelSchema,
  messages: z.array(z.never()).length(0)
});

export const QuestionChatActivationResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ready"), snapshot: QuestionChatSnapshotSchema }),
  z.object({ status: z.literal("unavailable"), error: QuestionChatAvailabilityErrorSchema })
]);

export type QuestionChatAvailabilityCode = z.infer<typeof QuestionChatAvailabilityCodeSchema>;
export type QuestionChatAvailabilityError = z.infer<typeof QuestionChatAvailabilityErrorSchema>;
export type QuestionChatSource = z.infer<typeof QuestionChatSourceSchema>;
export type QuestionChatModel = z.infer<typeof QuestionChatModelSchema>;
export type QuestionChatSnapshot = z.infer<typeof QuestionChatSnapshotSchema>;
export type QuestionChatActivationResponse = z.infer<typeof QuestionChatActivationResponseSchema>;
