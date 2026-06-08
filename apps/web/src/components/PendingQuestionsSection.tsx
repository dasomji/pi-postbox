import type { AskRequestSnapshot } from "@pi-postbox/protocol";
import { formatTime } from "../lib/format";
import type { SnapshotState } from "../types";
import { DashboardSection } from "./DashboardSection";
import { EmptyState } from "./EmptyState";
import { QuestionCard } from "./QuestionCard";

interface PendingQuestionsSectionProps {
  onResolved: () => Promise<void>;
  requests: AskRequestSnapshot[];
  snapshot: SnapshotState;
}

export function PendingQuestionsSection({ onResolved, requests, snapshot }: PendingQuestionsSectionProps) {
  const expiredCount = snapshot.status === "ready" ? snapshot.snapshot.requests.filter((request) => request.status === "expired").length : 0;
  const description = pendingDescription(snapshot, requests.length, expiredCount);
  const timestamp = snapshot.status === "ready" ? formatTime(snapshot.snapshot.timestamp) : undefined;

  return (
    <DashboardSection title="Pending questions" description={description} timestamp={timestamp} tone="attention">
      {requests.length > 0 ? (
        <div className="mt-5 grid gap-4">
          {requests.map((request) => (
            <QuestionCard key={request.requestId} request={request} onResolved={onResolved} />
          ))}
        </div>
      ) : (
        <EmptyState tone="attention">No pending questions. Calls to ask_postbox will appear here as answer cards.</EmptyState>
      )}
    </DashboardSection>
  );
}

function pendingDescription(snapshot: SnapshotState, pendingCount: number, expiredCount: number): string {
  if (snapshot.status === "loading") return "Loading pending questions…";
  if (snapshot.status === "error") return `Snapshot unavailable: ${snapshot.message}`;

  const pendingLabel = `${pendingCount} pending question${pendingCount === 1 ? "" : "s"}`;
  return `${pendingLabel}${expiredCount > 0 ? ` · ${expiredCount} expired` : ""}.`;
}
