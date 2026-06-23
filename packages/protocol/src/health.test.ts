import { describe, expect, it } from "vitest";
import {
  createHealthResponse,
  HealthResponseSchema,
  PROTOCOL_VERSION,
  SERVICE_NAME
} from "./index.js";

describe("Postbox health protocol", () => {
  it("creates a validated health response", () => {
    const response = createHealthResponse({ startedAtMs: 1_000, nowMs: 1_750 });

    expect(HealthResponseSchema.parse(response)).toEqual({
      ok: true,
      service: SERVICE_NAME,
      version: PROTOCOL_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      uptimeMs: 750,
      timestamp: "1970-01-01T00:00:01.750Z"
    });
  });

  it("keeps local target identity optional for backward-compatible health consumers", () => {
    expect(
      HealthResponseSchema.parse({
        ok: true,
        service: SERVICE_NAME,
        version: PROTOCOL_VERSION,
        protocolVersion: PROTOCOL_VERSION,
        uptimeMs: 750,
        timestamp: "1970-01-01T00:00:01.750Z"
      })
    ).toMatchObject({ ok: true, service: SERVICE_NAME });
  });

  it("accepts and creates health responses with active-local target identity", () => {
    const localTarget = {
      role: "dev",
      instanceId: "550e8400-e29b-41d4-a716-446655440000",
      url: "http://127.0.0.1:3500/"
    };

    const response = createHealthResponse({ startedAtMs: 1_000, nowMs: 1_750, localTarget });

    expect(HealthResponseSchema.parse(response)).toEqual({
      ok: true,
      service: SERVICE_NAME,
      version: PROTOCOL_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      uptimeMs: 750,
      timestamp: "1970-01-01T00:00:01.750Z",
      localTarget
    });
  });

  it("rejects malformed health responses", () => {
    expect(() => HealthResponseSchema.parse({ ok: false })).toThrow();
  });
});
