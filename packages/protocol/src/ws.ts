import { z } from "zod";
import {
  AskAnswerPayloadSchema,
  AskCancelPayloadSchema,
  AskCreatePayloadSchema,
  AskBatchQuestionDraftSchema,
  AskBatchReceiptSchema,
  AskResultSchema,
  AskStatusSchema,
  UpdateQuestionPayloadSchema,
  AnswerReadResultSchema,
  ProposeAnswerPayloadSchema,
  ProposeAnswerResultSchema
} from "./ask.js";
import { OwnerIdentitySchema } from "./ownerIdentity.js";
import {
  QuestionChatAvailabilityErrorSchema,
  QuestionChatEventSchema,
  QuestionChatSendPayloadSchema,
  QuestionChatSendResponseSchema,
  QuestionChatStopPayloadSchema,
  QuestionChatStopResponseSchema,
  QuestionChatSnapshotSchema,
  QuestionChatSourceSchema
} from "./chat.js";
import {
  HeartbeatPayloadSchema,
  PostboxOwnerListScopeSchema,
  SessionRegisterPayloadSchema,
  SessionShutdownPayloadSchema,
  SessionUpdatePayloadSchema
} from "./session.js";
import { FeatureActionSchema, FeatureIdentitySchema } from "./grouping.js";
import {
  POSTBOX_CURSOR_MAX_LENGTH,
  POSTBOX_EXPLICIT_ID_MAX,
  POSTBOX_OWNER_PAGE_MAX,
  QUESTION_DISCOVERY_PAGE_MAX,
  QUESTION_HISTORY_PAGE_MAX,
  QUESTION_STATUS_PAGE_MAX
} from "./limits.js";

const WsCorrelationIdSchema = z.string().min(1).max(200);
const PaginationCursorSchema = z.string().min(1).max(POSTBOX_CURSOR_MAX_LENGTH);
const DiscoveryPageSizeSchema = z.number().int().positive().max(QUESTION_DISCOVERY_PAGE_MAX);
const StatusPageSizeSchema = z.number().int().positive().max(QUESTION_STATUS_PAGE_MAX);
const HistoryPageSizeSchema = z.number().int().positive().max(QUESTION_HISTORY_PAGE_MAX);
const OwnerPageSizeSchema = z.number().int().positive().max(POSTBOX_OWNER_PAGE_MAX);
const QuestionChatRecoveryOfferSchema = z.object({
  requestId: WsCorrelationIdSchema,
  ownerSessionId: z.string().min(1).max(200),
  forkKind: z.literal("exact")
});

const QuestionDiscoveryScopeSchema = z.enum(["owner", "feature", "worktree", "repository", "global"]);

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
  z.object({ type: z.literal("feature.action"), requestId: WsCorrelationIdSchema,
    payload: z.discriminatedUnion("action", [
      z.object({ sessionId: z.string().min(1), action: z.literal("start"), name: z.string().min(1) }).strict(),
      z.object({ sessionId: z.string().min(1), action: z.literal("select"), featureId: z.string().min(1) }).strict(),
      z.object({ sessionId: z.string().min(1), action: z.literal("inherit"), featureId: z.string().min(1) }).strict()
    ]) }),
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
    type: z.literal("ask.batch.create"),
    requestId: WsCorrelationIdSchema,
    payload: z.object({
      sessionId: z.string().min(1),
      questions: z.array(AskBatchQuestionDraftSchema).min(1)
    }).strict()
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
    type: z.literal("answer.get"),
    requestId: WsCorrelationIdSchema,
    payload: z.object({ questionId: z.string().min(1).max(200) }).strict()
  }),
  z.object({
    type: z.literal("answer.available.ack"),
    requestId: WsCorrelationIdSchema,
    payload: z.object({ answerId: z.string().min(1).max(200) }).strict()
  }),
  z.object({ type: z.literal("question.list"), requestId: WsCorrelationIdSchema,
    payload: z.object({ sessionId: z.string().min(1), scope: QuestionDiscoveryScopeSchema.optional(), owner: OwnerIdentitySchema.optional(), repository: z.string().optional(), worktree: z.string().optional(), feature: z.string().optional(), status: AskStatusSchema.optional(), global: z.boolean().optional(), cursor: PaginationCursorSchema.optional(), pageSize: DiscoveryPageSizeSchema.optional() }).strict() }),
  z.object({ type: z.literal("questions.get"), requestId: WsCorrelationIdSchema, payload: z.object({
    questionIds: z.array(z.string().min(1).max(200)).min(1).max(POSTBOX_EXPLICIT_ID_MAX),
    view: z.enum(["control", "full"]).optional()
  }).strict() }),
  z.object({ type: z.literal("question.status.list"), requestId: WsCorrelationIdSchema, payload: z.object({ sessionId: z.string().min(1), scope: QuestionDiscoveryScopeSchema.optional(), owner: OwnerIdentitySchema.optional(), repository: z.string().optional(), worktree: z.string().optional(), feature: z.string().optional(), status: AskStatusSchema.optional(), global: z.boolean().optional(), readState: z.enum(["read", "unread"]).optional(), includeTerminal: z.boolean().optional(), cursor: PaginationCursorSchema.optional(), pageSize: StatusPageSizeSchema.optional() }).strict() }),
  z.object({ type: z.literal("owner.status.get"), requestId: WsCorrelationIdSchema, payload: z.object({ owners: z.array(OwnerIdentitySchema).min(1).max(POSTBOX_EXPLICIT_ID_MAX) }).strict() }),
  z.object({ type: z.literal("owner.list"), requestId: WsCorrelationIdSchema, payload: z.object({
    sessionId: z.string().min(1),
    scope: PostboxOwnerListScopeSchema.optional(),
    includeInactive: z.boolean().optional(),
    cursor: PaginationCursorSchema.optional(),
    pageSize: OwnerPageSizeSchema.optional()
  }).strict() }),
  z.object({ type: z.literal("question.update"), requestId: WsCorrelationIdSchema, payload: z.object({ sessionId: z.string().min(1), questionId: z.string().min(1), update: UpdateQuestionPayloadSchema }).strict() }),
  z.object({ type: z.literal("question.history.get"), requestId: WsCorrelationIdSchema, payload: z.object({
    questionId: z.string().min(1).max(200),
    view: z.enum(["events", "full"]).optional(),
    cursor: PaginationCursorSchema.optional(),
    pageSize: HistoryPageSizeSchema.optional()
  }).strict() }),
  z.object({ type: z.literal("question.answer.recover"), requestId: WsCorrelationIdSchema, payload: z.object({
    sessionId: z.string().min(1),
    questionId: z.string().min(1),
    view: z.enum(["compact", "full"]).optional()
  }).strict() }),
  z.object({ type: z.literal("postbox.wait"), requestId: WsCorrelationIdSchema,
    payload: z.object({ sessionId: z.string().min(1) }).strict() }),
  z.object({ type: z.literal("postbox.wait.cancel"), requestId: WsCorrelationIdSchema,
    payload: z.object({ sessionId: z.string().min(1), waitRequestId: WsCorrelationIdSchema }).strict() }),
  z.object({
    type: z.literal("chat.ready"),
    requestId: WsCorrelationIdSchema,
    payload: QuestionChatSnapshotSchema
  }),
  z.object({
    type: z.literal("chat.error"),
    requestId: WsCorrelationIdSchema,
    payload: z.object({ requestId: z.string().min(1), error: QuestionChatAvailabilityErrorSchema })
  }),
  z.object({
    type: z.literal("chat.snapshot"),
    requestId: WsCorrelationIdSchema,
    payload: QuestionChatSnapshotSchema
  }),
  z.object({
    type: z.literal("chat.send.accepted"),
    requestId: WsCorrelationIdSchema,
    payload: z.object({ requestId: z.string().min(1), response: QuestionChatSendResponseSchema })
  }),
  z.object({
    type: z.literal("chat.event"),
    payload: QuestionChatEventSchema
  }),
  z.object({
    type: z.literal("chat.propose-answer"),
    requestId: WsCorrelationIdSchema,
    payload: z.object({
      requestId: WsCorrelationIdSchema,
      proposal: ProposeAnswerPayloadSchema
    }).strict()
  }),
  z.object({
    type: z.literal("chat.stop.accepted"),
    requestId: WsCorrelationIdSchema,
      payload: z.object({ requestId: WsCorrelationIdSchema, response: QuestionChatStopResponseSchema })
  }),
  z.object({
    type: z.literal("chat.recover.offer"),
    requestId: WsCorrelationIdSchema,
    payload: QuestionChatRecoveryOfferSchema
  }),
  z.object({
    type: z.literal("chat.recover.complete"),
    requestId: WsCorrelationIdSchema,
    payload: z.object({ ownerSessionId: z.string().min(1).max(200) })
  }),
  z.object({
    type: z.literal("chat.reconciled"),
    requestId: WsCorrelationIdSchema,
    payload: z.object({
      requestId: WsCorrelationIdSchema,
      forkKind: z.literal("exact"),
      result: z.discriminatedUnion("status", [
        z.object({ status: z.literal("recovered"), snapshot: QuestionChatSnapshotSchema }),
        z.object({ status: z.literal("deleted") }),
        z.object({ status: z.literal("failed"), message: z.string().min(1).max(2_000) })
      ])
    })
  })
]);

export const ExtensionServerMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("registered"),
    requestId: z.string().min(1).optional(),
    payload: z.object({ sessionId: z.string().min(1), presence: z.literal("live"), feature: FeatureIdentitySchema.optional() })
  }),
  z.object({
    type: z.literal("ack"),
    requestId: z.string().min(1).optional(),
    payload: z.object({ type: z.string().min(1) })
  }),
  z.object({
    type: z.literal("ask.created"),
    requestId: z.string().min(1).optional(),
    payload: z.object({
      requestId: z.string().min(1),
      questionId: z.string().min(1),
      revision: z.number().int().min(1),
      ownerRevision: z.number().int().min(1),
      status: AskStatusSchema,
      disposition: z.enum(["created", "idempotent"])
    })
  }),
  z.object({
    type: z.literal("ask.batch.result"),
    requestId: WsCorrelationIdSchema,
    payload: AskBatchReceiptSchema
  }),
  z.object({
    type: z.literal("answer.available"),
    requestId: z.string().min(1).optional(),
    payload: z.object({
      questionId: z.string().min(1),
      question: z.string().min(1),
      answerId: z.string().min(1)
    }).strict()
  }),
  z.object({
    type: z.literal("answer.result"),
    requestId: WsCorrelationIdSchema,
    payload: AnswerReadResultSchema
  }),
  z.object({ type: z.literal("question.list.result"), requestId: WsCorrelationIdSchema,
    payload: z.object({ scope: z.object({ repositoryId: z.string(), worktreeId: z.string(), featureId: z.string(),
        level: QuestionDiscoveryScopeSchema }).strict(),
      questions: z.array(z.object({ questionId: z.string(), question: z.string() }).strict()).max(QUESTION_DISCOVERY_PAGE_MAX), nextCursor: PaginationCursorSchema.optional() }).strict() }),
  z.object({ type: z.literal("query.result"), requestId: WsCorrelationIdSchema, payload: z.unknown() }),
  z.object({ type: z.literal("postbox.wait.result"), requestId: WsCorrelationIdSchema, payload: z.record(z.unknown()) }),
  z.object({
    type: z.literal("ask.resolved"),
    requestId: z.string().min(1).optional(),
    payload: AskResultSchema
  }),
  z.object({
    type: z.literal("chat.activate"),
    requestId: WsCorrelationIdSchema,
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
      reason: z.enum(["answered", "cancelled", "expired", "session_shutdown", "missing", "wrong_owner"])
    })
  }),
  z.object({
    type: z.literal("chat.snapshot"),
    requestId: WsCorrelationIdSchema,
    payload: z.object({
      requestId: z.string().min(1).max(200),
      ownerSessionId: z.string().min(1).max(200)
    })
  }),
  z.object({
    type: z.literal("chat.send"),
    requestId: WsCorrelationIdSchema,
    payload: z.object({
      requestId: z.string().min(1).max(200),
      ownerSessionId: z.string().min(1).max(200),
      command: QuestionChatSendPayloadSchema
    })
  }),
  z.object({
    type: z.literal("chat.stop"),
    requestId: WsCorrelationIdSchema,
    payload: z.object({
      requestId: WsCorrelationIdSchema,
      ownerSessionId: z.string().min(1).max(200),
      command: QuestionChatStopPayloadSchema
    })
  }),
  z.object({
    type: z.literal("chat.propose-answer.result"),
    requestId: WsCorrelationIdSchema,
    payload: z.object({
      requestId: WsCorrelationIdSchema,
      result: ProposeAnswerResultSchema
    }).strict()
  }),
  z.object({
    type: z.literal("chat.reconcile"),
    requestId: WsCorrelationIdSchema,
    payload: z.discriminatedUnion("action", [
      z.object({
        requestId: WsCorrelationIdSchema,
        forkKind: z.literal("exact"),
        action: z.literal("recover"),
        reason: z.literal("pending")
      }),
      z.object({
        requestId: WsCorrelationIdSchema,
        forkKind: z.literal("exact"),
        action: z.literal("delete"),
        reason: z.enum(["missing", "terminal", "wrong_owner"])
      })
    ])
  }),
  z.object({
    type: z.literal("error"),
    requestId: z.string().min(1).optional(),
    error: z.object({ code: z.string().min(1), message: z.string().min(1) })
  })
]);

export type ExtensionClientMessage = z.infer<typeof ExtensionClientMessageSchema>;
export type ExtensionServerMessage = z.infer<typeof ExtensionServerMessageSchema>;
