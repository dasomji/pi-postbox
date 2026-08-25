import type { OwnerIdentity } from "@pi-postbox/protocol";

export type NativeHarnessIdentity =
  | { harness: "pi"; sessionUuid: string }
  | { harness: "claude-code"; agentId: string; sessionId?: string }
  | { harness: "codex"; threadId: string; sessionId?: string };

/** Maps the harness-native unit of answer authority, excluding broader run provenance. */
export function ownerFromNativeIdentity(identity: NativeHarnessIdentity): OwnerIdentity {
  if (identity.harness === "pi") return { harness: "pi", ownerId: identity.sessionUuid };
  if (identity.harness === "claude-code") return { harness: "claude-code", ownerId: identity.agentId };
  return { harness: "codex", ownerId: identity.threadId };
}

/** Executable contract used by adapters whose waiting children retain runnable slots. */
export class AdapterRunnableSlotLimiter {
  private occupied = 0;

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error("Adapter runnable capacity must be a positive integer");
  }

  get occupiedSlots(): number { return this.occupied; }

  run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.occupied >= this.capacity) throw new Error("runnable capacity exhausted");
    this.occupied += 1;
    return operation().finally(() => { this.occupied -= 1; });
  }
}
