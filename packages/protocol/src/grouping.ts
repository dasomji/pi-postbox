import { z } from "zod";
export const RepositoryIdentitySchema = z.object({ repositoryId: z.string().min(1), remote: z.string().min(1).optional(), machineId: z.string().min(1).optional(), commonDirectory: z.string().min(1).optional() }).strict();
export const WorktreeIdentitySchema = z.object({ worktreeId: z.string().min(1), machineId: z.string().min(1), path: z.string().min(1) }).strict();
export const FeatureIdentitySchema = z.object({ featureId: z.string().min(1), name: z.string().min(1).optional() }).strict();
export const FeatureActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), name: z.string().min(1) }).strict(),
  z.object({ action: z.literal("select"), featureId: z.string().min(1) }).strict(),
  z.object({ action: z.literal("inherit"), featureId: z.string().min(1) }).strict()
]);
export type RepositoryIdentity = z.infer<typeof RepositoryIdentitySchema>;
export type WorktreeIdentity = z.infer<typeof WorktreeIdentitySchema>;
export type FeatureIdentity = z.infer<typeof FeatureIdentitySchema>;
export type FeatureAction = z.infer<typeof FeatureActionSchema>;
