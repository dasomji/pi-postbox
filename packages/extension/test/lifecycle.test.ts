import type { SemanticState } from "@pi-postbox/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSemanticStateController, installSemanticStateHandlers, type SemanticStateClient } from "../src/lifecycle.js";
import { executeAskPostbox } from "../src/tools/askPostbox.js";

class FakeClient implements SemanticStateClient {
  states: SemanticState[] = [];
  shutdowns = 0;
  shutdownReasons: Array<string | undefined> = [];

  updateSemanticState(state: SemanticState): boolean {
    this.states.push(state);
    return true;
  }

  shutdownSession(reason?: string): boolean {
    this.shutdowns += 1;
    this.shutdownReasons.push(reason);
    return true;
  }
}

class FakePi {
  handlers = new Map<string, Array<(event: unknown, ctx: unknown) => unknown>>();
  herdrEvents: Array<{ eventName: string; data: unknown }> = [];
  events = {
    emit: (eventName: string, data: unknown) => {
      this.herdrEvents.push({ eventName, data });
    }
  };

  on(eventName: string, handler: (event: unknown, ctx: unknown) => unknown): void {
    const handlers = this.handlers.get(eventName) ?? [];
    handlers.push(handler);
    this.handlers.set(eventName, handlers);
  }

  emit(eventName: string, event: unknown = {}): void {
    for (const handler of this.handlers.get(eventName) ?? []) handler(event, {});
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Pi semantic state lifecycle reporting", () => {
  it("maps agent lifecycle events to working and debounced idle updates", async () => {
    vi.useFakeTimers();
    const client = new FakeClient();
    const pi = new FakePi();
    const controller = createSemanticStateController(() => client, pi, { idleDebounceMs: 100 });
    installSemanticStateHandlers(pi, controller);

    pi.emit("agent_start");
    expect(client.states).toEqual(["working"]);

    pi.emit("agent_end");
    expect(client.states).toEqual(["working"]);

    await vi.advanceTimersByTimeAsync(99);
    expect(client.states).toEqual(["working"]);

    await vi.advanceTimersByTimeAsync(1);
    expect(client.states).toEqual(["working", "idle"]);
  });

  it("keeps working while ask_postbox waits only for persistence acknowledgement", async () => {
    const client = new FakeClient();
    const pi = new FakePi();
    const controller = createSemanticStateController(() => client, pi, { idleDebounceMs: 0 });
    controller.markWorking();

    const result = await executeAskPostbox(
      {
        requestId: "ask-state",
        question: "Which path should we take?",
        ambiguity: "Which path best preserves the lifecycle contract.",
        options: [{ value: "a", label: "A" }]
      },
      {
        createAsk: async (payload) => {
          expect(client.states.at(-1)).toBe("working");
          expect(pi.herdrEvents).toEqual([]);
          return { status: "pending", questionId: payload.requestId, revision: 1 } as const;
        }
      },
      "session-1",
      undefined,
      controller
    );

    expect(result.status).toBe("pending");
    expect(client.states).toEqual(["working"]);
    expect(pi.herdrEvents).toEqual([]);
  });

  it("surfaces local ask_user calls as blocked until their tool result arrives", () => {
    const client = new FakeClient();
    const pi = new FakePi();
    const controller = createSemanticStateController(() => client, pi, { idleDebounceMs: 0 });
    installSemanticStateHandlers(pi, controller);

    pi.emit("agent_start");
    pi.emit("tool_call", { toolName: "ask_user", toolCallId: "ask-user-1" });
    pi.emit("tool_result", { toolName: "ask_user", toolCallId: "ask-user-1" });

    expect(client.states).toEqual(["working", "blocked", "working"]);
  });

  it("publishes a first-class Postbox wait state while keeping Herdr signaling independent", () => {
    const client = new FakeClient();
    const pi = new FakePi();
    const controller = createSemanticStateController(() => client, pi, { idleDebounceMs: 0 });
    controller.markWorking();
    const release = controller.beginAskPostboxWait();
    expect(client.states.at(-1)).toBe("waiting_for_postbox");
    expect(pi.herdrEvents.at(-1)).toMatchObject({ eventName: "herdr:blocked", data: { active: true } });
    release();
    expect(client.states.at(-1)).toBe("working");
  });

  it("does not send a semantic session shutdown release for reload", () => {
    const client = new FakeClient();
    const pi = new FakePi();
    const controller = createSemanticStateController(() => client, pi);
    installSemanticStateHandlers(pi, controller);

    pi.emit("session_shutdown", { reason: "reload" });

    expect(client.states.at(-1)).toBe("idle");
    expect(client.shutdowns).toBe(0);
    expect(pi.herdrEvents).toEqual([{ eventName: "herdr:blocked", data: { active: false } }]);
  });

  it("sends an explicit shutdown release for the active session", () => {
    const client = new FakeClient();
    const pi = new FakePi();
    const controller = createSemanticStateController(() => client, pi);
    installSemanticStateHandlers(pi, controller);

    pi.emit("session_shutdown", { reason: "new" });

    expect(client.states.at(-1)).toBe("idle");
    expect(client.shutdowns).toBe(1);
    expect(client.shutdownReasons).toEqual(["new"]);
    expect(pi.herdrEvents).toEqual([{ eventName: "herdr:blocked", data: { active: false } }]);
  });
});
