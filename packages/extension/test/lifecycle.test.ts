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

  it("marks ask_postbox waits blocked, clears to working after answer, and emits Herdr-compatible events", async () => {
    const client = new FakeClient();
    const pi = new FakePi();
    const controller = createSemanticStateController(() => client, pi, { idleDebounceMs: 0 });
    controller.markWorking();

    const result = await executeAskPostbox(
      {
        requestId: "ask-state",
        question: "Which path should we take?",
        context: {
          codebaseContext: "Pi extension semantic-state lifecycle.",
          problemContext: "Represent a pending remote decision as blocked work."
        },
        options: [{ value: "a", label: "A" }]
      },
      {
        ask: async (payload) => {
          expect(client.states.at(-1)).toBe("blocked");
          expect(pi.herdrEvents.at(-1)).toEqual({
            eventName: "herdr:blocked",
            data: { active: true, label: "Which path should we take?" }
          });
          return {
            status: "answered",
            requestId: payload.requestId,
            selectedValues: ["a"],
            resolvedAt: "2026-06-03T00:00:00.000Z"
          };
        }
      },
      "session-1",
      undefined,
      controller
    );

    expect(result.status).toBe("answered");
    expect(client.states).toEqual(["working", "blocked", "working"]);
    expect(pi.herdrEvents).toEqual([
      { eventName: "herdr:blocked", data: { active: true, label: "Which path should we take?" } },
      { eventName: "herdr:blocked", data: { active: false } }
    ]);
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
