import type { ConnectionState } from "../types";
import { ConnectionBadge } from "./ConnectionBadge";

export function PageHeader({ connection }: { connection: ConnectionState }) {
  return (
    <header className="rounded-3xl border border-postbox-border bg-postbox-surface/70 p-6 shadow-postbox-panel sm:p-8">
      <p className="text-sm font-semibold uppercase tracking-[0.35em] text-attention-foreground">Pi Postbox</p>
      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-postbox-text">Attention inbox</h1>
          <p className="mt-3 max-w-2xl text-lg text-postbox-subtle">
            Answer pending Pi session decisions without streaming full agent conversations.
          </p>
        </div>
        <ConnectionBadge connection={connection} />
      </div>
    </header>
  );
}
