import { z } from "zod";
import { AskRequestSnapshotSchema } from "./ask.js";
import { ProjectIconSchema } from "./session.js";

export const HistorySessionMetadataSchema = z.object({
  sessionId: z.string().min(1),
  title: z.string().min(1).optional(),
  cwd: z.string().min(1),
  branch: z.string().min(1).optional(),
  worktreePath: z.string().min(1).optional(),
  machine: z.object({
    machineId: z.string().min(1),
    machineName: z.string().min(1),
    hostname: z.string().min(1)
  }),
  project: z.object({
    projectId: z.string().min(1),
    projectName: z.string().min(1),
    projectDetectedName: z.string().min(1).optional(),
    projectDescription: z.string().min(1).optional(),
    cwd: z.string().min(1),
    gitRoot: z.string().min(1).optional(),
    repoName: z.string().min(1).optional(),
    branch: z.string().min(1).optional(),
    headSha: z.string().min(1).optional(),
    isDirty: z.boolean().optional(),
    worktreePath: z.string().min(1).optional(),
    icon: ProjectIconSchema.optional()
  })
});

export const HistoryRecordSchema = z.object({
  request: AskRequestSnapshotSchema,
  session: HistorySessionMetadataSchema
});

export const HistoryRetentionSchema = z.object({
  maxAgeMs: z.number().int().positive().optional(),
  maxRecords: z.number().int().nonnegative().optional()
});

export const HistoryResponseSchema = z.object({
  history: z.array(HistoryRecordSchema),
  retention: HistoryRetentionSchema,
  timestamp: z.string().datetime()
});

export const HistoryPruneResponseSchema = z.object({
  pruned: z.number().int().nonnegative(),
  retention: HistoryRetentionSchema,
  timestamp: z.string().datetime()
});

export type HistorySessionMetadata = z.infer<typeof HistorySessionMetadataSchema>;
export type HistoryRecord = z.infer<typeof HistoryRecordSchema>;
export type HistoryRetention = z.infer<typeof HistoryRetentionSchema>;
export type HistoryResponse = z.infer<typeof HistoryResponseSchema>;
export type HistoryPruneResponse = z.infer<typeof HistoryPruneResponseSchema>;
