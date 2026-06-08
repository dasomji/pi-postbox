import type { AskRequestSnapshot } from "@pi-postbox/protocol";
import type { FormEvent } from "react";
import { useState } from "react";
import { postJson } from "../api/postboxApi";
import { formatTimestamp } from "../lib/format";
import { QuestionOptionChoice } from "./QuestionOptionChoice";
import { RichContextSections } from "./RichContextSections";
import { StatusBadge } from "./StatusBadge";

export function QuestionCard({ request, onResolved }: { request: AskRequestSnapshot; onResolved: () => Promise<void> }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const toggle = (value: string) => {
    if (request.mode === "single") {
      setSelected([value]);
      return;
    }
    setSelected((current) => (current.includes(value) ? current.filter((item) => item !== value) : [...current, value]));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await postJson(`/api/requests/${encodeURIComponent(request.requestId)}/answer`, {
        selectedValues: selected,
        note: note.trim() || undefined
      });
      await onResolved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to submit answer");
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await postJson(`/api/requests/${encodeURIComponent(request.requestId)}/cancel`, { note: note.trim() || undefined });
      await onResolved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to cancel request");
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="rounded-2xl border border-attention-border bg-postbox-canvas/80 p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-postbox-text">{request.question.prompt}</h3>
          <p className="mt-1 text-xs uppercase tracking-wide text-attention-foreground/60">
            {request.mode === "single" ? "Choose one" : "Choose one or more"} · {formatTimestamp(request.createdAt)}
          </p>
        </div>
        <StatusBadge tone="attention">pending</StatusBadge>
      </div>

      <RichContextSections request={request} />

      <form className="mt-4 space-y-3" onSubmit={submit}>
        {request.options.map((option) => (
          <QuestionOptionChoice
            key={option.value}
            checked={selected.includes(option.value)}
            mode={request.mode}
            name={`answer-${request.requestId}`}
            onToggle={() => toggle(option.value)}
            option={option}
          />
        ))}

        <label className="block text-sm text-postbox-subtle">
          Optional note
          <textarea
            className="mt-2 min-h-20 w-full rounded-xl border border-postbox-border bg-postbox-canvas p-3 text-postbox-text outline-none ring-attention/30 focus:ring-2"
            value={note}
            onChange={(event) => setNote(event.currentTarget.value)}
            placeholder="Add nuance for the coding agent…"
          />
        </label>

        {error ? <p className="rounded-lg bg-danger/10 p-3 text-sm text-danger-foreground">{error}</p> : null}

        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            className="rounded-xl bg-attention px-4 py-2 font-semibold text-attention-contrast disabled:cursor-not-allowed disabled:opacity-50"
            type="submit"
            disabled={busy || selected.length === 0}
          >
            Submit answer
          </button>
          <button
            className="rounded-xl border border-postbox-border-strong px-4 py-2 font-semibold text-postbox-subtle disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
            disabled={busy}
            onClick={() => void cancel()}
          >
            Cancel request
          </button>
        </div>
      </form>
    </article>
  );
}
