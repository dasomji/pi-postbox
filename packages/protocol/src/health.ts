import { z } from "zod";

import {
  ServerInstanceIdentitySchema,
  ServerProfileIdentitySchema,
  type ServerInstanceIdentity,
  type ServerProfileIdentity
} from "./serverProfile.js";

export const PROTOCOL_VERSION = "0.1.8";
export const SERVICE_NAME = "pi-postbox";

export const HealthResponseSchema = z.object({
  ok: z.literal(true),
  service: z.literal(SERVICE_NAME),
  version: z.string().min(1),
  buildId: z.string().min(1).max(128),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  profile: ServerProfileIdentitySchema,
  uptimeMs: z.number().int().nonnegative(),
  timestamp: z.string().datetime(),
  instance: ServerInstanceIdentitySchema.optional()
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export interface CreateHealthResponseOptions {
  startedAtMs: number;
  nowMs?: number;
  version?: string;
  buildId?: string;
  profile?: ServerProfileIdentity;
  instance?: ServerInstanceIdentity;
}

export function createHealthResponse(options: CreateHealthResponseOptions): HealthResponse {
  const nowMs = options.nowMs ?? Date.now();
  const response: Record<string, unknown> = {
    ok: true,
    service: SERVICE_NAME,
    version: options.version ?? PROTOCOL_VERSION,
    buildId: options.buildId ?? options.version ?? PROTOCOL_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    profile: options.profile ?? { kind: "production", id: "production" },
    uptimeMs: Math.max(0, Math.round(nowMs - options.startedAtMs)),
    timestamp: new Date(nowMs).toISOString()
  };

  if (options.instance !== undefined) {
    response.instance = options.instance;
  }

  return HealthResponseSchema.parse(response);
}
