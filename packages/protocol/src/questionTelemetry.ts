import { z } from "zod";

export const QuestionTelemetryEventSchema = z.object({
  operation: z.enum(["question.create", "question.batch.create", "question.list", "answer.create", "answer.read"]),
  questionLength: z.number().int().nonnegative().optional(),
  contextSerializedBytes: z.number().int().nonnegative().optional(),
  optionsSerializedBytes: z.number().int().nonnegative().optional(),
  batchSize: z.number().int().nonnegative().optional(),
  responseCharacterCount: z.number().int().nonnegative().optional(),
  selectedIdCount: z.number().int().nonnegative().optional(),
  answerResponseBytes: z.number().int().nonnegative().optional()
}).strict();

export type QuestionTelemetryEvent = z.infer<typeof QuestionTelemetryEventSchema>;
