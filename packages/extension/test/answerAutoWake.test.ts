import { describe, expect, it } from "vitest";
import { resolveAnswerAutoWakeEnabled } from "../src/answerAutoWake.js";

describe("Answer auto-wake configuration", () => {
  it("is enabled by default", () => {
    expect(resolveAnswerAutoWakeEnabled({}, undefined)).toBe(true);
  });

  it("uses the JSON config value when no environment override is present", () => {
    expect(resolveAnswerAutoWakeEnabled({}, false)).toBe(false);
    expect(resolveAnswerAutoWakeEnabled({}, true)).toBe(true);
  });

  it("lets the environment override JSON config", () => {
    expect(resolveAnswerAutoWakeEnabled({ PI_POSTBOX_AUTO_WAKE: "off" }, true)).toBe(false);
    expect(resolveAnswerAutoWakeEnabled({ PI_POSTBOX_AUTO_WAKE: "on" }, false)).toBe(true);
  });

  it("falls back safely when the environment value is unrecognized", () => {
    expect(resolveAnswerAutoWakeEnabled({ PI_POSTBOX_AUTO_WAKE: "sometimes" }, false)).toBe(false);
    expect(resolveAnswerAutoWakeEnabled({ PI_POSTBOX_AUTO_WAKE: "sometimes" }, undefined)).toBe(true);
  });
});
