import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { postJson } from "../api/postboxApi";

interface RenameInlineProps {
  endpoint: string;
  label: string;
  onRenamed: () => Promise<void>;
  value: string;
}

export function RenameInline({ label, value, endpoint, onRenamed }: RenameInlineProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [editing, value]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const displayName = draft.trim();
    if (!displayName) return;
    setBusy(true);
    setError(undefined);
    try {
      await postJson(endpoint, { displayName });
      setEditing(false);
      await onRenamed();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Rename failed");
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <form className="grid grid-cols-[7rem_1fr] gap-3" onSubmit={save}>
        <span className="text-postbox-muted">{label}</span>
        <span>
          <span className="flex gap-2">
            <input
              className="min-w-0 flex-1 rounded-lg border border-postbox-border-strong bg-postbox-canvas px-2 py-1 text-postbox-text outline-none ring-attention/30 focus:ring-2"
              value={draft}
              onChange={(event) => setDraft(event.currentTarget.value)}
              disabled={busy}
            />
            <button className="rounded-lg bg-attention px-2 py-1 text-xs font-semibold text-attention-contrast" type="submit" disabled={busy}>
              Save
            </button>
            <button
              className="rounded-lg border border-postbox-border-strong px-2 py-1 text-xs text-postbox-subtle"
              type="button"
              onClick={() => setEditing(false)}
              disabled={busy}
            >
              Cancel
            </button>
          </span>
          {error ? <span className="mt-1 block text-xs text-danger-foreground">{error}</span> : null}
        </span>
      </form>
    );
  }

  return (
    <div className="grid grid-cols-[7rem_1fr] gap-3">
      <dt className="text-postbox-muted">{label}</dt>
      <dd className="break-all text-postbox-subtle">
        {value}{" "}
        <button className="ml-2 text-xs font-semibold text-attention-foreground hover:text-attention-foreground/80" type="button" onClick={() => setEditing(true)}>
          rename
        </button>
      </dd>
    </div>
  );
}
