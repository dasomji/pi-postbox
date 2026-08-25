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
      buildId: PROTOCOL_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      profile: { kind: "production", id: "production" },
      uptimeMs: 750,
      timestamp: "1970-01-01T00:00:01.750Z"
    });
  });

  it("requires authoritative server profile and build compatibility identity", () => {
    expect(() =>
      HealthResponseSchema.parse({
        ok: true,
        service: SERVICE_NAME,
        version: PROTOCOL_VERSION,
        protocolVersion: PROTOCOL_VERSION,
        uptimeMs: 750,
        timestamp: "1970-01-01T00:00:01.750Z"
      })
    ).toThrow();
  });

  it("accepts and creates health responses with profile-scoped server instance identity", () => {
    const instance = {
      profile: { kind: "development" as const, id: "development:0123456789abcdef" },
      instanceId: "550e8400-e29b-41d4-a716-446655440000",
      url: "http://127.0.0.1:3500/",
      protocolVersion: PROTOCOL_VERSION,
      buildId: "0.1.0+abc123"
    };

    const response = createHealthResponse({
      startedAtMs: 1_000,
      nowMs: 1_750,
      profile: instance.profile,
      buildId: instance.buildId,
      instance
    });

    expect(HealthResponseSchema.parse(response)).toEqual({
      ok: true,
      service: SERVICE_NAME,
      version: PROTOCOL_VERSION,
      buildId: instance.buildId,
      protocolVersion: PROTOCOL_VERSION,
      profile: instance.profile,
      uptimeMs: 750,
      timestamp: "1970-01-01T00:00:01.750Z",
      instance
    });
  });

  it("rejects malformed health responses", () => {
    expect(() => HealthResponseSchema.parse({ ok: false })).toThrow();
  });
});
