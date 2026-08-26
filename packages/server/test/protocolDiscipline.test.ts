import { describe, expect, it } from "vitest";
import { assertAndroidFixtureServerVersion } from "../../../scripts/protocol-discipline.mjs";

describe("protocol discipline", () => {
  it("rejects a health fixture/server package version mismatch independently of protocol version", () => {
    expect(() => assertAndroidFixtureServerVersion(
      JSON.stringify({ fixtures: { health: { version: "0.2.9" } } }),
      JSON.stringify({ version: "0.2.10" })
    )).toThrow(/fixture.*server.*version/i);
  });
});
