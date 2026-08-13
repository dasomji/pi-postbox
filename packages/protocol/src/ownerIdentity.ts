import { z } from "zod";

export const HarnessSchema = z.enum(["pi", "codex", "claude-code"]);

export const OwnerIdentitySchema = z.object({
  harness: HarnessSchema,
  ownerId: z.string().min(1)
}).strict();

export const HarnessLineageSchema = z.object({
  parentOwnerId: z.string().min(1).optional(),
  rootOwnerId: z.string().min(1).optional(),
  harnessSessionId: z.string().min(1).optional(),
  depth: z.number().int().nonnegative().optional(),
  path: z.string().min(1).optional(),
  taskLabel: z.string().min(1).optional()
}).strict();

export type Harness = z.infer<typeof HarnessSchema>;
export type OwnerIdentity = z.infer<typeof OwnerIdentitySchema>;
export type HarnessLineage = z.infer<typeof HarnessLineageSchema>;

export function ownerIdentityKey(identity: OwnerIdentity): string {
  return `${identity.harness}:${identity.ownerId}`;
}
