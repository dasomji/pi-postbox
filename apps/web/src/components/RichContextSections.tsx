import type { AskRequestSnapshot } from "@pi-postbox/protocol";
import { AdditionalInfoItem } from "./AdditionalInfoItem";
import { MetadataRow } from "./MetadataRow";

export function RichContextSections({ request }: { request: AskRequestSnapshot }) {
  const hasQuestionContext = request.question.context || request.question.relevance || request.question.decisionImpact;
  const hasHandoffContext = request.context?.codebaseContext || request.context?.problemContext || request.context?.additionalInfo?.length;
  const hasForkReference = request.forkReference && Object.values(request.forkReference).some(Boolean);

  if (!hasQuestionContext && !hasHandoffContext && !hasForkReference) return null;

  return (
    <div className="mt-4 space-y-2">
      {hasQuestionContext ? (
        <details className="rounded-xl border border-attention-border bg-attention/10 p-3">
          <summary className="cursor-pointer text-sm font-semibold text-attention-foreground">Why this decision matters</summary>
          <dl className="mt-3 grid gap-3 text-sm">
            {request.question.context ? <MetadataRow label="Context" value={request.question.context} /> : null}
            {request.question.relevance ? <MetadataRow label="Relevance" value={request.question.relevance} /> : null}
            {request.question.decisionImpact ? <MetadataRow label="Impact" value={request.question.decisionImpact} /> : null}
          </dl>
        </details>
      ) : null}

      {hasHandoffContext ? (
        <details className="rounded-xl border border-postbox-border bg-postbox-elevated/70 p-3">
          <summary className="cursor-pointer text-sm font-semibold text-postbox-text">Interviewer handoff context</summary>
          <dl className="mt-3 grid gap-3 text-sm">
            {request.context?.problemContext ? <MetadataRow label="Problem" value={request.context.problemContext} /> : null}
            {request.context?.codebaseContext ? <MetadataRow label="Codebase" value={request.context.codebaseContext} /> : null}
          </dl>
          {request.context?.additionalInfo?.length ? (
            <div className="mt-3 space-y-2">
              {request.context.additionalInfo.map((item, index) => (
                <AdditionalInfoItem key={`${item.title ?? item.kind}-${index}`} item={item} />
              ))}
            </div>
          ) : null}
        </details>
      ) : null}

      {hasForkReference ? (
        <details className="rounded-xl border border-postbox-border bg-postbox-elevated/70 p-3">
          <summary className="cursor-pointer text-sm font-semibold text-postbox-text">Future fork reference</summary>
          <dl className="mt-3 grid gap-3 text-sm">
            {request.forkReference?.agentSessionId ? <MetadataRow label="Session ID" value={request.forkReference.agentSessionId} /> : null}
            {request.forkReference?.agentSessionPath ? <MetadataRow label="Session path" value={request.forkReference.agentSessionPath} /> : null}
            {request.forkReference?.leafId ? <MetadataRow label="Leaf ID" value={request.forkReference.leafId} /> : null}
            {request.forkReference?.cwd ? <MetadataRow label="CWD" value={request.forkReference.cwd} /> : null}
            {request.forkReference?.model ? <MetadataRow label="Model" value={request.forkReference.model} /> : null}
          </dl>
        </details>
      ) : null}
    </div>
  );
}
