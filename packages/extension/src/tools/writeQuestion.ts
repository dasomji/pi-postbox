import {
  UpdateQuestionPayloadSchema,
  type AskBatchReceipt,
  type AskOption,
  type AskReceipt,
  type AskResult,
  type OwnerIdentity,
  type UpdateQuestionPayload
} from "../protocol.js";
import type { AskPostboxBatchInput, AskPostboxInput } from "./askPostbox.js";

export const WRITE_QUESTION_ACTIONS = [
  "create",
  "create_batch",
  "revise",
  "cancel",
  "supersede",
  "reparent",
  "transfer",
  "takeover"
] as const;

export type WriteQuestionAction = typeof WRITE_QUESTION_ACTIONS[number];

export interface WriteQuestionDraftInput {
  localRef: string;
  question: string;
  ambiguity: string;
  options: AskOption[];
  mode?: "single" | "multi";
  requestId?: string;
  parentQuestionId?: string;
  parentLocalRef?: string;
}

export interface WriteQuestionInput {
  action: WriteQuestionAction;
  questionId?: string;
  question?: string;
  ambiguity?: string;
  options?: AskOption[];
  mode?: "single" | "multi";
  requestId?: string;
  parentQuestionId?: string | null;
  questions?: WriteQuestionDraftInput[];
  expectedRevision?: number;
  expectedOwnerRevision?: number;
  note?: string;
  replacementQuestionId?: string;
  expectedOwner?: OwnerIdentity;
  owner?: OwnerIdentity;
}

const optionParameters = {
  type: "object", additionalProperties: false, required: ["value", "label"],
  properties: {
    value: { type: "string", minLength: 1, description: "Machine value." },
    label: { type: "string", minLength: 1, description: "Visible label." },
    description: { type: "string", minLength: 1, description: "Optional detail." },
    impact: { type: "string", minLength: 1, description: "Choice impact." }
  }
} as const;

const ownerParameters = {
  type: "object", additionalProperties: false, required: ["harness", "ownerId"],
  properties: {
    harness: { type: "string", minLength: 1 },
    ownerId: { type: "string", minLength: 1 }
  }
} as const;

const draftProperties = {
  question: { type: "string", minLength: 1, description: "Prompt; create/revise." },
  ambiguity: { type: "string", minLength: 1, description: "Ambiguity; create/revise." },
  options: {
    type: "array", minItems: 1, maxItems: 20, items: optionParameters,
    description: "Create requires; revise optionally replaces."
  },
  mode: { type: "string", enum: ["single", "multi"], description: "Defaults to single." },
  requestId: { type: "string", minLength: 1, description: "Idempotency ID." },
  parentQuestionId: { type: ["string", "null"], description: "Parent for create/reparent; null moves a Question to the root." }
} as const;

export const writeQuestionParameters = {
  type: "object",
  additionalProperties: false,
  required: ["action"],
  description: "Create or change Postbox Questions. Create actions return current Question handles. Existing-Question actions require questionId plus both current revision tokens; action-specific fields are strictly validated.",
  properties: {
    action: {
      type: "string",
      enum: WRITE_QUESTION_ACTIONS,
      description: "Operation to perform. create_batch uses questions; every other action targets one Question."
    },
    questionId: { type: "string", minLength: 1, description: "Target Question for revise and lifecycle/ownership actions." },
    ...draftProperties,
    questions: {
      type: "array", minItems: 1, description: "Ordered complete drafts; required only for create_batch.",
      items: {
        type: "object", additionalProperties: false,
        required: ["localRef", "question", "ambiguity", "options"],
        properties: {
          question: draftProperties.question,
          ambiguity: draftProperties.ambiguity,
          options: draftProperties.options,
          mode: draftProperties.mode,
          requestId: draftProperties.requestId,
          parentQuestionId: { type: "string", minLength: 1, description: "Existing parent Question ID." },
          localRef: { type: "string", minLength: 1, description: "Batch-local identifier." },
          parentLocalRef: { type: "string", minLength: 1, description: "Earlier batch draft to use as parent." }
        }
      }
    },
    expectedRevision: { type: "integer", minimum: 1, description: "Current content revision for existing-Question actions." },
    expectedOwnerRevision: { type: "integer", minimum: 1, description: "Current ownership revision for existing-Question actions." },
    note: { type: "string", description: "Optional cancellation note; cancel only." },
    replacementQuestionId: { type: "string", minLength: 1, description: "Replacement Question; supersede only." },
    expectedOwner: { ...ownerParameters, description: "Current owner; transfer and takeover only." },
    owner: { ...ownerParameters, description: "New owner; transfer only." }
  }
} as const;

const CREATE_FIELDS = ["action", "question", "ambiguity", "options", "mode", "requestId", "parentQuestionId"] as const;
const BATCH_FIELDS = ["action", "questions"] as const;
const UPDATE_BASE_FIELDS = ["action", "questionId", "expectedRevision", "expectedOwnerRevision"] as const;
const BATCH_DRAFT_FIELDS = ["localRef", "question", "ambiguity", "options", "mode", "requestId", "parentQuestionId", "parentLocalRef"] as const;

function assertOnlyFields(value: Record<string, unknown>, allowed: readonly string[], action: string): void {
  const invalid = Object.keys(value).find((field) => !allowed.includes(field));
  if (invalid) throw new Error(`write_question action ${action} does not accept ${invalid}`);
}

function requireField(value: unknown, field: string, action: string): void {
  if (value === undefined || value === null || (typeof value === "string" && value.trim().length === 0)) {
    throw new Error(`write_question action ${action} requires ${field}`);
  }
}

export function toAskPostboxInput(input: WriteQuestionInput): AskPostboxInput | AskPostboxBatchInput {
  if (input.action === "create") {
    assertOnlyFields(input as unknown as Record<string, unknown>, CREATE_FIELDS, input.action);
    requireField(input.question, "question", input.action);
    requireField(input.ambiguity, "ambiguity", input.action);
    requireField(input.options, "options", input.action);
    return {
      question: input.question!,
      ambiguity: input.ambiguity!,
      options: input.options!,
      ...(input.mode ? { mode: input.mode } : {}),
      ...(input.requestId ? { requestId: input.requestId } : {}),
      ...(typeof input.parentQuestionId === "string" ? { parentQuestionId: input.parentQuestionId } : {})
    };
  }
  if (input.action !== "create_batch") throw new Error(`write_question action ${input.action} is not a create action`);
  assertOnlyFields(input as unknown as Record<string, unknown>, BATCH_FIELDS, input.action);
  if (!Array.isArray(input.questions) || input.questions.length === 0) requireField(input.questions, "questions", input.action);
  input.questions!.forEach((draft, index) => {
    assertOnlyFields(draft as unknown as Record<string, unknown>, BATCH_DRAFT_FIELDS, `${input.action} questions[${index}]`);
    for (const field of ["localRef", "question", "ambiguity", "options"] as const) requireField(draft[field], field, `${input.action} questions[${index}]`);
  });
  return { mode: "batch", questions: input.questions! };
}

export function toQuestionUpdateRequest(input: WriteQuestionInput): { questionId: string; update: UpdateQuestionPayload } {
  if (input.action === "create" || input.action === "create_batch") {
    throw new Error(`write_question action ${input.action} is not an existing-Question action`);
  }
  requireField(input.questionId, "questionId", input.action);
  requireField(input.expectedRevision, "expectedRevision", input.action);
  requireField(input.expectedOwnerRevision, "expectedOwnerRevision", input.action);

  let update: unknown;
  if (input.action === "revise") {
    assertOnlyFields(input as unknown as Record<string, unknown>, [...UPDATE_BASE_FIELDS, "question", "ambiguity", "options"], input.action);
    requireField(input.question, "question", input.action);
    requireField(input.ambiguity, "ambiguity", input.action);
    update = {
      action: input.action,
      expectedRevision: input.expectedRevision,
      expectedOwnerRevision: input.expectedOwnerRevision,
      question: { prompt: input.question, ambiguity: input.ambiguity },
      ...(input.options ? { options: input.options } : {})
    };
  } else if (input.action === "cancel") {
    assertOnlyFields(input as unknown as Record<string, unknown>, [...UPDATE_BASE_FIELDS, "note"], input.action);
    update = { action: input.action, expectedRevision: input.expectedRevision, expectedOwnerRevision: input.expectedOwnerRevision, ...(input.note ? { note: input.note } : {}) };
  } else if (input.action === "supersede") {
    assertOnlyFields(input as unknown as Record<string, unknown>, [...UPDATE_BASE_FIELDS, "replacementQuestionId"], input.action);
    requireField(input.replacementQuestionId, "replacementQuestionId", input.action);
    update = { action: input.action, expectedRevision: input.expectedRevision, expectedOwnerRevision: input.expectedOwnerRevision, replacementQuestionId: input.replacementQuestionId };
  } else if (input.action === "reparent") {
    assertOnlyFields(input as unknown as Record<string, unknown>, [...UPDATE_BASE_FIELDS, "parentQuestionId"], input.action);
    if (input.parentQuestionId === undefined) requireField(input.parentQuestionId, "parentQuestionId", input.action);
    update = { action: input.action, expectedRevision: input.expectedRevision, expectedOwnerRevision: input.expectedOwnerRevision, parentQuestionId: input.parentQuestionId };
  } else if (input.action === "transfer") {
    assertOnlyFields(input as unknown as Record<string, unknown>, [...UPDATE_BASE_FIELDS, "expectedOwner", "owner"], input.action);
    requireField(input.expectedOwner, "expectedOwner", input.action);
    requireField(input.owner, "owner", input.action);
    update = { action: input.action, expectedRevision: input.expectedRevision, expectedOwnerRevision: input.expectedOwnerRevision, expectedOwner: input.expectedOwner, owner: input.owner };
  } else {
    assertOnlyFields(input as unknown as Record<string, unknown>, [...UPDATE_BASE_FIELDS, "expectedOwner"], input.action);
    requireField(input.expectedOwner, "expectedOwner", input.action);
    update = { action: input.action, expectedRevision: input.expectedRevision, expectedOwnerRevision: input.expectedOwnerRevision, expectedOwner: input.expectedOwner };
  }

  return { questionId: input.questionId!, update: UpdateQuestionPayloadSchema.parse(update) };
}

export function normalizeWriteQuestionResult(
  action: WriteQuestionAction,
  result: AskReceipt | AskBatchReceipt | AskResult | Record<string, unknown>
): Record<string, unknown> {
  if (action === "create_batch") {
    const receipt = result as AskBatchReceipt;
    return {
      action,
      batchStatus: receipt.status,
      items: receipt.items.map((item) => item.status === "created"
        ? {
            localRef: item.localRef,
            questionId: item.questionId,
            revision: item.revision,
            ownerRevision: item.ownerRevision,
            status: item.questionStatus,
            disposition: item.disposition
          }
        : { localRef: item.localRef, status: "rejected", reason: item.reason.code })
    };
  }
  if (action === "create") {
    if ("questionId" in result) {
      const receipt = result as AskReceipt;
      return {
        action,
        questionId: receipt.questionId,
        revision: receipt.revision,
        ownerRevision: receipt.ownerRevision,
        status: receipt.status,
        disposition: receipt.disposition
      };
    }
    return { action, ...(result as Record<string, unknown>) };
  }

  const value = result as Record<string, unknown>;
  const normalized: Record<string, unknown> = { action };
  for (const key of [
    "questionId", "revision", "ownerRevision", "status", "parentQuestionId",
    "replacementQuestionId", "owner", "creator"
  ]) {
    if (value[key] !== undefined) normalized[key] = value[key];
  }
  return normalized;
}
