import { z } from "zod";

export const PROTOCOL_VERSION = "0.1.0";
export const SERVICE_NAME = "pi-postbox";

export const HealthResponseSchema = z.object({
  ok: z.literal(true),
  service: z.literal(SERVICE_NAME),
  version: z.string().min(1),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  uptimeMs: z.number().int().nonnegative(),
  timestamp: z.string().datetime()
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export interface CreateHealthResponseOptions {
  startedAtMs: number;
  nowMs?: number;
  version?: string;
}

export function createHealthResponse(options: CreateHealthResponseOptions): HealthResponse {
  const nowMs = options.nowMs ?? Date.now();

  return HealthResponseSchema.parse({
    ok: true,
    service: SERVICE_NAME,
    version: options.version ?? PROTOCOL_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    uptimeMs: Math.max(0, Math.round(nowMs - options.startedAtMs)),
    timestamp: new Date(nowMs).toISOString()
  });
}
