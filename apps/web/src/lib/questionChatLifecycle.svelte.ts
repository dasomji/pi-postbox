import type {
  QuestionChatActivationResponse,
  QuestionChatAvailabilityError,
  QuestionChatEvent,
  QuestionChatStreamEvent,
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
  activateContext(requestId: string): Promise<QuestionChatActivationResponse>;
  fetchSnapshot(requestId: string): Promise<QuestionChatSnapshot>;
  probeSnapshot(requestId: string): Promise<QuestionChatProbeResult>;
  sendMessage(requestId: string, command: QuestionChatSendPayload): Promise<QuestionChatSendResponse>;
  stop(requestId: string, command: QuestionChatStopPayload): Promise<QuestionChatStopResponse>;
  connectEvents(requestId: string, onEvent: (event: QuestionChatStreamEvent) => void): QuestionChatEventConnection;
}

export type QuestionChatView =
  | { kind: "not-started" }
  | { kind: "starting" }
  | { kind: "ready"; snapshot: QuestionChatSnapshot; connection: "online" | "offline" | "stale" }
  | { kind: "unavailable"; error: QuestionChatAvailabilityError };

interface LifecycleCallbacks {
  started?: () => void;
  activationFailed?: (error: QuestionChatAvailabilityError) => void;
  event?: (event: QuestionChatEvent) => void;
  recoveryUnavailable?: (error: QuestionChatAvailabilityError) => void;
  recoveryNotStarted?: () => void;
}

type LifecycleApi = Pick<QuestionChatApi, "activate" | "activateContext" | "fetchSnapshot" | "probeSnapshot" | "connectEvents">;

export class QuestionChatLifecycle {
  view = $state<QuestionChatView>({ kind: "not-started" });
  private requestId = "";
  private generation = 0;
  private mounted = true;
  private disconnectEvents: (() => void) | undefined;
  private resynchronizing = false;

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
    await this.activateWith((requestId) => this.api.activate(requestId));
  }

  async startContext(): Promise<void> {
    await this.activateWith((requestId) => this.api.activateContext(requestId));
  }

  private async activateWith(activate: (requestId: string) => Promise<QuestionChatActivationResponse>): Promise<void> {
    if (this.view.kind === "starting" || this.view.kind === "ready") return;
    const requestId = this.requestId;
    const generation = this.generation;
    let started = false;
    this.view = { kind: "starting" };
    try {
      const response = await activate(requestId);
      if (!this.isCurrent(requestId, generation)) return;
      if (response.status === "unavailable") {
        this.view = { kind: "unavailable", error: response.error };
        this.callbacks.activationFailed?.(response.error);
        return;
      }
      this.view = { kind: "ready", snapshot: response.snapshot, connection: "online" };
      started = true;
      this.callbacks.started?.();
      await this.synchronize(requestId, generation);
    } catch (error) {
      if (!this.isCurrent(requestId, generation)) return;
      this.closeEvents();
      const availabilityError: QuestionChatAvailabilityError = {
        code: "runtime_failure",
        message: error instanceof Error ? error.message : "Question Chat is unavailable."
      };
      this.view = { kind: "unavailable", error: availabilityError };
      if (!started) this.callbacks.activationFailed?.(availabilityError);
    }
  }

  async recover(): Promise<void> {
    const requestId = this.requestId;
    const generation = this.generation;
    let discovered = false;
    try {
      const response = await this.api.probeSnapshot(requestId);
      if (!this.isCurrent(requestId, generation) || this.view.kind !== "not-started" || response.status === "not-started") return;
      if (response.status === "unavailable") {
        this.view = { kind: "unavailable", error: response.error };
        this.callbacks.recoveryUnavailable?.(response.error);
        return;
      }
      this.view = { kind: "ready", snapshot: response.snapshot, connection: "online" };
      discovered = true;
      this.callbacks.started?.();
      await this.synchronize(requestId, generation);
    } catch (error) {
      if (!discovered || !this.isCurrent(requestId, generation)) return;
      this.closeEvents();
      this.view = {
        kind: "unavailable",
        error: {
          code: "runtime_failure",
          message: error instanceof Error ? error.message : "Question Chat synchronization is unavailable."
        }
      };
    }
  }

  async retry(): Promise<void> {
    const requestId = this.requestId;
    const generation = this.generation;
    if (this.view.kind === "ready") {
      this.view = { ...this.view, connection: "stale" };
      await this.resynchronizePreserving(requestId, generation);
      return;
    }
    if (this.view.kind !== "unavailable") return;
    const response = await this.api.probeSnapshot(requestId);
    if (!this.isCurrent(requestId, generation)) return;
    if (response.status === "not-started") {
      this.view = { kind: "not-started" };
      this.callbacks.recoveryNotStarted?.();
      return;
    }
    if (response.status === "unavailable") {
      this.view = { kind: "unavailable", error: response.error };
      this.callbacks.recoveryUnavailable?.(response.error);
      return;
    }
    this.view = { kind: "ready", snapshot: response.snapshot, connection: "stale" };
    this.callbacks.started?.();
    await this.resynchronizePreserving(requestId, generation);
  }

  private async synchronize(requestId: string, generation: number): Promise<void> {
    if (!this.isCurrent(requestId, generation)) return;
    const buffered: QuestionChatStreamEvent[] = [];
    let synchronized = false;
    this.closeEvents();
    const connection = this.api.connectEvents(requestId, (event) => {
      if (!synchronized) buffered.push(event);
      else this.applyStreamEvent(event);
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
    this.view = { kind: "ready", snapshot, connection: "online" };
    for (const event of buffered.sort((left, right) => sequenceOf(left) - sequenceOf(right))) this.applyStreamEvent(event);
    synchronized = true;
  }

  applyEvent(event: QuestionChatEvent): void {
    if (this.view.kind !== "ready") return;
    if (event.sequence <= this.view.snapshot.sequence) return;
    if (event.sequence > this.view.snapshot.sequence + 1) {
      this.view = { ...this.view, connection: "stale" };
      void this.resynchronizePreserving(this.requestId, this.generation);
      return;
    }
    if (this.view.connection !== "online") return;
    this.view = { kind: "ready", snapshot: applyQuestionChatEvent(this.view.snapshot, event), connection: "online" };
    this.callbacks.event?.(event);
  }

  private applyStreamEvent(event: QuestionChatStreamEvent): void {
    if (event.type !== "transport") {
      this.applyEvent(event);
      return;
    }
    if (this.view.kind !== "ready") return;
    if (event.state === "offline") {
      this.view = { ...this.view, connection: "offline" };
      return;
    }
    if (this.view.connection !== "online") {
      this.view = { ...this.view, connection: "stale" };
      void this.resynchronizePreserving(this.requestId, this.generation);
    }
  }

  private async resynchronizePreserving(requestId: string, generation: number): Promise<void> {
    if (this.resynchronizing || !this.isCurrent(requestId, generation)) return;
    this.resynchronizing = true;
    try {
      await this.synchronize(requestId, generation);
    } catch {
      if (this.isCurrent(requestId, generation) && this.view.kind === "ready") {
        this.view = { ...this.view, connection: "offline" };
      }
    } finally {
      this.resynchronizing = false;
    }
  }

  private isCurrent(requestId: string, generation: number): boolean {
    return this.mounted && this.requestId === requestId && this.generation === generation;
  }

  private closeEvents(): void {
    this.disconnectEvents?.();
    this.disconnectEvents = undefined;
  }
}

function sequenceOf(event: QuestionChatStreamEvent): number {
  return event.type === "transport" ? Number.NEGATIVE_INFINITY : event.sequence;
}
