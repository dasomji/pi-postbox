import { randomUUID } from "node:crypto";
import {
  AskCreatePayloadSchema,
  type AskCreatePayload,
  type AskCreateHandoffContext,
  type AskOption,
  type AskReceipt,
  type AskResult,
  type AskUrgency,
  type ForkReference
} from "@pi-postbox/protocol";
import type { PostboxClient } from "../client/PostboxClient.js";

export interface AskPostboxInput {
  question: string;
  questionContext?: string;
  relevance?: string;
  decisionImpact?: string;
  mode?: "single" | "multi";
  urgency?: AskUrgency;
  options: AskOption[];
  context: AskCreateHandoffContext;
  forkReference?: ForkReference;
  requestId?: string;
  timeoutMs?: number;
  expiresAt?: string;
}

export const askPostboxParameters = {
  type: "object",
  additionalProperties: false,
  required: ["question", "options", "context"],
  properties: {
    question: { type: "string", minLength: 1, description: "Decision question to show in Pi Postbox." },
    questionContext: { type: "string", minLength: 1, description: "Concrete context for why this question is being asked." },
    relevance: { type: "string", minLength: 1, description: "Why this question is relevant now." },
    decisionImpact: { type: "string", minLength: 1, description: "What effect this decision will have." },
    mode: { type: "string", enum: ["single", "multi"], description: "Whether one or many options may be selected." },
    urgency: {
      type: "string",
      enum: ["low", "normal", "high"],
      description: "Attention priority. Higher urgency appears first; defaults to normal."
    },
    requestId: { type: "string", minLength: 1, description: "Optional stable request id for this ask." },
    timeoutMs: { type: "number", minimum: 1, description: "Optional request expiry timeout in milliseconds." },
    expiresAt: { type: "string", minLength: 1, description: "Optional ISO datetime when this request expires." },
    options: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["value", "label"],
        properties: {
          value: { type: "string", minLength: 1 },
          label: { type: "string", minLength: 1 },
          description: { type: "string", minLength: 1 },
          meaning: { type: "string", minLength: 1, description: "What choosing this option means." },
          context: { type: "string", minLength: 1, description: "Additional context for this option." }
        }
      }
    },
    context: {
      type: "object",
      additionalProperties: false,
      required: ["codebaseContext", "problemContext"],
      properties: {
        codebaseContext: { type: "string", minLength: 1, description: "Codebase context for a future interviewer." },
        problemContext: { type: "string", minLength: 1, description: "Scoped problem context for a future interviewer." },
        additionalInfo: {
          type: "array",
          maxItems: 20,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["content"],
            properties: {
              kind: { type: "string", enum: ["text", "code", "diagram", "link"] },
              title: { type: "string", minLength: 1 },
              content: { type: "string", minLength: 1 },
              language: { type: "string", minLength: 1 }
            }
          }
        }
      }
    },
    forkReference: {
      type: "object",
      additionalProperties: false,
      properties: {
        agentSessionId: { type: "string", minLength: 1 },
        agentSessionPath: { type: "string", minLength: 1 },
        leafId: { type: "string", minLength: 1 },
        cwd: { type: "string", minLength: 1 },
        model: { type: "string", minLength: 1 }
      }
    }
  }
} as const;

export function createAskPayload(input: AskPostboxInput, sessionId: string): AskCreatePayload {
  const context = mergeHandoffContext(input);
  return AskCreatePayloadSchema.parse({
    requestId: input.requestId ?? `ask_${randomUUID()}`,
    sessionId,
    mode: input.mode ?? "single",
    urgency: input.urgency ?? "normal",
    question: {
      prompt: input.question,
      context: input.questionContext,
      relevance: input.relevance,
      decisionImpact: input.decisionImpact
    },
    options: input.options,
    context,
    forkReference: input.forkReference,
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
  input: AskPostboxInput,
  client: Pick<PostboxClient, "createAsk"> | Pick<PostboxClient, "ask">,
  sessionId: string,
  signal?: AbortSignal,
  lifecycle?: AskPostboxWaitLifecycle
): Promise<AskReceipt> {
  const payload = createAskPayload(input, sessionId);
  void lifecycle;
  if ("createAsk" in client) return client.createAsk(payload, signal);
  // Compatibility for embedders compiled against the synchronous v1 client.
  return client.ask(payload, signal).then((result) => {
    if (result.status !== "answered") throw new Error(`Question was not persisted: ${result.status}`);
    return { questionId: payload.requestId, revision: 1, status: "pending" as const };
  });
}

export function formatAskResult(result: AskReceipt | AskResult): string {
  if ("questionId" in result) return `Postbox persisted ${result.questionId} (revision ${result.revision}); the Answer will arrive asynchronously. Use get_answer with this questionId after notification.`;
  if (result.status === "answered") return `Postbox answered ${result.requestId}: ${result.selectedValues.join(", ")}.`;
  return `Postbox ${result.status} ${result.requestId}.${result.rationale ? ` ${result.rationale}` : ""}`;
}
