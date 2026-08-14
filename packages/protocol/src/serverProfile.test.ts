import { describe, expect, it } from "vitest";
import {
  SERVER_PROFILE_METADATA_VERSION,
  ServerProfileIdentitySchema,
  parseServerProfileMetadataRecord
} from "./serverProfile.js";

const NOW_MS = Date.parse("2026-08-14T15:00:00.000Z");
const development = { kind: "development" as const, id: "development:0123456789abcdef" };

describe("server profile identity", () => {
  it("accepts production and checkout-scoped development identities", () => {
    expect(ServerProfileIdentitySchema.parse({ kind: "production", id: "production" })).toEqual({
      kind: "production",
      id: "production"
    });
    expect(ServerProfileIdentitySchema.parse(development)).toEqual(development);
  });

  it("rejects a profile kind/id mismatch", () => {
    expect(() => ServerProfileIdentitySchema.parse({ kind: "development", id: "production" })).toThrow();
    expect(() => ServerProfileIdentitySchema.parse({ kind: "production", id: development.id })).toThrow();
  });
});

describe("server profile metadata", () => {
  it("parses one record only when it belongs to the expected profile", () => {
    const input = JSON.stringify({
      version: SERVER_PROFILE_METADATA_VERSION,
      profile: development,
      instanceId: "123e4567-e89b-42d3-a456-426614174000",
      url: "http://127.0.0.1:43123",
      protocolVersion: "0.1.0",
      buildId: "0.1.0+abc123",
      updatedAt: "2026-08-14T14:59:59.000Z"
    });

    expect(parseServerProfileMetadataRecord(input, { expectedProfile: development, nowMs: NOW_MS })).toMatchObject({
      ok: true,
      record: { profile: development, url: "http://127.0.0.1:43123/" }
    });
    expect(parseServerProfileMetadataRecord(input, {
      expectedProfile: { kind: "production", id: "production" },
      nowMs: NOW_MS
    })).toEqual({ ok: false, diagnostics: [{ code: "profile-mismatch", field: "profile" }] });
  });
});
