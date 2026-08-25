import { z } from "zod";
import { FeatureIdentitySchema, RepositoryIdentitySchema, WorktreeIdentitySchema } from "./grouping.js";
import { OwnerIdentitySchema } from "./ownerIdentity.js";

export const OTHER_OPTION_VALUE = "other";

const SHORT_TEXT_MAX = 2_000;
const LONG_TEXT_MAX = 128_000;
const REQUEST_ID_MAX = 200;
const OPTIONS_MAX = 20;
const SELECTED_VALUES_MAX = 20;

const ShortTextSchema = z.string().min(1).max(SHORT_TEXT_MAX);
const LongTextSchema = z.string().min(1).max(LONG_TEXT_MAX);
const RequestIdSchema = z.string().min(1).max(REQUEST_ID_MAX);

export const AskModeSchema = z.enum(["single", "multi"]);
export const ASK_STATUSES = ["pending", "answered", "cancelled", "expired", "superseded"] as const;
export const AskStatusSchema = z.enum(ASK_STATUSES);

export const ForkReferenceSchema = z.object({
  agentSessionId: ShortTextSchema.optional(),
  agentSessionPath: z.string().min(1).max(4_000).optional(),
  leafId: ShortTextSchema.optional(),
  cwd: z.string().min(1).max(4_000).optional(),
  model: ShortTextSchema.optional()
});

export const AskCreateOptionSchema = z.object({
  value: z.string().min(1).max(200),
  label: ShortTextSchema,
  description: LongTextSchema.optional(),
  impact: LongTextSchema.optional()
}).strict();

export const AskOptionProvenanceSchema = z.literal("chat");

export const AskOptionSchema = AskCreateOptionSchema.extend({
  provenance: AskOptionProvenanceSchema.optional()
});

export const ProposedAnswerOptionSchema = AskCreateOptionSchema.extend({
  provenance: AskOptionProvenanceSchema
});

export const ProposeAnswerPayloadSchema = z.object({
  label: ShortTextSchema,
  description: LongTextSchema.optional(),
  impact: LongTextSchema.optional()
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

// Persisted legacy Questions may not have ambiguity yet. Unknown legacy helper
// fields are stripped when reading rather than being re-exposed or synthesized.
export const AskQuestionSchema = z.object({
  prompt: LongTextSchema,
  ambiguity: LongTextSchema.optional()
});

export const AskCreateQuestionSchema = z.object({
  prompt: LongTextSchema,
  ambiguity: z.string().max(LONG_TEXT_MAX).refine(
    (value) => value.trim().length > 0,
    { message: "Question ambiguity must not be blank" }
  )
}).strict();

export const AskCreatePayloadSchema = z.object({
  requestId: RequestIdSchema,
  sessionId: z.string().min(1).max(200),
  mode: AskModeSchema,
  question: AskCreateQuestionSchema,
  options: z.array(AskCreateOptionSchema).min(1).max(OPTIONS_MAX),
  forkReference: ForkReferenceSchema.optional(),
  expiresAt: z.string().datetime().optional(),
  parentQuestionId: RequestIdSchema.optional(),
  repository: RepositoryIdentitySchema.optional(),
  worktree: WorktreeIdentitySchema.optional(),
  feature: FeatureIdentitySchema.optional()
}).strict();

const AskQuestionDraftShape = {
  localRef: RequestIdSchema,
  requestId: RequestIdSchema,
  mode: AskModeSchema.default("single"),
  question: AskCreateQuestionSchema,
  options: z.array(AskCreateOptionSchema).min(1).max(OPTIONS_MAX),
  forkReference: ForkReferenceSchema.optional(),
  expiresAt: z.string().datetime().optional(),
  parentQuestionId: RequestIdSchema.optional(),
  parentLocalRef: RequestIdSchema.optional()
};

function requireUnambiguousParent(
  draft: { parentQuestionId?: string; parentLocalRef?: string },
  context: z.RefinementCtx
): void {
  if (draft.parentQuestionId === undefined || draft.parentLocalRef === undefined) return;
  context.addIssue({
    code: z.ZodIssueCode.custom,
    path: ["parentLocalRef"],
    message: "A Question may reference its parent by Question ID or batch-local reference, not both"
  });
}

export const AskQuestionDraftSchema = z.object(AskQuestionDraftShape)
  .strict()
  .superRefine(requireUnambiguousParent);

export const AskBatchQuestionDraftSchema = AskQuestionDraftSchema;

const AskSingleInputSchema = z.object({ mode: z.literal("single"), question: AskQuestionDraftSchema }).strict();
const AskBatchInputSchema = z.object({
  mode: z.literal("batch"),
  questions: z.array(AskBatchQuestionDraftSchema).min(1)
}).strict()
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
  z.object({
    localRef: RequestIdSchema,
    status: z.literal("created"),
    questionId: RequestIdSchema,
    revision: z.number().int().min(1),
    ownerRevision: z.number().int().min(1),
    questionStatus: AskStatusSchema,
    disposition: z.enum(["created", "idempotent"]),
    nudge: z.string().optional()
  }).strict(),
  z.object({ localRef: RequestIdSchema, status: z.literal("rejected"), reason: z.object({ code: AskBatchRejectionCodeSchema, message: ShortTextSchema }).strict() }).strict()
]);
export const AskBatchReceiptSchema = z.object({ status: z.enum(["created", "partial", "rejected"]), items: z.array(AskBatchItemReceiptSchema).min(1) }).strict();
export const AskAnswerEventSchema = z.object({ questionId: RequestIdSchema, affectedDescendantIds: z.array(RequestIdSchema) }).passthrough();

export const AskAnswerPayloadSchema = z.object({
  expectedRevision: z.number().int().min(1).optional(),
  selectedValues: z.array(z.string().min(1).max(200)).min(1).max(SELECTED_VALUES_MAX),
  note: LongTextSchema.optional()
}).strict();

const ExpectedRevisionSchema = z.number().int().min(1);
const ExpectedOwnerRevisionSchema = z.number().int().min(1);
export const UpdateQuestionPayloadSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("revise"), expectedRevision: ExpectedRevisionSchema, expectedOwnerRevision: ExpectedOwnerRevisionSchema, question: AskCreateQuestionSchema, options: z.array(AskCreateOptionSchema).min(1).max(OPTIONS_MAX).optional() }).strict(),
  z.object({ action: z.literal("cancel"), expectedRevision: ExpectedRevisionSchema, expectedOwnerRevision: ExpectedOwnerRevisionSchema, note: LongTextSchema.optional() }).strict(),
  z.object({ action: z.literal("supersede"), expectedRevision: ExpectedRevisionSchema, expectedOwnerRevision: ExpectedOwnerRevisionSchema, replacementQuestionId: RequestIdSchema }).strict(),
  z.object({ action: z.literal("reparent"), expectedRevision: ExpectedRevisionSchema, expectedOwnerRevision: ExpectedOwnerRevisionSchema, parentQuestionId: RequestIdSchema.nullable() }).strict(),
  z.object({ action: z.literal("transfer"), expectedRevision: ExpectedRevisionSchema, expectedOwnerRevision: ExpectedOwnerRevisionSchema, expectedOwner: OwnerIdentitySchema, owner: OwnerIdentitySchema }).strict(),
  z.object({ action: z.literal("takeover"), expectedRevision: ExpectedRevisionSchema, expectedOwnerRevision: ExpectedOwnerRevisionSchema, expectedOwner: OwnerIdentitySchema }).strict()
]);
const HistoryActorSchema = z.object({ harness: ShortTextSchema, ownerId: ShortTextSchema }).strict();
const FirstReadReceiptSchema = z.object({ reader: HistoryActorSchema, readAt: z.string().datetime() }).strict();
export const QuestionResolutionSchema = z.union([
  z.object({
    kind: z.literal("answer"),
    answerId: RequestIdSchema,
    questionRevision: ExpectedRevisionSchema,
    answer: z.array(z.string().min(1).max(200)).min(1).max(SELECTED_VALUES_MAX),
    note: LongTextSchema.optional(),
    resolvedAt: z.string().datetime(),
    firstRead: FirstReadReceiptSchema.nullable()
  }).strict(),
  z.object({
    kind: z.literal("lifecycle"),
    status: z.literal("cancelled"),
    note: LongTextSchema.optional(),
    resolvedAt: z.string().datetime()
  }).strict(),
  z.object({
    kind: z.literal("lifecycle"),
    status: z.literal("expired"),
    note: LongTextSchema.optional(),
    resolvedAt: z.string().datetime()
  }).strict(),
  z.object({
    kind: z.literal("lifecycle"),
    status: z.literal("superseded"),
    replacementQuestionId: RequestIdSchema,
    resolvedAt: z.string().datetime()
  }).strict()
]);
const HistoryBaseSchema = z.object({ revision: ExpectedRevisionSchema, actor: HistoryActorSchema, at: z.string().datetime() });
export const QuestionRevisionSnapshotSchema = HistoryBaseSchema.extend({
  question: AskQuestionSchema,
  options: z.array(AskOptionSchema)
}).strict();
export const QuestionContentRevisionSchema = HistoryBaseSchema.extend({
  question: AskQuestionSchema.optional(),
  options: z.array(AskOptionSchema).optional()
}).strict().superRefine((revision, context) => {
  if (revision.question !== undefined || revision.options !== undefined) return;
  context.addIssue({
    code: z.ZodIssueCode.custom,
    message: "A content revision must replace at least one Question content section"
  });
});
const QuestionRevisionEventSchema = HistoryBaseSchema.extend({
  type: z.literal("revision"),
  changes: z.array(z.enum(["question", "options"])).min(1)
}).strict();
export const QuestionNonContentEventSchema = z.union([
  HistoryBaseSchema.extend({ type: z.literal("parent_changed"), parentQuestionId: RequestIdSchema.nullable() }).strict(),
  HistoryBaseSchema.extend({ type: z.enum(["cancelled", "answered", "expired"]) }).strict(),
  HistoryBaseSchema.extend({ type: z.literal("superseded"), replacementQuestionId: RequestIdSchema }).strict(),
  HistoryBaseSchema.extend({
    type: z.literal("owner_changed"),
    ownerRevision: ExpectedOwnerRevisionSchema,
    previousOwner: OwnerIdentitySchema,
    owner: OwnerIdentitySchema,
    reason: z.enum(["transfer", "takeover"])
  }).strict()
]);
export const QuestionHistorySchema = z.object({
  questionId: RequestIdSchema,
  revisions: z.array(QuestionRevisionSnapshotSchema),
  events: z.array(z.union([QuestionRevisionEventSchema, QuestionNonContentEventSchema]))
}).strict();
export const QuestionEventHistorySchema = z.object({
  questionId: RequestIdSchema,
  initial: QuestionRevisionSnapshotSchema,
  revisions: z.array(QuestionContentRevisionSchema),
  events: z.array(QuestionNonContentEventSchema)
}).strict();

export const AskCancelPayloadSchema = z.object({
  note: LongTextSchema.optional()
}).strict();

export const AskResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("answered"),
    requestId: RequestIdSchema,
    selectedValues: z.array(z.string().min(1).max(200)).min(1).max(SELECTED_VALUES_MAX),
    note: LongTextSchema.optional(),
    affectedDescendantIds: z.array(RequestIdSchema).optional(),
    descendantGuidance: LongTextSchema.optional(),
    resolvedAt: z.string().datetime()
  }),
  z.object({
    status: z.literal("cancelled"),
    requestId: RequestIdSchema,
    note: LongTextSchema.optional(),
    resolvedAt: z.string().datetime()
  }),
  z.object({
    status: z.literal("expired"),
    requestId: RequestIdSchema,
    note: LongTextSchema.optional(),
    resolvedAt: z.string().datetime()
  }),
  z.object({
    status: z.literal("unavailable"),
    requestId: RequestIdSchema,
    note: LongTextSchema.optional(),
    resolvedAt: z.string().datetime()
  })
]);

export const AskReceiptSchema = z.object({
  questionId: RequestIdSchema,
  revision: z.number().int().min(1),
  ownerRevision: z.number().int().min(1),
  status: AskStatusSchema,
  disposition: z.enum(["created", "idempotent"])
});

const HumanAnswerReadResultSchema = z.object({
  questionId: RequestIdSchema,
  answerId: RequestIdSchema,
  answer: z.array(z.string().min(1).max(200)).min(1).max(SELECTED_VALUES_MAX),
  note: LongTextSchema.optional()
}).strict();

const LifecycleReadBaseSchema = z.object({
  type: z.literal("lifecycle"),
  questionId: RequestIdSchema,
  note: LongTextSchema.optional(),
  resolvedAt: z.string().datetime()
}).strict();

export const LifecycleResolutionReadResultSchema = z.discriminatedUnion("status", [
  LifecycleReadBaseSchema.extend({ status: z.literal("cancelled"), note: LongTextSchema.optional() }).strict(),
  LifecycleReadBaseSchema.extend({ status: z.literal("expired") }).strict(),
  LifecycleReadBaseSchema.extend({ status: z.literal("superseded"), replacementQuestionId: RequestIdSchema }).strict()
]);

export const PendingAnswerReadResultSchema = z.object({
  type: z.literal("pending"),
  status: z.literal("pending"),
  questionId: RequestIdSchema
}).strict();

export const AnswerReadResultSchema = z.union([
  PendingAnswerReadResultSchema,
  HumanAnswerReadResultSchema,
  LifecycleResolutionReadResultSchema
]);

export const AskRequestSnapshotSchema = z.object({
  requestId: RequestIdSchema,
  sessionId: z.string().min(1).max(200),
  revision: z.number().int().min(1),
  ownerRevision: z.number().int().min(1).default(1),
  creator: OwnerIdentitySchema,
  owner: OwnerIdentitySchema,
  mode: AskModeSchema,
  question: AskQuestionSchema,
  options: z.array(AskOptionSchema).min(1).max(OPTIONS_MAX),
  forkReference: ForkReferenceSchema.optional(),
  status: AskStatusSchema,
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime().optional(),
  resolvedAt: z.string().datetime().optional(),
  result: AskResultSchema.optional(),
  answerId: RequestIdSchema.optional(),
  answerRead: z.boolean().optional(),
  parentQuestionId: RequestIdSchema.optional(),
  repository: RepositoryIdentitySchema.optional(),
  worktree: WorktreeIdentitySchema.optional(),
  feature: FeatureIdentitySchema.optional()
}).strict().superRefine((snapshot, context) => {
  if (snapshot.status === "answered" || (snapshot.answerId === undefined && snapshot.answerRead === undefined)) return;
  context.addIssue({
    code: z.ZodIssueCode.custom,
    path: ["answerId"],
    message: "Lifecycle-only Questions cannot expose human Answer metadata"
  });
});

export type AskMode = z.infer<typeof AskModeSchema>;
export type AskStatus = z.infer<typeof AskStatusSchema>;
export type ForkReference = z.infer<typeof ForkReferenceSchema>;
export type AskCreateOption = z.infer<typeof AskCreateOptionSchema>;
export type AskOption = z.infer<typeof AskOptionSchema>;
export type ProposedAnswerOption = z.infer<typeof ProposedAnswerOptionSchema>;
export type ProposeAnswerPayload = z.infer<typeof ProposeAnswerPayloadSchema>;
export type ProposeAnswerErrorCode = z.infer<typeof ProposeAnswerErrorCodeSchema>;
export type ProposeAnswerResult = z.infer<typeof ProposeAnswerResultSchema>;
export type AskQuestion = z.infer<typeof AskQuestionSchema>;
export type AskCreateQuestion = z.infer<typeof AskCreateQuestionSchema>;
export type AskCreatePayload = z.infer<typeof AskCreatePayloadSchema>;
export type AskQuestionDraft = z.infer<typeof AskQuestionDraftSchema>;
export type AskBatchQuestionDraft = z.infer<typeof AskBatchQuestionDraftSchema>;
export type AskPostboxInput = z.infer<typeof AskPostboxInputSchema>;
export type AskBatchReceipt = z.infer<typeof AskBatchReceiptSchema>;
export type AskAnswerPayload = z.infer<typeof AskAnswerPayloadSchema>;
export type UpdateQuestionPayload = z.infer<typeof UpdateQuestionPayloadSchema>;
export type QuestionResolution = z.infer<typeof QuestionResolutionSchema>;
export type QuestionRevisionSnapshot = z.infer<typeof QuestionRevisionSnapshotSchema>;
export type QuestionContentRevision = z.infer<typeof QuestionContentRevisionSchema>;
export type QuestionNonContentEvent = z.infer<typeof QuestionNonContentEventSchema>;
export type QuestionHistory = z.infer<typeof QuestionHistorySchema>;
export type QuestionEventHistory = z.infer<typeof QuestionEventHistorySchema>;
export type AskCancelPayload = z.infer<typeof AskCancelPayloadSchema>;
export type AskResult = z.infer<typeof AskResultSchema>;
export type AskReceipt = z.infer<typeof AskReceiptSchema>;
export type PendingAnswerReadResult = z.infer<typeof PendingAnswerReadResultSchema>;
export type AnswerReadResult = z.infer<typeof AnswerReadResultSchema>;
export type AskRequestSnapshot = z.infer<typeof AskRequestSnapshotSchema>;
