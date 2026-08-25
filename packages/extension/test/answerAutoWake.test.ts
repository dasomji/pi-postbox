import { afterEach, describe, expect, it, vi } from "vitest";
import { AnswerAutoWakeCoordinator, resolveAnswerAutoWakeEnabled } from "../src/answerAutoWake.js";

afterEach(() => vi.useRealTimers());

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

describe("Answer auto-wake delivery recovery", () => {
  it("does not resend a wake that remains queued across coordinator replacement", async () => {
    vi.useFakeTimers();
    const branch: unknown[] = [];
    const sendMessage = vi.fn();
    const pi = {
      appendEntry: (customType: string, data: unknown) => branch.push({ type: "custom", customType, data }),
      sendMessage
    };

    const first = new AnswerAutoWakeCoordinator({
      pi,
      sessionManager: { getBranch: () => branch },
      hasPendingMessages: () => true,
      enabled: true,
      batchWindowMs: 1
    });
    first.notify({ questionId: "question-1", question: "Ship it?", answerId: "answer-1" }, "delivery-1");
    await vi.advanceTimersByTimeAsync(1);
    first.stop();

    const replacement = new AnswerAutoWakeCoordinator({
      pi,
      sessionManager: { getBranch: () => branch },
      hasPendingMessages: () => true,
      enabled: true,
      batchWindowMs: 1
    });
    replacement.recover();
    await vi.advanceTimersByTimeAsync(1);

    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("retries a sent wake on refresh after Pi clears its queue", async () => {
    vi.useFakeTimers();
    const branch: unknown[] = [];
    let hasPendingMessages = true;
    const sendMessage = vi.fn();
    const coordinator = new AnswerAutoWakeCoordinator({
      pi: {
        appendEntry: (customType, data) => branch.push({ type: "custom", customType, data }),
        sendMessage
      },
      sessionManager: { getBranch: () => branch },
      hasPendingMessages: () => hasPendingMessages,
      enabled: true,
      batchWindowMs: 1
    });

    coordinator.notify({ questionId: "question-1", question: "Ship it?", answerId: "answer-1" }, "delivery-1");
    await vi.advanceTimersByTimeAsync(1);
    hasPendingMessages = false;
    coordinator.recover();
    await vi.advanceTimersByTimeAsync(1);

    expect(sendMessage).toHaveBeenCalledTimes(2);
  });
});
