import type { SemanticState } from "@pi-postbox/protocol";
import { emitHerdrBlocked } from "./herdrInterop.js";

export interface SemanticStateClient {
  updateSemanticState(state: SemanticState): boolean | void;
  shutdownSession?(): boolean | void;
}

export interface SemanticStatePiApi {
  on(event: string, handler: (event: unknown, ctx: unknown) => unknown): void;
  events?: {
    emit?: (eventName: string, data: unknown) => void;
  };
}

export interface SemanticStateControllerOptions {
  idleDebounceMs?: number;
  askUserToolNames?: string[];
}

export interface SemanticStateController {
  readonly currentState: SemanticState;
  markWorking(): void;
  scheduleIdle(): void;
  shutdown(): void;
  beginAskPostboxWait(label?: string): () => void;
  handleToolCall(event: ToolEventLike): void;
  handleToolResult(event: ToolEventLike): void;
}

export interface ToolEventLike {
  toolCallId?: string;
  toolName?: string;
}

const DEFAULT_ASK_USER_TOOL_NAMES = ["ask_user"];

export function createSemanticStateController(
  getClient: () => SemanticStateClient | undefined,
  pi?: Pick<SemanticStatePiApi, "events">,
  options: SemanticStateControllerOptions = {}
): SemanticStateController {
  const idleDebounceMs = options.idleDebounceMs ?? 750;
  const askUserToolNames = new Set(options.askUserToolNames ?? DEFAULT_ASK_USER_TOOL_NAMES);
  const localAskUserToolCalls = new Set<string>();
  let askPostboxWaits = 0;
  let agentActive = false;
  let currentState: SemanticState = "idle";
  let idleTimer: NodeJS.Timeout | undefined;

  const clearIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = undefined;
  };

  const blockedCount = () => askPostboxWaits + localAskUserToolCalls.size;

  const publish = (nextState: SemanticState) => {
    currentState = nextState;
    getClient()?.updateSemanticState(nextState);
  };

  const recompute = () => {
    clearIdleTimer();
    if (blockedCount() > 0) {
      publish("blocked");
      return;
    }
    publish(agentActive ? "working" : "idle");
  };

  return {
    get currentState() {
      return currentState;
    },

    markWorking() {
      agentActive = true;
      recompute();
    },

    scheduleIdle() {
      agentActive = false;
      clearIdleTimer();
      if (blockedCount() > 0) {
        publish("blocked");
        return;
      }
      idleTimer = setTimeout(() => {
        idleTimer = undefined;
        publish("idle");
      }, idleDebounceMs);
      idleTimer.unref?.();
    },

    shutdown() {
      clearIdleTimer();
      agentActive = false;
      askPostboxWaits = 0;
      localAskUserToolCalls.clear();
      emitHerdrBlocked(pi, false);
      getClient()?.updateSemanticState("idle");
      getClient()?.shutdownSession?.();
    },

    beginAskPostboxWait(label = "Waiting for Postbox answer") {
      clearIdleTimer();
      askPostboxWaits += 1;
      emitHerdrBlocked(pi, true, label);
      publish("blocked");

      let released = false;
      return () => {
        if (released) return;
        released = true;
        askPostboxWaits = Math.max(0, askPostboxWaits - 1);
        emitHerdrBlocked(pi, false);
        recompute();
      };
    },

    handleToolCall(event: ToolEventLike) {
      if (!event.toolName || !askUserToolNames.has(event.toolName)) return;
      clearIdleTimer();
      localAskUserToolCalls.add(event.toolCallId ?? event.toolName);
      publish("blocked");
    },

    handleToolResult(event: ToolEventLike) {
      if (!event.toolName || !askUserToolNames.has(event.toolName)) return;
      localAskUserToolCalls.delete(event.toolCallId ?? event.toolName);
      recompute();
    }
  };
}

export function installSemanticStateHandlers(
  pi: SemanticStatePiApi,
  controller: SemanticStateController
): void {
  pi.on("agent_start", () => controller.markWorking());
  pi.on("agent_end", () => controller.scheduleIdle());
  pi.on("tool_call", (event) => controller.handleToolCall(event as ToolEventLike));
  pi.on("tool_result", (event) => controller.handleToolResult(event as ToolEventLike));
  pi.on("session_shutdown", () => controller.shutdown());
}
