import { DecisionHistorySection } from "./components/DecisionHistorySection";
import { LiveSessionsSection } from "./components/LiveSessionsSection";
import { PageHeader } from "./components/PageHeader";
import { PendingQuestionsSection } from "./components/PendingQuestionsSection";
import { useHealthCheck } from "./hooks/useHealthCheck";
import { usePostboxState } from "./hooks/usePostboxState";

export function App() {
  const connection = useHealthCheck();
  const { history, loadSnapshot, refreshAfterResolution, snapshot } = usePostboxState();
  const sessions = snapshot.status === "ready" ? snapshot.snapshot.sessions : [];
  const requests = snapshot.status === "ready" ? snapshot.snapshot.requests.filter((request) => request.status === "pending") : [];
  const historyRecords = history.status === "ready" ? history.response.history : [];

  return (
    <main className="min-h-screen bg-postbox-canvas px-4 py-8 text-postbox-text sm:px-6 sm:py-10">
      <section className="mx-auto max-w-5xl">
        <PageHeader connection={connection} />
        <PendingQuestionsSection requests={requests} snapshot={snapshot} onResolved={refreshAfterResolution} />
        <DecisionHistorySection records={historyRecords} history={history} />
        <LiveSessionsSection sessions={sessions} snapshot={snapshot} onRenamed={loadSnapshot} />
      </section>
    </main>
  );
}
