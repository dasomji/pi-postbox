import type { ConnectionState } from "../types";

export function ConnectionBadge({ connection }: { connection: ConnectionState }) {
  if (connection.status === "checking") {
    return <span className="rounded-full bg-postbox-muted px-4 py-2 text-sm text-postbox-subtle">Checking server…</span>;
  }

  if (connection.status === "connected") {
    return (
      <span className="rounded-full bg-success/10 px-4 py-2 text-sm text-success-foreground ring-1 ring-success/30">
        Connected · protocol {connection.health.protocolVersion}
      </span>
    );
  }

  return (
    <span className="rounded-full bg-warning/10 px-4 py-2 text-sm text-warning-foreground ring-1 ring-warning/30">
      Server unavailable
    </span>
  );
}
