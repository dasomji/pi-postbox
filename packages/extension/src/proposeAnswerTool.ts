import {
  ProposeAnswerPayloadSchema,
  type ProposeAnswerErrorCode,
  type ProposeAnswerPayload,
  type ProposeAnswerResult
} from "../../protocol/src/index.js";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export const PROPOSE_ANSWER_TOOL_NAME = "propose_answer" as const;

export type ProposeAnswerTransport = (
  requestId: string,
  proposal: ProposeAnswerPayload,
  signal?: AbortSignal
) => Promise<ProposeAnswerResult>;

export class ProposeAnswerToolError extends Error {
  constructor(
    public readonly code: ProposeAnswerErrorCode,
    message: string
  ) {
    super(message);
    this.name = "ProposeAnswerToolError";
  }
}

export function createProposeAnswerTool(requestId: string, propose: ProposeAnswerTransport): ToolDefinition {
  return defineTool({
    name: PROPOSE_ANSWER_TOOL_NAME,
    label: "Suggest answer option",
    description: "Append one answerable option to the pending Postbox Question. This never selects or submits an answer.",
    parameters: Type.Object({
      label: Type.String({ minLength: 1, maxLength: 2_000 }),
      description: Type.Optional(Type.String({ minLength: 1, maxLength: 128_000 })),
      meaning: Type.Optional(Type.String({ minLength: 1, maxLength: 128_000 })),
      context: Type.Optional(Type.String({ minLength: 1, maxLength: 128_000 }))
    }, { additionalProperties: false }),
    async execute(_toolCallId, input, signal) {
      const parsed = ProposeAnswerPayloadSchema.safeParse(input);
      if (!parsed.success) throw new ProposeAnswerToolError("invalid_proposal", "Suggested option is invalid.");
      const result = await propose(requestId, parsed.data, signal);
      if (result.status === "error") throw new ProposeAnswerToolError(result.error.code, result.error.message);
      const text = `Added “${result.option.label}” as a Suggested in Chat option.`;
      return {
        content: [{ type: "text" as const, text }],
        details: {
          optionValue: result.option.value,
          action: { type: "show-question" as const, optionValue: result.option.value }
        }
      };
    }
  });
}
