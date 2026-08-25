import { z } from "zod";

export const QuestionTelemetryEventSchema = z.object({
  operation: z.enum(["question.create", "question.batch.create", "question.list", "answer.create", "answer.read"]),
  questionLength: z.number().int().nonnegative().optional(),
  ambiguityLength: z.number().int().nonnegative().optional(),
  optionValueLength: z.number().int().nonnegative().optional(),
  optionLabelLength: z.number().int().nonnegative().optional(),
  optionDescriptionLength: z.number().int().nonnegative().optional(),
  optionImpactLength: z.number().int().nonnegative().optional(),
  noteLength: z.number().int().nonnegative().optional(),
  optionsSerializedBytes: z.number().int().nonnegative().optional(),
  requestSerializedBytes: z.number().int().nonnegative().optional(),
  batchSerializedBytes: z.number().int().nonnegative().optional(),
  batchSize: z.number().int().nonnegative().optional(),
  responseCharacterCount: z.number().int().nonnegative().optional(),
  selectedIdCount: z.number().int().nonnegative().optional(),
  answerResponseBytes: z.number().int().nonnegative().optional()
}).strict();

export type QuestionTelemetryEvent = z.infer<typeof QuestionTelemetryEventSchema>;
