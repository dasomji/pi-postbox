import { z } from "zod";
import { AskRequestSnapshotSchema } from "./ask.js";

export const SemanticStateSchema = z.enum(["working", "blocked", "idle", "unknown"]);
export const PresenceStateSchema = z.enum(["live", "stale", "offline"]);

export const MachineRegistrationSchema = z.object({
  machineId: z.string().min(1),
  hostname: z.string().min(1),
  displayName: z.string().min(1).optional()
});

const ICON_DATA_URL_MAX = 128 * 1024;
const AllowedProjectIconMediaTypeSchema = z.enum(["image/svg+xml", "image/png", "image/jpeg", "image/gif", "image/webp"]);

export const ProjectIconSchema = z.object({
  hash: z.string().min(1).max(200),
  dataUrl: z.string().startsWith("data:").max(ICON_DATA_URL_MAX),
  mediaType: AllowedProjectIconMediaTypeSchema.optional(),
  sizeBytes: z.number().int().nonnegative().max(64 * 1024).optional()
});

export const ProjectRegistrationSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1),
  displayName: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  cwd: z.string().min(1),
  gitRoot: z.string().min(1).optional(),
  repoName: z.string().min(1).optional(),
  branch: z.string().min(1).optional(),
  headSha: z.string().min(1).optional(),
  isDirty: z.boolean().optional(),
  worktreePath: z.string().min(1).optional(),
  icon: ProjectIconSchema.optional()
});

export const SessionRegistrationSchema = z.object({
  sessionId: z.string().min(1),
  title: z.string().min(1).optional(),
  cwd: z.string().min(1),
  branch: z.string().min(1).optional(),
  worktreePath: z.string().min(1).optional(),
  semanticState: SemanticStateSchema.default("unknown"),
  agentSessionId: z.string().min(1).optional(),
  agentSessionPath: z.string().min(1).optional(),
  leafId: z.string().min(1).optional()
});

export const SessionRegisterPayloadSchema = z.object({
  machine: MachineRegistrationSchema,
  project: ProjectRegistrationSchema,
  session: SessionRegistrationSchema
});

export const HeartbeatPayloadSchema = z.object({
  sessionId: z.string().min(1),
  semanticState: SemanticStateSchema.optional(),
  timestamp: z.string().datetime().optional()
});

export const SessionUpdatePayloadSchema = z.object({
  sessionId: z.string().min(1),
  title: z.string().min(1).optional(),
  cwd: z.string().min(1).optional(),
  branch: z.string().min(1).optional(),
  worktreePath: z.string().min(1).optional(),
  semanticState: SemanticStateSchema.optional(),
  agentSessionPath: z.string().min(1).max(4_000).optional(),
  leafId: z.string().min(1).max(2_000).optional()
});

export const SessionShutdownReasonSchema = z.enum(["quit", "reload", "new", "resume", "fork"]);

export const SessionShutdownPayloadSchema = z.object({
  sessionId: z.string().min(1),
  reason: SessionShutdownReasonSchema.optional()
});

export const SessionSnapshotSchema = z.object({
  sessionId: z.string(),
  title: z.string().optional(),
  machineId: z.string(),
  machineName: z.string(),
  hostname: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  projectDetectedName: z.string().optional(),
  projectDescription: z.string().optional(),
  projectIcon: ProjectIconSchema.optional(),
  cwd: z.string(),
  gitRoot: z.string().optional(),
  repoName: z.string().optional(),
  branch: z.string().optional(),
  headSha: z.string().optional(),
  isDirty: z.boolean().optional(),
  worktreePath: z.string().optional(),
  semanticState: SemanticStateSchema,
  presence: PresenceStateSchema,
  lastHeartbeatAt: z.string().datetime().optional(),
  connectedAt: z.string().datetime().optional(),
  disconnectedAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime()
});

export const StateSnapshotSchema = z.object({
  sessions: z.array(SessionSnapshotSchema),
  requests: z.array(AskRequestSnapshotSchema).default([]),
  timestamp: z.string().datetime()
});

export type SemanticState = z.infer<typeof SemanticStateSchema>;
export type PresenceState = z.infer<typeof PresenceStateSchema>;
export type ProjectIcon = z.infer<typeof ProjectIconSchema>;
export type MachineRegistration = z.infer<typeof MachineRegistrationSchema>;
export type ProjectRegistration = z.infer<typeof ProjectRegistrationSchema>;
export type SessionRegistration = z.infer<typeof SessionRegistrationSchema>;
export type SessionRegisterPayload = z.infer<typeof SessionRegisterPayloadSchema>;
export type HeartbeatPayload = z.infer<typeof HeartbeatPayloadSchema>;
export type SessionUpdatePayload = z.infer<typeof SessionUpdatePayloadSchema>;
export type SessionShutdownReason = z.infer<typeof SessionShutdownReasonSchema>;
export type SessionShutdownPayload = z.infer<typeof SessionShutdownPayloadSchema>;
export type SessionSnapshot = z.infer<typeof SessionSnapshotSchema>;
export type StateSnapshot = z.infer<typeof StateSnapshotSchema>;
