import type { HistoryRecord } from "@pi-postbox/protocol";
import { formatTime } from "../lib/format";
import type { HistoryState } from "../types";
import { DashboardSection } from "./DashboardSection";
import { EmptyState } from "./EmptyState";
import { HistoryCard } from "./HistoryCard";

interface DecisionHistorySectionProps {
  history: HistoryState;
  records: HistoryRecord[];
}

export function DecisionHistorySection({ history, records }: DecisionHistorySectionProps) {
  const timestamp = history.status === "ready" ? formatTime(history.response.timestamp) : undefined;

  return (
    <DashboardSection title="Recent decision history" description={historyDescription(history, records.length)} timestamp={timestamp} tone="history">
      {records.length > 0 ? (
        <div className="mt-5 grid gap-4">
          {records.map((record) => (
            <HistoryCard key={record.request.requestId} record={record} />
          ))}
        </div>
      ) : (
        <EmptyState tone="history">
          No recent history yet. Resolved, cancelled, and expired cards will appear here for audit without storing chat transcripts.
        </EmptyState>
      )}
    </DashboardSection>
  );
}

function historyDescription(history: HistoryState, recordCount: number): string {
  if (history.status === "loading") return "Loading history…";
  if (history.status === "error") return `History unavailable: ${history.message}`;
  return `${recordCount} resolved, cancelled, or expired request${recordCount === 1 ? "" : "s"}.`;
}
