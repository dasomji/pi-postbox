import type {
  QuestionChatActivationResponse,
  QuestionChatEvent,
  QuestionChatSendPayload,
  QuestionChatSendResponse,
  QuestionChatSnapshot,
  QuestionChatStopPayload,
  QuestionChatStopResponse
} from "@pi-postbox/protocol";
import type { QuestionChatEventConnection, QuestionChatProbeResult } from "../api/postboxApi";
import { applyQuestionChatEvent } from "./questionChat";

export interface QuestionChatApi {
  activate(requestId: string): Promise<QuestionChatActivationResponse>;
  fetchSnapshot(requestId: string): Promise<QuestionChatSnapshot>;
  probeSnapshot(requestId: string): Promise<QuestionChatProbeResult>;
  sendMessage(requestId: string, command: QuestionChatSendPayload): Promise<QuestionChatSendResponse>;
  stop(requestId: string, command: QuestionChatStopPayload): Promise<QuestionChatStopResponse>;
  connectEvents(requestId: string, onEvent: (event: QuestionChatEvent) => void): QuestionChatEventConnection;
}

export type QuestionChatView =
  | { kind: "not-started" }
  | { kind: "starting" }
  | { kind: "ready"; snapshot: QuestionChatSnapshot }
  | { kind: "unavailable"; message: string };

interface LifecycleCallbacks {
  started?: () => void;
  activationFailed?: () => void;
  event?: (event: QuestionChatEvent) => void;
}

type LifecycleApi = Pick<QuestionChatApi, "activate" | "fetchSnapshot" | "probeSnapshot" | "connectEvents">;

export class QuestionChatLifecycle {
  view = $state<QuestionChatView>({ kind: "not-started" });
  private requestId = "";
  private generation = 0;
  private mounted = true;
  private disconnectEvents: (() => void) | undefined;

  constructor(private readonly api: LifecycleApi, private callbacks: LifecycleCallbacks) {}

  setCallbacks(callbacks: LifecycleCallbacks): void {
    this.callbacks = callbacks;
  }

  selectRequest(requestId: string): void {
    if (requestId === this.requestId) return;
    this.generation += 1;
    this.closeEvents();
    this.requestId = requestId;
    this.view = { kind: "not-started" };
  }

  destroy(): void {
    this.mounted = false;
    this.generation += 1;
    this.closeEvents();
  }

  async start(): Promise<void> {
    if (this.view.kind === "starting" || this.view.kind === "ready") return;
    const requestId = this.requestId;
    const generation = this.generation;
    let started = false;
    this.view = { kind: "starting" };
    try {
      const response = await this.api.activate(requestId);
      if (!this.isCurrent(requestId, generation)) return;
      if (response.status === "unavailable") {
        this.view = { kind: "unavailable", message: response.error.message };
        this.callbacks.activationFailed?.();
        return;
      }
      this.view = { kind: "ready", snapshot: response.snapshot };
      started = true;
      this.callbacks.started?.();
      await this.synchronize(requestId, generation);
    } catch (error) {
      if (!this.isCurrent(requestId, generation)) return;
      this.closeEvents();
      this.view = { kind: "unavailable", message: error instanceof Error ? error.message : "Question Chat is unavailable." };
      if (!started) this.callbacks.activationFailed?.();
    }
  }

  async recover(): Promise<void> {
    const requestId = this.requestId;
    const generation = this.generation;
    let discovered = false;
    try {
      const response = await this.api.probeSnapshot(requestId);
      if (!this.isCurrent(requestId, generation) || this.view.kind !== "not-started" || response.status === "not-started") return;
      this.view = { kind: "ready", snapshot: response.snapshot };
      discovered = true;
      this.callbacks.started?.();
      await this.synchronize(requestId, generation);
    } catch (error) {
      if (!discovered || !this.isCurrent(requestId, generation)) return;
      this.closeEvents();
      this.view = {
        kind: "unavailable",
        message: error instanceof Error ? error.message : "Question Chat synchronization is unavailable."
      };
    }
  }

  private async synchronize(requestId: string, generation: number): Promise<void> {
    if (!this.isCurrent(requestId, generation)) return;
    const buffered: QuestionChatEvent[] = [];
    let synchronized = false;
    this.closeEvents();
    const connection = this.api.connectEvents(requestId, (event) => {
      if (!synchronized) buffered.push(event);
      else this.applyEvent(event);
    });
    let closed = false;
    const close = (): void => {
      if (closed) return;
      closed = true;
      connection.close();
    };
    if (!this.isCurrent(requestId, generation)) {
      close();
      return;
    }
    this.disconnectEvents = close;
    await connection.ready;
    if (!this.isCurrent(requestId, generation)) {
      close();
      return;
    }
    const snapshot = await this.api.fetchSnapshot(requestId);
    if (!this.isCurrent(requestId, generation)) {
      close();
      return;
    }
    this.view = { kind: "ready", snapshot };
    for (const event of buffered.sort((left, right) => left.sequence - right.sequence)) this.applyEvent(event);
    synchronized = true;
  }

  applyEvent(event: QuestionChatEvent): void {
    if (this.view.kind !== "ready") return;
    this.view = { kind: "ready", snapshot: applyQuestionChatEvent(this.view.snapshot, event) };
    this.callbacks.event?.(event);
  }

  private isCurrent(requestId: string, generation: number): boolean {
    return this.mounted && this.requestId === requestId && this.generation === generation;
  }

  private closeEvents(): void {
    this.disconnectEvents?.();
    this.disconnectEvents = undefined;
  }
}
