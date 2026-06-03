import { StateSnapshotSchema, type StateSnapshot } from "@pi-postbox/protocol";

type StateListener = (snapshot: StateSnapshot) => void;

export class StateBroadcaster {
  private readonly listeners = new Set<StateListener>();

  constructor(private readonly snapshotProvider: () => StateSnapshot) {}

  currentSnapshot(): StateSnapshot {
    return StateSnapshotSchema.parse(this.snapshotProvider());
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.currentSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  broadcast(): void {
    if (this.listeners.size === 0) return;
    const snapshot = this.currentSnapshot();
    for (const listener of [...this.listeners]) {
      listener(snapshot);
    }
  }

  close(): void {
    this.listeners.clear();
  }
}
