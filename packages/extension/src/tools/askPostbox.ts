import { randomUUID } from "node:crypto";
import {
  AskCreatePayloadSchema,
  AskBatchDefaultsSchema,
  AskBatchQuestionDraftSchema,
  type AskCreatePayload,
  type AskCreateHandoffContext,
  type AskBatchDefaults,
  type AskOption,
  type AskReceipt,
  type AskBatchReceipt,
  type AskResult,
  type ForkReference
} from "@pi-postbox/protocol";
import type { PostboxClient } from "../client/PostboxClient.js";

export interface AskPostboxInput {
  question: string;
  questionContext?: string;
  relevance?: string;
  decisionImpact?: string;
  mode?: "single" | "multi";
  options: AskOption[];
  context: AskCreateHandoffContext;
  forkReference?: ForkReference;
  parent?: { questionId: string };
  requestId?: string;
  timeoutMs?: number;
  expiresAt?: string;
}

export interface AskPostboxBatchInput {
  mode: "batch";
  defaults: AskBatchDefaults;
  questions: Array<Omit<AskPostboxInput, "context"> & {
    localRef: string;
    context?: AskCreateHandoffContext;
    parent?: { questionId: string } | { localRef: string };
  }>;
}

const optionParameters = {
  type: "object", additionalProperties: false, required: ["value", "label"],
  properties: {
    value: { type: "string", minLength: 1 }, label: { type: "string", minLength: 1 },
    description: { type: "string", minLength: 1 }, meaning: { type: "string", minLength: 1 },
    context: { type: "string", minLength: 1 }
  }
} as const;
const contextParameters = {
  type: "object", additionalProperties: false, required: ["codebaseContext", "problemContext"],
  properties: {
    codebaseContext: { type: "string", minLength: 1 }, problemContext: { type: "string", minLength: 1 },
    additionalInfo: { type: "array", maxItems: 20, items: { type: "object", additionalProperties: false, required: ["content"], properties: {
      kind: { type: "string", enum: ["text", "code", "diagram", "link"] }, title: { type: "string", minLength: 1 },
      content: { type: "string", minLength: 1 }, language: { type: "string", minLength: 1 }
    } } }
  }
} as const;
const forkReferenceParameters = {
  type: "object", additionalProperties: false, properties: {
    agentSessionId: { type: "string", minLength: 1 }, agentSessionPath: { type: "string", minLength: 1 },
    leafId: { type: "string", minLength: 1 }, cwd: { type: "string", minLength: 1 }, model: { type: "string", minLength: 1 }
  }
} as const;
const sharedDraftProperties = {
  question: { type: "string", minLength: 1 }, questionContext: { type: "string", minLength: 1 },
  relevance: { type: "string", minLength: 1 }, decisionImpact: { type: "string", minLength: 1 },
  requestId: { type: "string", minLength: 1 },
  timeoutMs: { type: "number", minimum: 1 }, expiresAt: { type: "string", minLength: 1 },
  options: { type: "array", minItems: 1, items: optionParameters }, context: contextParameters,
  forkReference: forkReferenceParameters
} as const;

export const askPostboxParameters = {
  type: "object",
  additionalProperties: false,
  description: "Create Questions. A Question may have at most five direct children and the hierarchy may have at most four levels.",
  oneOf: [
    {
      additionalProperties: false,
      required: ["question", "options", "context"],
      properties: {
        question: {}, questionContext: {}, relevance: {}, decisionImpact: {}, requestId: {}, timeoutMs: {},
        expiresAt: {}, options: {}, context: {}, forkReference: {}, mode: { type: "string", enum: ["single", "multi"] }, parent: {}
      }
    },
    {
      additionalProperties: false,
      required: ["mode", "defaults", "questions"],
      properties: { mode: { const: "batch" }, defaults: {}, questions: {} }
    }
  ],
  properties: {
    ...sharedDraftProperties,
    question: { ...sharedDraftProperties.question, description: "Decision question to show in Pi Postbox." },
    questionContext: { type: "string", minLength: 1, description: "Concrete context for why this question is being asked." },
    relevance: { type: "string", minLength: 1, description: "Why this question is relevant now." },
    decisionImpact: { type: "string", minLength: 1, description: "What effect this decision will have." },
    mode: { type: "string", enum: ["single", "multi", "batch"], description: "Single Question selection mode, or ordered batch creation." },
    requestId: { type: "string", minLength: 1, description: "Optional stable request id for this ask." },
    timeoutMs: { type: "number", minimum: 1, description: "Optional request expiry timeout in milliseconds." },
    expiresAt: { type: "string", minLength: 1, description: "Optional ISO datetime when this request expires." },
    parent: { type: "object", additionalProperties: false, required: ["questionId"], properties: {
      questionId: { type: "string", minLength: 1 }
    } },
    defaults: { type: "object", additionalProperties: false, required: ["context"], properties: {
      context: contextParameters
    }, description: "Shared batch values expanded and validated by the server before each Question is persisted." },
    questions: { type: "array", minItems: 1, items: { type: "object", additionalProperties: false,
      required: ["localRef", "question", "options"], properties: {
        ...sharedDraftProperties, localRef: { type: "string", minLength: 1 },
        mode: { type: "string", enum: ["single", "multi"] },
        parent: { oneOf: [
          { type: "object", additionalProperties: false, required: ["questionId"], properties: { questionId: { type: "string", minLength: 1 } } },
          { type: "object", additionalProperties: false, required: ["localRef"], properties: { localRef: { type: "string", minLength: 1 } } }
        ] }
      } }
    }
  }
} as const;

export function createAskPayload(input: AskPostboxInput, sessionId: string): AskCreatePayload {
  const context = mergeHandoffContext(input);
  return AskCreatePayloadSchema.parse({
    requestId: input.requestId ?? `ask_${randomUUID()}`,
    sessionId,
    mode: input.mode ?? "single",
    question: {
      prompt: input.question,
      context: input.questionContext,
      relevance: input.relevance,
      decisionImpact: input.decisionImpact
    },
    options: input.options,
    context,
    forkReference: input.forkReference,
    parentQuestionId: input.parent?.questionId,
    expiresAt: input.expiresAt ?? (input.timeoutMs ? new Date(Date.now() + input.timeoutMs).toISOString() : undefined)
  });
}

function mergeHandoffContext(input: AskPostboxInput): AskCreateHandoffContext {
  const context = input.context;
  if (!context || typeof context.codebaseContext !== "string" || context.codebaseContext.trim().length === 0) {
    throw new Error("ask_postbox requires non-blank codebaseContext");
  }
  if (typeof context.problemContext !== "string" || context.problemContext.trim().length === 0) {
    throw new Error("ask_postbox requires non-blank problemContext");
  }
  return {
    codebaseContext: context.codebaseContext,
    problemContext: context.problemContext,
    additionalInfo: context.additionalInfo
  };
}

export interface AskPostboxWaitLifecycle {
  beginAskPostboxWait(label?: string): () => void;
}

export async function executeAskPostbox(
  input: AskPostboxInput | AskPostboxBatchInput,
  client: Pick<PostboxClient, "createAsk"> | Pick<PostboxClient, "ask"> | { createAskBatch(payload: unknown, signal?: AbortSignal): Promise<AskBatchReceipt> },
  sessionId: string,
  signal?: AbortSignal,
  lifecycle?: AskPostboxWaitLifecycle
): Promise<AskReceipt | AskBatchReceipt> {
  if (input.mode === "batch") {
    const invalidField = Object.keys(input).find((field) => !["mode", "defaults", "questions"].includes(field));
    if (invalidField) {
      throw new Error(`ask_postbox batch does not accept top-level ${invalidField}; put Question-specific fields on each questions item`);
    }
    if (!("createAskBatch" in client)) throw new Error("Postbox client does not support Question batches");
    const defaults = AskBatchDefaultsSchema.parse(input.defaults);
    const questions = input.questions.map(({ localRef, parent, ...item }) => AskBatchQuestionDraftSchema.parse({
      localRef,
      parent,
      requestId: item.requestId ?? `ask_${randomUUID()}`,
      mode: item.mode ?? "single",
      question: {
        prompt: item.question,
        context: item.questionContext,
        relevance: item.relevance,
        decisionImpact: item.decisionImpact
      },
      options: item.options,
      ...(item.context ? { context: item.context } : {}),
      forkReference: item.forkReference,
      expiresAt: item.expiresAt ?? (item.timeoutMs ? new Date(Date.now() + item.timeoutMs).toISOString() : undefined)
    }));
    return client.createAskBatch({ sessionId, defaults, questions }, signal);
  }
  const payload = createAskPayload(input, sessionId);
  void lifecycle;
  if ("createAsk" in client) return client.createAsk(payload, signal);
  // Compatibility for embedders compiled against the synchronous v1 client.
  if (!("ask" in client)) throw new Error("Postbox client does not support single Questions");
  return client.ask(payload, signal).then((result: AskResult) => {
    if (result.status !== "answered") throw new Error(`Question was not persisted: ${result.status}`);
    return { questionId: payload.requestId, revision: 1, status: "pending" as const };
  });
}

export function formatAskResult(result: AskReceipt | AskResult | AskBatchReceipt): string {
  if ("items" in result) {
    const items = result.items.map((item) => item.status === "created"
      ? {
          localRef: item.localRef,
          questionId: item.questionId,
          revision: item.revision,
          disposition: item.disposition
        }
      : { localRef: item.localRef, disposition: "rejected", reason: item.reason.code });
    return `Postbox batch ${result.status}: ${JSON.stringify(items)}`;
  }
  if ("questionId" in result) return `Postbox persisted ${result.questionId} (revision ${result.revision}); the Answer will arrive asynchronously. Use get_answer with this questionId after notification.`;
  if (result.status === "answered") return `Postbox answered ${result.requestId}: ${result.selectedValues.join(", ")}.`;
  return `Postbox ${result.status} ${result.requestId}.${result.note ? ` ${result.note}` : ""}`;
}
