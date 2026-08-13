import { z } from "zod";
import { FeatureIdentitySchema, RepositoryIdentitySchema, WorktreeIdentitySchema } from "./grouping.js";

export const OTHER_OPTION_VALUE = "other";

const SHORT_TEXT_MAX = 2_000;
const LONG_TEXT_MAX = 128_000;
const REQUEST_ID_MAX = 200;
const OPTIONS_MAX = 20;
const ADDITIONAL_INFO_MAX = 20;
const SELECTED_VALUES_MAX = 20;

const ShortTextSchema = z.string().min(1).max(SHORT_TEXT_MAX);
const LongTextSchema = z.string().min(1).max(LONG_TEXT_MAX);
const NonBlankLongTextSchema = z
  .string()
  .max(LONG_TEXT_MAX)
  .refine((value) => value.trim().length > 0, { message: "Required context must not be blank" });
const RequestIdSchema = z.string().min(1).max(REQUEST_ID_MAX);

export const AskModeSchema = z.enum(["single", "multi"]);
export const AskStatusSchema = z.enum(["pending", "answered", "cancelled", "expired"]);
export const AskUrgencySchema = z.enum(["low", "normal", "high"]);

const ASK_URGENCY_RANK = { high: 0, normal: 1, low: 2 } as const;

export function compareAskUrgency(a: z.infer<typeof AskUrgencySchema>, b: z.infer<typeof AskUrgencySchema>): number {
  return ASK_URGENCY_RANK[a] - ASK_URGENCY_RANK[b];
}

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

export const AskCreateHandoffContextSchema = HandoffContextSchema.extend({
  codebaseContext: NonBlankLongTextSchema,
  problemContext: NonBlankLongTextSchema
});

export const AskCreateOptionSchema = z.object({
  value: z.string().min(1).max(200),
  label: ShortTextSchema,
  description: LongTextSchema.optional(),
  meaning: LongTextSchema.optional(),
  context: LongTextSchema.optional()
}).strict();

export const AskOptionSchema = AskCreateOptionSchema.extend({
  provenance: z.literal("chat").optional()
});

export const ProposedAnswerOptionSchema = AskCreateOptionSchema.extend({
  provenance: z.literal("chat")
});

export const ProposeAnswerPayloadSchema = z.object({
  label: ShortTextSchema,
  description: LongTextSchema.optional(),
  meaning: LongTextSchema.optional(),
  context: LongTextSchema.optional()
}).strict();

export const ProposeAnswerErrorCodeSchema = z.enum([
  "request_not_found",
  "request_terminal",
  "wrong_owner",
  "invalid_proposal",
  "duplicate_option",
  "option_value_collision",
  "option_limit_reached",
  "internal_error"
]);

export const ProposeAnswerResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("appended"),
    option: ProposedAnswerOptionSchema
  }).strict(),
  z.object({
    status: z.literal("error"),
    error: z.object({
      code: ProposeAnswerErrorCodeSchema,
      message: z.string().min(1).max(SHORT_TEXT_MAX)
    }).strict()
  }).strict()
]);

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
  urgency: AskUrgencySchema.default("normal"),
  question: AskQuestionSchema,
  options: z.array(AskCreateOptionSchema).min(1).max(OPTIONS_MAX),
  context: AskCreateHandoffContextSchema,
  forkReference: ForkReferenceSchema.optional(),
  expiresAt: z.string().datetime().optional(),
  parentQuestionId: RequestIdSchema.optional(),
  repository: RepositoryIdentitySchema.optional(),
  worktree: WorktreeIdentitySchema.optional(),
  feature: FeatureIdentitySchema.optional()
});

export const AskParentReferenceSchema = z.union([
  z.object({ questionId: RequestIdSchema }).strict(),
  z.object({ localRef: RequestIdSchema }).strict()
]);

export const AskQuestionDraftSchema = z.object({
  localRef: RequestIdSchema,
  requestId: RequestIdSchema,
  mode: AskModeSchema.default("single"),
  urgency: AskUrgencySchema.default("normal"),
  question: AskQuestionSchema,
  options: z.array(AskCreateOptionSchema).min(1).max(OPTIONS_MAX),
  context: AskCreateHandoffContextSchema,
  forkReference: ForkReferenceSchema.optional(),
  expiresAt: z.string().datetime().optional(),
  parent: AskParentReferenceSchema.optional()
}).strict();

const AskSingleInputSchema = z.object({ mode: z.literal("single"), question: AskQuestionDraftSchema }).strict();
const AskBatchInputSchema = z.object({ mode: z.literal("batch"), questions: z.array(AskQuestionDraftSchema).min(1) }).strict()
  .superRefine(({ questions }, ctx) => {
    const refs = new Set<string>();
    questions.forEach((question, index) => {
      if (refs.has(question.localRef)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["questions", index, "localRef"], message: "Local references must be unique" });
      refs.add(question.localRef);
    });
  });
export const AskPostboxInputSchema = z.union([AskSingleInputSchema, AskBatchInputSchema]);

export const AskBatchRejectionCodeSchema = z.enum(["forward_parent_reference", "parent_not_found", "child_limit_reached", "depth_limit_reached", "batch_aborted", "invalid_draft"]);
const AskBatchItemReceiptSchema = z.discriminatedUnion("status", [
  z.object({ localRef: RequestIdSchema, status: z.literal("created"), questionId: RequestIdSchema, revision: z.number().int().min(1), nudge: z.string().optional() }).strict(),
  z.object({ localRef: RequestIdSchema, status: z.literal("rejected"), reason: z.object({ code: AskBatchRejectionCodeSchema, message: ShortTextSchema }).strict() }).strict()
]);
export const AskBatchReceiptSchema = z.object({ status: z.enum(["created", "partial", "rejected"]), items: z.array(AskBatchItemReceiptSchema).min(1) }).strict();
export const AskAnswerEventSchema = z.object({ questionId: RequestIdSchema, affectedDescendantIds: z.array(RequestIdSchema) }).passthrough();

export const AskAnswerPayloadSchema = z.object({
  expectedRevision: z.number().int().min(1).optional(),
  selectedValues: z.array(z.string().min(1).max(200)).min(1).max(SELECTED_VALUES_MAX),
  note: LongTextSchema.optional(),
  rationale: LongTextSchema.optional()
});

const ExpectedRevisionSchema = z.number().int().min(1);
export const UpdateQuestionPayloadSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("revise"), expectedRevision: ExpectedRevisionSchema, question: AskQuestionSchema, options: z.array(AskCreateOptionSchema).min(1).max(OPTIONS_MAX).optional(), context: AskCreateHandoffContextSchema.optional() }).strict(),
  z.object({ action: z.literal("cancel"), expectedRevision: ExpectedRevisionSchema, rationale: LongTextSchema.optional() }).strict(),
  z.object({ action: z.literal("supersede"), expectedRevision: ExpectedRevisionSchema, replacementQuestionId: RequestIdSchema }).strict(),
  z.object({ action: z.literal("reparent"), expectedRevision: ExpectedRevisionSchema, parentQuestionId: RequestIdSchema.nullable() }).strict()
]);
const HistoryActorSchema = z.object({ harness: ShortTextSchema, ownerId: ShortTextSchema }).strict();
const HistoryBaseSchema = z.object({ revision: ExpectedRevisionSchema, actor: HistoryActorSchema, at: z.string().datetime() });
export const QuestionRevisionSnapshotSchema = HistoryBaseSchema.extend({
  question: AskQuestionSchema,
  options: z.array(AskOptionSchema),
  context: AskCreateHandoffContextSchema.optional()
}).strict();
export const QuestionHistorySchema = z.object({ questionId: RequestIdSchema, revisions: z.array(QuestionRevisionSnapshotSchema), events: z.array(z.union([
  HistoryBaseSchema.extend({ type: z.literal("revision"), changes: z.array(ShortTextSchema) }).strict(),
  HistoryBaseSchema.extend({ type: z.literal("parent_changed"), parentQuestionId: RequestIdSchema.nullable() }).strict(),
  HistoryBaseSchema.extend({ type: z.enum(["cancelled", "answered", "expired"]), replacementQuestionId: RequestIdSchema.optional() }).strict(),
  HistoryBaseSchema.extend({ type: z.literal("superseded"), replacementQuestionId: RequestIdSchema }).strict()
])) }).strict();

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
    affectedDescendantIds: z.array(RequestIdSchema).optional(),
    descendantGuidance: LongTextSchema.optional(),
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

export const AskReceiptSchema = z.object({
  questionId: RequestIdSchema,
  revision: z.number().int().min(1),
  status: z.literal("pending")
});

export const AnswerReadResultSchema = z.object({
  alreadyRead: z.boolean(),
  question: z.object({
    questionId: RequestIdSchema,
    revision: z.number().int().min(1),
    mode: AskModeSchema,
    urgency: AskUrgencySchema,
    question: AskQuestionSchema,
    options: z.array(AskOptionSchema).min(1).max(OPTIONS_MAX),
    context: HandoffContextSchema.optional(),
    createdAt: z.string().datetime(),
    resolvedAt: z.string().datetime()
  }).strict(),
  answer: z.object({
    answerId: z.string().min(1).max(200),
    questionRevision: z.number().int().min(1),
    status: z.literal("answered"),
    selectedValues: z.array(z.string().min(1).max(200)).min(1).max(SELECTED_VALUES_MAX),
    note: LongTextSchema.optional(),
    rationale: LongTextSchema.optional(),
    createdAt: z.string().datetime()
  }).strict(),
  firstRead: z.object({
    reader: z.object({ harness: ShortTextSchema, ownerId: ShortTextSchema }).strict(),
    readAt: z.string().datetime()
  }).strict()
}).strict();

export const AskRequestSnapshotSchema = z.object({
  requestId: RequestIdSchema,
  sessionId: z.string().min(1).max(200),
  mode: AskModeSchema,
  urgency: AskUrgencySchema.default("normal"),
  question: AskQuestionSchema,
  options: z.array(AskOptionSchema).min(1).max(OPTIONS_MAX),
  context: HandoffContextSchema.optional(),
  forkReference: ForkReferenceSchema.optional(),
  status: AskStatusSchema,
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime().optional(),
  resolvedAt: z.string().datetime().optional(),
  result: AskResultSchema.optional(),
  parentQuestionId: RequestIdSchema.optional(),
  repository: RepositoryIdentitySchema.optional(),
  worktree: WorktreeIdentitySchema.optional(),
  feature: FeatureIdentitySchema.optional()
});

export type AskMode = z.infer<typeof AskModeSchema>;
export type AskStatus = z.infer<typeof AskStatusSchema>;
export type AskUrgency = z.infer<typeof AskUrgencySchema>;
export type RichContextItem = z.infer<typeof RichContextItemSchema>;
export type ForkReference = z.infer<typeof ForkReferenceSchema>;
export type HandoffContext = z.infer<typeof HandoffContextSchema>;
export type AskCreateHandoffContext = z.infer<typeof AskCreateHandoffContextSchema>;
export type AskCreateOption = z.infer<typeof AskCreateOptionSchema>;
export type AskOption = z.infer<typeof AskOptionSchema>;
export type ProposedAnswerOption = z.infer<typeof ProposedAnswerOptionSchema>;
export type ProposeAnswerPayload = z.infer<typeof ProposeAnswerPayloadSchema>;
export type ProposeAnswerErrorCode = z.infer<typeof ProposeAnswerErrorCodeSchema>;
export type ProposeAnswerResult = z.infer<typeof ProposeAnswerResultSchema>;
export type AskQuestion = z.infer<typeof AskQuestionSchema>;
export type AskCreatePayload = z.infer<typeof AskCreatePayloadSchema>;
export type AskQuestionDraft = z.infer<typeof AskQuestionDraftSchema>;
export type AskPostboxInput = z.infer<typeof AskPostboxInputSchema>;
export type AskBatchReceipt = z.infer<typeof AskBatchReceiptSchema>;
export type AskAnswerPayload = z.infer<typeof AskAnswerPayloadSchema>;
export type UpdateQuestionPayload = z.infer<typeof UpdateQuestionPayloadSchema>;
export type QuestionHistory = z.infer<typeof QuestionHistorySchema>;
export type AskCancelPayload = z.infer<typeof AskCancelPayloadSchema>;
export type AskResult = z.infer<typeof AskResultSchema>;
export type AskReceipt = z.infer<typeof AskReceiptSchema>;
export type AnswerReadResult = z.infer<typeof AnswerReadResultSchema>;
export type AskRequestSnapshot = z.infer<typeof AskRequestSnapshotSchema>;
