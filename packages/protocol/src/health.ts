import { z } from "zod";

import { ActiveLocalTargetIdentitySchema, type ActiveLocalTargetIdentity } from "./activeLocal.js";

export const PROTOCOL_VERSION = "0.1.0";
export const SERVICE_NAME = "pi-postbox";

export const HealthResponseSchema = z.object({
  ok: z.literal(true),
  service: z.literal(SERVICE_NAME),
  version: z.string().min(1),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  uptimeMs: z.number().int().nonnegative(),
  timestamp: z.string().datetime(),
  localTarget: ActiveLocalTargetIdentitySchema.optional()
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export interface CreateHealthResponseOptions {
  startedAtMs: number;
  nowMs?: number;
  version?: string;
  localTarget?: ActiveLocalTargetIdentity;
}

export function createHealthResponse(options: CreateHealthResponseOptions): HealthResponse {
  const nowMs = options.nowMs ?? Date.now();
  const response: Record<string, unknown> = {
    ok: true,
    service: SERVICE_NAME,
    version: options.version ?? PROTOCOL_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    uptimeMs: Math.max(0, Math.round(nowMs - options.startedAtMs)),
    timestamp: new Date(nowMs).toISOString()
  };

  if (options.localTarget !== undefined) {
    response.localTarget = options.localTarget;
  }

  return HealthResponseSchema.parse(response);
}
