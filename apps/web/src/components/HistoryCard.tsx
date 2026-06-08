import type { HistoryRecord } from "@pi-postbox/protocol";
import { formatTimestamp, selectedOptionLabels } from "../lib/format";
import { historyTone } from "../lib/statusStyles";
import { MetadataRow } from "./MetadataRow";
import { RichContextSections } from "./RichContextSections";
import { StatusBadge } from "./StatusBadge";

export function HistoryCard({ record }: { record: HistoryRecord }) {
  const { request, session } = record;
  const result = request.result;
  const selectedLabels = selectedOptionLabels(request);

  return (
    <article className="rounded-2xl border border-history-border bg-postbox-canvas/80 p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-postbox-text">{request.question.prompt}</h3>
          <p className="mt-1 text-xs uppercase tracking-wide text-history-foreground/60">
            {session.project.projectName} · {session.project.branch ?? session.branch ?? "unknown branch"} · {session.machine.machineName}
          </p>
        </div>
        <StatusBadge tone={historyTone(request.status)}>{request.status}</StatusBadge>
      </div>

      <dl className="mt-4 grid gap-3 text-sm">
        {selectedLabels ? <MetadataRow label="Answer" value={selectedLabels} /> : null}
        {result && "note" in result && result.note ? <MetadataRow label="Note" value={result.note} /> : null}
        {result?.rationale ? <MetadataRow label="Rationale" value={result.rationale} /> : null}
        <MetadataRow label="Created" value={formatTimestamp(request.createdAt)} />
        {request.resolvedAt ? <MetadataRow label="Resolved" value={formatTimestamp(request.resolvedAt)} /> : null}
        <MetadataRow label="Session" value={session.title ?? session.sessionId} />
        <MetadataRow label="Repo" value={session.project.repoName ?? session.project.projectName} />
        <MetadataRow label="Worktree" value={session.project.worktreePath ?? session.worktreePath ?? "not reported"} />
      </dl>

      <RichContextSections request={request} />
    </article>
  );
}
