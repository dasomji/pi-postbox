import type { AskRequestSnapshot } from "@pi-postbox/protocol";

type AdditionalInfo = NonNullable<NonNullable<AskRequestSnapshot["context"]>["additionalInfo"]>[number];

export function AdditionalInfoItem({ item }: { item: AdditionalInfo }) {
  return (
    <div className="rounded-lg border border-postbox-border bg-postbox-canvas/70 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-postbox-muted">
        {item.kind}{item.language ? ` · ${item.language}` : ""}
      </p>
      {item.title ? <p className="mt-1 font-medium text-postbox-text">{item.title}</p> : null}
      {item.kind === "code" ? (
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-lg bg-black/40 p-3 text-xs text-postbox-subtle">
          <code>{item.content}</code>
        </pre>
      ) : (
        <p className="mt-2 whitespace-pre-wrap text-sm text-postbox-subtle">{item.content}</p>
      )}
    </div>
  );
}
