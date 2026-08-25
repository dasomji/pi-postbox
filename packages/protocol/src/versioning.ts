import { z } from "zod";
import { StateSnapshotSchema } from "./session.js";
import { PROTOCOL_VERSION } from "./health.js";
import { AskRequestSnapshotSchema, AskResultSchema } from "./ask.js";
import {
  QuestionChatActivationResponseSchema,
  QuestionChatSendHttpResponseSchema,
  QuestionChatSnapshotHttpResponseSchema,
  QuestionChatStopHttpResponseSchema,
  QuestionChatStreamEventSchema
} from "./chat.js";

export const POSTBOX_PROTOCOL_VERSION_HEADER = "X-Postbox-Protocol-Version";
export const POSTBOX_CLIENT_PROTOCOL_VERSION_HEADER = "X-Postbox-Client-Protocol-Version";

export const ReportedProtocolVersionSchema = z.object({
  protocolVersion: z.string().min(1).max(64)
}).passthrough();

export const ProtocolMessageMetadataSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION)
});

export const VersionedStateSnapshotSchema = StateSnapshotSchema.extend({
  protocolVersion: z.literal(PROTOCOL_VERSION)
});

export const VersionedAskMutationResponseSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  result: AskResultSchema,
  request: AskRequestSnapshotSchema
});

export const VersionedRequestErrorResponseSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  error: z.string().min(1),
  message: z.string().optional()
}).passthrough();

function versionedEnvelope(schema: z.ZodTypeAny) {
  return z.object({ protocolVersion: z.literal(PROTOCOL_VERSION) }).passthrough().superRefine((value, context) => {
    const { protocolVersion: _protocolVersion, ...payload } = value;
    const result = schema.safeParse(payload);
    if (!result.success) {
      for (const issue of result.error.issues) context.addIssue(issue);
    }
  });
}

export const VersionedQuestionChatActivationResponseSchema = versionedEnvelope(QuestionChatActivationResponseSchema);
export const VersionedQuestionChatSnapshotHttpResponseSchema = versionedEnvelope(QuestionChatSnapshotHttpResponseSchema);
export const VersionedQuestionChatSendHttpResponseSchema = versionedEnvelope(QuestionChatSendHttpResponseSchema);
export const VersionedQuestionChatStopHttpResponseSchema = versionedEnvelope(QuestionChatStopHttpResponseSchema);
export const VersionedQuestionChatStreamEventSchema = versionedEnvelope(QuestionChatStreamEventSchema);

export const IncompatibleProtocolResponseSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  error: z.literal("incompatible_protocol"),
  supportedProtocolVersion: z.literal(PROTOCOL_VERSION),
  receivedProtocolVersion: z.string().min(1).max(64)
});

export type VersionedStateSnapshot = z.infer<typeof VersionedStateSnapshotSchema>;
export type IncompatibleProtocolResponse = z.infer<typeof IncompatibleProtocolResponseSchema>;

export function withProtocolVersion<T extends Record<string, unknown>>(payload: T): T & { protocolVersion: typeof PROTOCOL_VERSION } {
  return { ...payload, protocolVersion: PROTOCOL_VERSION };
}
