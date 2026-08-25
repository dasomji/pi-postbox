import { randomUUID } from "node:crypto";
import {
  AskCreatePayloadSchema,
  AskBatchQuestionDraftSchema,
  type AskCreatePayload,
  type AskOption,
  type AskReceipt,
  type AskBatchReceipt,
  type AskResult,
  type ForkReference
} from "@pi-postbox/protocol";
import type { PostboxClient } from "../client/PostboxClient.js";

export interface AskPostboxInput {
  question: string;
  ambiguity: string;
  mode?: "single" | "multi";
  options: AskOption[];
  forkReference?: ForkReference;
  parentQuestionId?: string;
  requestId?: string;
  expiresAt?: string;
}

export interface AskPostboxBatchInput {
  mode: "batch";
  questions: Array<AskPostboxInput & {
    localRef: string;
    parentLocalRef?: string;
  }>;
}

const optionParameters = {
  type: "object", additionalProperties: false, required: ["value", "label"],
  properties: {
    value: { type: "string", minLength: 1, description: "Stable machine-readable value returned when this option is selected." },
    label: { type: "string", minLength: 1, description: "Short user-visible option label." },
    description: { type: "string", minLength: 1, description: "Optional explanation that helps the user understand the option." },
    impact: { type: "string", minLength: 1, description: "What impact and implications would this option have?" }
  }
} as const;
const sharedDraftProperties = {
  question: { type: "string", minLength: 1, description: "Decision question to show in Pi Postbox." },
  ambiguity: { type: "string", minLength: 1, description: "What ambiguity is this question aiming to solve?" },
  requestId: { type: "string", minLength: 1, description: "Optional stable request id for this ask." },
  options: { type: "array", minItems: 1, items: optionParameters, description: "Answer options presented to the user." }
} as const;

export const askPostboxParameters = {
  type: "object",
  additionalProperties: false,
  description: "Create Questions. A Question may have at most five direct children and the hierarchy may have at most four levels.",
  oneOf: [
    {
      additionalProperties: false,
      required: ["question", "ambiguity", "options"],
      properties: {
        question: sharedDraftProperties.question,
        ambiguity: sharedDraftProperties.ambiguity,
        requestId: sharedDraftProperties.requestId,
        options: sharedDraftProperties.options,
        mode: { type: "string", enum: ["single", "multi"], description: "Selection mode for this Question; defaults to single." },
        parentQuestionId: { type: "string", minLength: 1, description: "Optional existing Question ID to use as this Question's parent." }
      }
    },
    {
      additionalProperties: false,
      required: ["mode", "questions"],
      properties: {
        mode: { const: "batch", description: "Creates an ordered batch of Questions." },
        questions: { description: "Ordered complete Question drafts to create." }
      }
    }
  ],
  properties: {
    ...sharedDraftProperties,
    mode: { type: "string", enum: ["single", "multi", "batch"], description: "Single Question selection mode, or ordered batch creation." },
    parentQuestionId: { type: "string", minLength: 1, description: "Optional existing Question ID to use as this Question's parent." },
    questions: { type: "array", minItems: 1, description: "Ordered complete Question drafts to create in batch mode.", items: {
      type: "object", additionalProperties: false, description: "One complete Question draft in the ordered batch.",
      required: ["localRef", "question", "ambiguity", "options"], properties: {
        ...sharedDraftProperties,
        localRef: { type: "string", minLength: 1, description: "Batch-local identifier used by later drafts to reference this Question." },
        mode: { type: "string", enum: ["single", "multi"], description: "Selection mode for this Question; defaults to single." },
        parentQuestionId: { type: "string", minLength: 1, description: "Optional existing Question ID to use as this Question's parent." },
        parentLocalRef: { type: "string", minLength: 1, description: "Optional localRef of an earlier batch draft to use as this Question's parent." }
      }
    } }
  }
} as const;

export function createAskPayload(input: AskPostboxInput, sessionId: string): AskCreatePayload {
  return AskCreatePayloadSchema.parse({
    requestId: input.requestId ?? `ask_${randomUUID()}`,
    sessionId,
    mode: input.mode ?? "single",
    question: {
      prompt: input.question,
      ambiguity: input.ambiguity
    },
    options: input.options,
    forkReference: input.forkReference,
    parentQuestionId: input.parentQuestionId,
    expiresAt: input.expiresAt
  });
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
    const invalidField = Object.keys(input).find((field) => !["mode", "questions"].includes(field));
    if (invalidField) {
      throw new Error(`write_question create_batch does not accept top-level ${invalidField}; put Question-specific fields on each questions item`);
    }
    if (!("createAskBatch" in client)) throw new Error("Postbox client does not support Question batches");
    const questions = input.questions.map(({ localRef, parentQuestionId, parentLocalRef, ...item }) => AskBatchQuestionDraftSchema.parse({
      localRef,
      parentQuestionId,
      parentLocalRef,
      requestId: item.requestId ?? `ask_${randomUUID()}`,
      mode: item.mode ?? "single",
      question: {
        prompt: item.question,
        ambiguity: item.ambiguity
      },
      options: item.options,
      forkReference: item.forkReference,
      expiresAt: item.expiresAt
    }));
    return client.createAskBatch({ sessionId, questions }, signal);
  }
  const payload = createAskPayload(input, sessionId);
  void lifecycle;
  if ("createAsk" in client) return client.createAsk(payload, signal);
  // Compatibility for embedders compiled against the synchronous v1 client.
  if (!("ask" in client)) throw new Error("Postbox client does not support single Questions");
  return client.ask(payload, signal).then((result: AskResult) => {
    if (result.status !== "answered") throw new Error(`Question was not persisted: ${result.status}`);
    return {
      questionId: payload.requestId,
      revision: 1,
      ownerRevision: 1,
      status: "pending" as const,
      disposition: "created" as const
    };
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
  if ("questionId" in result) return `Postbox persisted ${result.questionId} (revision ${result.revision}; disposition: ${result.disposition}); the Answer will arrive asynchronously. Use get_answer with this questionId after notification.`;
  if (result.status === "answered") return `Postbox answered ${result.requestId}: ${result.selectedValues.join(", ")}.`;
  return `Postbox ${result.status} ${result.requestId}.${result.note ? ` ${result.note}` : ""}`;
}
