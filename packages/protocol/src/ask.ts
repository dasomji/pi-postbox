import { z } from "zod";

export const OTHER_OPTION_VALUE = "other";

const SHORT_TEXT_MAX = 2_000;
const LONG_TEXT_MAX = 128_000;
const REQUEST_ID_MAX = 200;
const OPTIONS_MAX = 20;
const ADDITIONAL_INFO_MAX = 20;
const SELECTED_VALUES_MAX = 20;

const ShortTextSchema = z.string().min(1).max(SHORT_TEXT_MAX);
const LongTextSchema = z.string().min(1).max(LONG_TEXT_MAX);
const RequestIdSchema = z.string().min(1).max(REQUEST_ID_MAX);

export const AskModeSchema = z.enum(["single", "multi"]);
export const AskStatusSchema = z.enum(["pending", "answered", "cancelled", "expired"]);

export const RichContextItemSchema = z.object({
  kind: z.enum(["text", "code", "diagram", "link"]).default("text"),
  title: ShortTextSchema.optional(),
  content: LongTextSchema,
  language: z.string().min(1).max(80).optional()
});

export const ForkReferenceSchema = z.object({
  agentSessionId: ShortTextSchema.optional(),
  agentSessionPath: z.string().min(1).max(4_000).optional(),
  leafId: ShortTextSchema.optional(),
  cwd: z.string().min(1).max(4_000).optional(),
  model: ShortTextSchema.optional()
});

export const HandoffContextSchema = z.object({
  codebaseContext: LongTextSchema.optional(),
  problemContext: LongTextSchema.optional(),
  additionalInfo: z.array(RichContextItemSchema).max(ADDITIONAL_INFO_MAX).optional()
});

export const AskOptionSchema = z.object({
  value: z.string().min(1).max(200),
  label: ShortTextSchema,
  description: LongTextSchema.optional(),
  meaning: LongTextSchema.optional(),
  context: LongTextSchema.optional()
});

export const AskQuestionSchema = z.object({
  prompt: LongTextSchema,
  context: LongTextSchema.optional(),
  relevance: LongTextSchema.optional(),
  decisionImpact: LongTextSchema.optional()
});

export const AskCreatePayloadSchema = z.object({
  requestId: RequestIdSchema,
  sessionId: z.string().min(1).max(200),
  mode: AskModeSchema,
  question: AskQuestionSchema,
  options: z.array(AskOptionSchema).min(1).max(OPTIONS_MAX),
  context: HandoffContextSchema.optional(),
  forkReference: ForkReferenceSchema.optional(),
  expiresAt: z.string().datetime().optional()
});

export const AskAnswerPayloadSchema = z.object({
  selectedValues: z.array(z.string().min(1).max(200)).min(1).max(SELECTED_VALUES_MAX),
  note: LongTextSchema.optional(),
  rationale: LongTextSchema.optional()
});

export const AskCancelPayloadSchema = z.object({
  note: LongTextSchema.optional(),
  rationale: LongTextSchema.optional()
});

export const AskResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("answered"),
    requestId: RequestIdSchema,
    selectedValues: z.array(z.string().min(1).max(200)).min(1).max(SELECTED_VALUES_MAX),
    note: LongTextSchema.optional(),
    rationale: LongTextSchema.optional(),
    resolvedAt: z.string().datetime()
  }),
  z.object({
    status: z.literal("cancelled"),
    requestId: RequestIdSchema,
    note: LongTextSchema.optional(),
    rationale: LongTextSchema.optional(),
    resolvedAt: z.string().datetime()
  }),
  z.object({
    status: z.literal("expired"),
    requestId: RequestIdSchema,
    rationale: LongTextSchema.optional(),
    resolvedAt: z.string().datetime()
  }),
  z.object({
    status: z.literal("unavailable"),
    requestId: RequestIdSchema,
    rationale: LongTextSchema.optional(),
    resolvedAt: z.string().datetime()
  })
]);

export const AskRequestSnapshotSchema = z.object({
  requestId: RequestIdSchema,
  sessionId: z.string().min(1).max(200),
  mode: AskModeSchema,
  question: AskQuestionSchema,
  options: z.array(AskOptionSchema).min(1).max(OPTIONS_MAX),
  context: HandoffContextSchema.optional(),
  forkReference: ForkReferenceSchema.optional(),
  status: AskStatusSchema,
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime().optional(),
  resolvedAt: z.string().datetime().optional(),
  result: AskResultSchema.optional()
});

export type AskMode = z.infer<typeof AskModeSchema>;
export type AskStatus = z.infer<typeof AskStatusSchema>;
export type RichContextItem = z.infer<typeof RichContextItemSchema>;
export type ForkReference = z.infer<typeof ForkReferenceSchema>;
export type HandoffContext = z.infer<typeof HandoffContextSchema>;
export type AskOption = z.infer<typeof AskOptionSchema>;
export type AskQuestion = z.infer<typeof AskQuestionSchema>;
export type AskCreatePayload = z.infer<typeof AskCreatePayloadSchema>;
export type AskAnswerPayload = z.infer<typeof AskAnswerPayloadSchema>;
export type AskCancelPayload = z.infer<typeof AskCancelPayloadSchema>;
export type AskResult = z.infer<typeof AskResultSchema>;
export type AskRequestSnapshot = z.infer<typeof AskRequestSnapshotSchema>;
