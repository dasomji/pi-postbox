import { PROTOCOL_VERSION } from "@pi-postbox/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchHealth } from "./postboxApi";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("dashboard compatibility negotiation", () => {
  it("reports an incompatible server protocol before state parsing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      ok: true,
      service: "pi-postbox",
      version: "legacy",
      buildId: "legacy-build",
      protocolVersion: "legacy-protocol",
      profile: { kind: "production", id: "production" },
      uptimeMs: 10,
      timestamp: "2026-08-14T15:00:00.000Z"
    })));

    await expect(fetchHealth()).rejects.toThrow(
      `Incompatible Pi Postbox server protocol: dashboard requires ${PROTOCOL_VERSION}, server reports legacy-protocol.`
    );
  });
});
