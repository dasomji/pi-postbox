import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, withProtocolVersion } from "../src/index.js";

describe("protocol version stamping", () => {
  it("overwrites untrusted payload version evidence", () => {
    expect(withProtocolVersion({ protocolVersion: "0.0.1", value: 1 })).toEqual({
      protocolVersion: PROTOCOL_VERSION,
      value: 1
    });
  });
});
