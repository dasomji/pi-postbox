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

  it("rejects malformed health responses", () => {
    expect(() => HealthResponseSchema.parse({ ok: false })).toThrow();
  });
});
