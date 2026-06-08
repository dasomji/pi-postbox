import type { SessionSnapshot } from "@pi-postbox/protocol";
import type { SnapshotState } from "../types";
import { DashboardSection } from "./DashboardSection";
import { EmptyState } from "./EmptyState";
import { SessionCard } from "./SessionCard";

interface LiveSessionsSectionProps {
  onRenamed: () => Promise<void>;
  sessions: SessionSnapshot[];
  snapshot: SnapshotState;
}

export function LiveSessionsSection({ onRenamed, sessions, snapshot }: LiveSessionsSectionProps) {
  return (
    <DashboardSection title="Live Pi sessions" description={sessionDescription(snapshot, sessions.length)}>
      {sessions.length > 0 ? (
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {sessions.map((session) => (
            <SessionCard key={session.sessionId} session={session} onRenamed={onRenamed} />
          ))}
        </div>
      ) : (
        <EmptyState>No Pi sessions registered yet. Start Pi with the Postbox extension configured to this server.</EmptyState>
      )}
    </DashboardSection>
  );
}

function sessionDescription(snapshot: SnapshotState, sessionCount: number): string {
  if (snapshot.status === "loading") return "Loading session snapshot…";
  if (snapshot.status === "error") return `Snapshot unavailable: ${snapshot.message}`;
  return `${sessionCount} session${sessionCount === 1 ? "" : "s"} in the latest snapshot.`;
}
