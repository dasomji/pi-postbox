import {
  HealthResponseSchema,
  HistoryResponseSchema,
  StateSnapshotSchema,
  type AskRequestSnapshot,
  type HealthResponse,
  type HistoryRecord,
  type HistoryResponse,
  type SessionSnapshot,
  type StateSnapshot
} from "@pi-postbox/protocol";
import { FormEvent, useEffect, useState } from "react";

type ConnectionState =
  | { status: "checking" }
  | { status: "connected"; health: HealthResponse }
  | { status: "unavailable"; message: string };

type SnapshotState =
  | { status: "loading" }
  | { status: "ready"; snapshot: StateSnapshot }
  | { status: "error"; message: string };

type HistoryState =
  | { status: "loading" }
  | { status: "ready"; response: HistoryResponse }
  | { status: "error"; message: string };

async function fetchSnapshot(): Promise<StateSnapshot> {
  const response = await fetch("/api/state");
  if (!response.ok) throw new Error(`State snapshot failed with ${response.status}`);
  return StateSnapshotSchema.parse(await response.json());
}

async function fetchHistory(): Promise<HistoryResponse> {
  const response = await fetch("/api/history");
  if (!response.ok) throw new Error(`History failed with ${response.status}`);
  return HistoryResponseSchema.parse(await response.json());
}

async function postJson(path: string, payload: unknown): Promise<void> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const fallback = response.status === 409 ? "This request was already resolved on another device." : `Action failed with ${response.status}`;
    const body = await response.json().catch(() => undefined) as { message?: string } | undefined;
    throw new Error(body?.message ?? fallback);
  }
}

export function App() {
  const [connection, setConnection] = useState<ConnectionState>({ status: "checking" });
  const [snapshot, setSnapshot] = useState<SnapshotState>({ status: "loading" });
  const [history, setHistory] = useState<HistoryState>({ status: "loading" });

  const loadHistory = () => {
    return fetchHistory()
      .then((response) => setHistory({ status: "ready", response }))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Unknown history error";
        setHistory({ status: "error", message });
      });
  };

  const loadSnapshot = () => {
    return fetchSnapshot()
      .then((nextSnapshot) => setSnapshot({ status: "ready", snapshot: nextSnapshot }))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Unknown state snapshot error";
        setSnapshot({ status: "error", message });
      });
  };

  useEffect(() => {
    let cancelled = false;

    fetch("/healthz")
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Health check failed with ${response.status}`);
        }

        return HealthResponseSchema.parse(await response.json());
      })
      .then((health) => {
        if (!cancelled) setConnection({ status: "connected", health });
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Unknown health check error";
        if (!cancelled) setConnection({ status: "unavailable", message });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let fallbackTimer: ReturnType<typeof setInterval> | undefined;

    void loadHistory();

    const applySnapshot = (nextSnapshot: StateSnapshot) => {
      if (!cancelled) setSnapshot({ status: "ready", snapshot: nextSnapshot });
    };

    const load = () => {
      fetchSnapshot()
        .then(applySnapshot)
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "Unknown state snapshot error";
          if (!cancelled) setSnapshot({ status: "error", message });
        });
    };

    const startPollingFallback = () => {
      if (fallbackTimer) return;
      load();
      fallbackTimer = setInterval(load, 5_000);
    };

    if (!("EventSource" in window)) {
      startPollingFallback();
      return () => {
        cancelled = true;
        if (fallbackTimer) clearInterval(fallbackTimer);
      };
    }

    const events = new EventSource("/api/state/events");
    events.addEventListener("state", (event) => {
      try {
        applySnapshot(StateSnapshotSchema.parse(JSON.parse(event.data)));
        void loadHistory();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Invalid live state event";
        if (!cancelled) setSnapshot({ status: "error", message });
      }
    });
    events.onerror = () => {
      startPollingFallback();
    };

    return () => {
      cancelled = true;
      events.close();
      if (fallbackTimer) clearInterval(fallbackTimer);
    };
  }, []);

  const sessions = snapshot.status === "ready" ? snapshot.snapshot.sessions : [];
  const requests = snapshot.status === "ready" ? snapshot.snapshot.requests.filter((request) => request.status === "pending") : [];
  const expiredCount = snapshot.status === "ready" ? snapshot.snapshot.requests.filter((request) => request.status === "expired").length : 0;
  const historyRecords = history.status === "ready" ? history.response.history : [];
  const refreshAfterResolution = async () => {
    await Promise.all([loadSnapshot(), loadHistory()]);
  };

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100 sm:px-6 sm:py-10">
      <section className="mx-auto max-w-5xl">
        <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-6 shadow-2xl shadow-slate-950/50 sm:p-8">
          <p className="text-sm font-semibold uppercase tracking-[0.35em] text-cyan-300">Pi Postbox</p>
          <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-4xl font-bold tracking-tight">Attention inbox</h1>
              <p className="mt-3 max-w-2xl text-lg text-slate-300">
                Answer pending Pi session decisions without streaming full agent conversations.
              </p>
            </div>
            <ConnectionBadge connection={connection} />
          </div>
        </div>

        <section className="mt-6 rounded-3xl border border-cyan-900/60 bg-cyan-950/20 p-5 shadow-xl shadow-slate-950/30">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold">Pending questions</h2>
              <p className="mt-1 text-sm text-cyan-100/70">
                {snapshot.status === "ready"
                  ? `${requests.length} pending question${requests.length === 1 ? "" : "s"}${expiredCount > 0 ? ` · ${expiredCount} expired` : ""}.`
                  : snapshot.status === "loading"
                    ? "Loading pending questions…"
                    : `Snapshot unavailable: ${snapshot.message}`}
              </p>
            </div>
            {snapshot.status === "ready" ? (
              <time className="text-xs text-cyan-100/50">{new Date(snapshot.snapshot.timestamp).toLocaleTimeString()}</time>
            ) : null}
          </div>

          {requests.length > 0 ? (
            <div className="mt-5 grid gap-4">
              {requests.map((request) => (
                <QuestionCard key={request.requestId} request={request} onResolved={refreshAfterResolution} />
              ))}
            </div>
          ) : (
            <div className="mt-5 rounded-2xl border border-dashed border-cyan-800/70 bg-slate-950/50 p-8 text-center text-cyan-100/70">
              No pending questions. Calls to <code>ask_postbox</code> will appear here as answer cards.
            </div>
          )}
        </section>

        <section className="mt-6 rounded-3xl border border-purple-900/60 bg-purple-950/20 p-5 shadow-xl shadow-slate-950/30">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold">Recent decision history</h2>
              <p className="mt-1 text-sm text-purple-100/70">
                {history.status === "ready"
                  ? `${historyRecords.length} resolved, cancelled, or expired request${historyRecords.length === 1 ? "" : "s"}.`
                  : history.status === "loading"
                    ? "Loading history…"
                    : `History unavailable: ${history.message}`}
              </p>
            </div>
            {history.status === "ready" ? (
              <time className="text-xs text-purple-100/50">{new Date(history.response.timestamp).toLocaleTimeString()}</time>
            ) : null}
          </div>

          {historyRecords.length > 0 ? (
            <div className="mt-5 grid gap-4">
              {historyRecords.map((record) => (
                <HistoryCard key={record.request.requestId} record={record} />
              ))}
            </div>
          ) : (
            <div className="mt-5 rounded-2xl border border-dashed border-purple-800/70 bg-slate-950/50 p-8 text-center text-purple-100/70">
              No recent history yet. Resolved, cancelled, and expired cards will appear here for audit without storing chat transcripts.
            </div>
          )}
        </section>

        <section className="mt-6 rounded-3xl border border-slate-800 bg-slate-900/70 p-5 shadow-xl shadow-slate-950/30">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold">Live Pi sessions</h2>
              <p className="mt-1 text-sm text-slate-400">
                {snapshot.status === "ready"
                  ? `${sessions.length} session${sessions.length === 1 ? "" : "s"} in the latest snapshot.`
                  : snapshot.status === "loading"
                    ? "Loading session snapshot…"
                    : `Snapshot unavailable: ${snapshot.message}`}
              </p>
            </div>
          </div>

          {sessions.length > 0 ? (
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {sessions.map((session) => (
                <SessionCard key={session.sessionId} session={session} onRenamed={loadSnapshot} />
              ))}
            </div>
          ) : (
            <div className="mt-5 rounded-2xl border border-dashed border-slate-700 bg-slate-950/50 p-8 text-center text-slate-400">
              No Pi sessions registered yet. Start Pi with the Postbox extension configured to this server.
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

function ConnectionBadge({ connection }: { connection: ConnectionState }) {
  if (connection.status === "checking") {
    return <span className="rounded-full bg-slate-800 px-4 py-2 text-sm text-slate-300">Checking server…</span>;
  }

  if (connection.status === "connected") {
    return (
      <span className="rounded-full bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300 ring-1 ring-emerald-500/30">
        Connected · protocol {connection.health.protocolVersion}
      </span>
    );
  }

  return (
    <span className="rounded-full bg-amber-500/10 px-4 py-2 text-sm text-amber-300 ring-1 ring-amber-500/30">
      Server unavailable
    </span>
  );
}

function QuestionCard({ request, onResolved }: { request: AskRequestSnapshot; onResolved: () => Promise<void> }) {
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
    <article className="rounded-2xl border border-cyan-800/70 bg-slate-950/80 p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-cyan-50">{request.question.prompt}</h3>
          <p className="mt-1 text-xs uppercase tracking-wide text-cyan-200/60">
            {request.mode === "single" ? "Choose one" : "Choose one or more"} · {new Date(request.createdAt).toLocaleString()}
          </p>
        </div>
        <span className="rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-cyan-200 ring-1 ring-cyan-500/30">
          pending
        </span>
      </div>

      <RichContextSections request={request} />

      <form className="mt-4 space-y-3" onSubmit={submit}>
        {request.options.map((option) => {
          const checked = selected.includes(option.value);
          return (
            <label
              key={option.value}
              className="flex cursor-pointer gap-3 rounded-xl border border-slate-800 bg-slate-900/70 p-3 hover:border-cyan-700"
            >
              <input
                className="mt-1"
                type={request.mode === "single" ? "radio" : "checkbox"}
                name={`answer-${request.requestId}`}
                checked={checked}
                onChange={() => toggle(option.value)}
              />
              <span>
                <span className="block font-medium text-slate-100">{option.label}</span>
                {option.description ? <span className="mt-1 block text-sm text-slate-400">{option.description}</span> : null}
                {option.meaning ? <span className="mt-2 block text-sm text-cyan-100/80">Meaning: {option.meaning}</span> : null}
                {option.context ? <span className="mt-1 block text-sm text-slate-400">Context: {option.context}</span> : null}
              </span>
            </label>
          );
        })}

        <label className="block text-sm text-slate-300">
          Optional note
          <textarea
            className="mt-2 min-h-20 w-full rounded-xl border border-slate-800 bg-slate-950 p-3 text-slate-100 outline-none ring-cyan-500/30 focus:ring-2"
            value={note}
            onChange={(event) => setNote(event.currentTarget.value)}
            placeholder="Add nuance for the coding agent…"
          />
        </label>

        {error ? <p className="rounded-lg bg-rose-500/10 p-3 text-sm text-rose-200">{error}</p> : null}

        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            className="rounded-xl bg-cyan-300 px-4 py-2 font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
            type="submit"
            disabled={busy || selected.length === 0}
          >
            Submit answer
          </button>
          <button
            className="rounded-xl border border-slate-700 px-4 py-2 font-semibold text-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
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

function HistoryCard({ record }: { record: HistoryRecord }) {
  const { request, session } = record;
  const result = request.result;
  const selectedLabels = result?.status === "answered"
    ? result.selectedValues
        .map((value) => request.options.find((option) => option.value === value)?.label ?? value)
        .join(", ")
    : undefined;

  return (
    <article className="rounded-2xl border border-purple-900/70 bg-slate-950/80 p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-purple-50">{request.question.prompt}</h3>
          <p className="mt-1 text-xs uppercase tracking-wide text-purple-200/60">
            {session.project.projectName} · {session.project.branch ?? session.branch ?? "unknown branch"} · {session.machine.machineName}
          </p>
        </div>
        <span className={historyStatusClass(request.status)}>{request.status}</span>
      </div>

      <dl className="mt-4 grid gap-3 text-sm">
        {selectedLabels ? <Metadata label="Answer" value={selectedLabels} /> : null}
        {result && "note" in result && result.note ? <Metadata label="Note" value={result.note} /> : null}
        {result?.rationale ? <Metadata label="Rationale" value={result.rationale} /> : null}
        <Metadata label="Created" value={new Date(request.createdAt).toLocaleString()} />
        {request.resolvedAt ? <Metadata label="Resolved" value={new Date(request.resolvedAt).toLocaleString()} /> : null}
        <Metadata label="Session" value={session.title ?? session.sessionId} />
        <Metadata label="Repo" value={session.project.repoName ?? session.project.projectName} />
        <Metadata label="Worktree" value={session.project.worktreePath ?? session.worktreePath ?? "not reported"} />
      </dl>

      <RichContextSections request={request} />
    </article>
  );
}

function RichContextSections({ request }: { request: AskRequestSnapshot }) {
  const hasQuestionContext = request.question.context || request.question.relevance || request.question.decisionImpact;
  const hasHandoffContext = request.context?.codebaseContext || request.context?.problemContext || request.context?.additionalInfo?.length;
  const hasForkReference = request.forkReference && Object.values(request.forkReference).some(Boolean);

  if (!hasQuestionContext && !hasHandoffContext && !hasForkReference) return null;

  return (
    <div className="mt-4 space-y-2">
      {hasQuestionContext ? (
        <details className="rounded-xl border border-cyan-900/70 bg-cyan-950/20 p-3">
          <summary className="cursor-pointer text-sm font-semibold text-cyan-100">Why this decision matters</summary>
          <dl className="mt-3 grid gap-3 text-sm">
            {request.question.context ? <Metadata label="Context" value={request.question.context} /> : null}
            {request.question.relevance ? <Metadata label="Relevance" value={request.question.relevance} /> : null}
            {request.question.decisionImpact ? <Metadata label="Impact" value={request.question.decisionImpact} /> : null}
          </dl>
        </details>
      ) : null}

      {hasHandoffContext ? (
        <details className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
          <summary className="cursor-pointer text-sm font-semibold text-slate-100">Interviewer handoff context</summary>
          <dl className="mt-3 grid gap-3 text-sm">
            {request.context?.problemContext ? <Metadata label="Problem" value={request.context.problemContext} /> : null}
            {request.context?.codebaseContext ? <Metadata label="Codebase" value={request.context.codebaseContext} /> : null}
          </dl>
          {request.context?.additionalInfo?.length ? (
            <div className="mt-3 space-y-2">
              {request.context.additionalInfo.map((item, index) => (
                <div key={`${item.title ?? item.kind}-${index}`} className="rounded-lg border border-slate-800 bg-slate-950/70 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {item.kind}{item.language ? ` · ${item.language}` : ""}
                  </p>
                  {item.title ? <p className="mt-1 font-medium text-slate-100">{item.title}</p> : null}
                  {item.kind === "code" ? (
                    <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-lg bg-black/40 p-3 text-xs text-slate-200">
                      <code>{item.content}</code>
                    </pre>
                  ) : (
                    <p className="mt-2 whitespace-pre-wrap text-sm text-slate-300">{item.content}</p>
                  )}
                </div>
              ))}
            </div>
          ) : null}
        </details>
      ) : null}

      {hasForkReference ? (
        <details className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
          <summary className="cursor-pointer text-sm font-semibold text-slate-100">Future fork reference</summary>
          <dl className="mt-3 grid gap-3 text-sm">
            {request.forkReference?.agentSessionId ? <Metadata label="Session ID" value={request.forkReference.agentSessionId} /> : null}
            {request.forkReference?.agentSessionPath ? <Metadata label="Session path" value={request.forkReference.agentSessionPath} /> : null}
            {request.forkReference?.leafId ? <Metadata label="Leaf ID" value={request.forkReference.leafId} /> : null}
            {request.forkReference?.cwd ? <Metadata label="CWD" value={request.forkReference.cwd} /> : null}
            {request.forkReference?.model ? <Metadata label="Model" value={request.forkReference.model} /> : null}
          </dl>
        </details>
      ) : null}
    </div>
  );
}

function SessionCard({ session, onRenamed }: { session: SessionSnapshot; onRenamed: () => Promise<void> }) {
  const worktreeLabel = session.worktreePath ? session.worktreePath.split("/").filter(Boolean).at(-1) : undefined;
  const fallbackTitle = `${session.repoName ?? session.projectName}${worktreeLabel ? ` / ${worktreeLabel}` : ""}${session.branch ? ` · ${session.branch}` : ""}`;
  const title = session.title ?? fallbackTitle;

  return (
    <article className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <ProjectIcon session={session} />
            <div className="min-w-0">
              <h3 className="break-words text-lg font-semibold text-slate-100">{title}</h3>
              <p className="mt-1 break-words text-sm text-slate-400">{session.projectName}</p>
            </div>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className={semanticClass(session.semanticState)}>{session.semanticState === "blocked" ? "waiting" : session.semanticState}</span>
          <span className={presenceClass(session.presence)}>{session.presence}</span>
        </div>
      </div>

      <div className="mt-4 grid gap-3 text-sm">
        <RenameInline
          label="Machine"
          value={session.machineName}
          endpoint={`/api/machines/${encodeURIComponent(session.machineId)}/rename`}
          onRenamed={onRenamed}
        />
        <RenameInline
          label="Project"
          value={session.projectName}
          endpoint={`/api/projects/${encodeURIComponent(session.projectId)}/rename`}
          onRenamed={onRenamed}
        />
        <Metadata label="Detected project" value={session.projectDetectedName ?? session.projectName} />
        <Metadata label="Repo" value={session.repoName ?? "unknown"} />
        <Metadata label="Branch" value={session.branch ?? "unknown"} />
        <Metadata label="Head" value={session.headSha ? `${session.headSha.slice(0, 12)}${session.isDirty ? " + dirty" : ""}` : session.isDirty ? "dirty" : "unknown"} />
        <Metadata label="State" value={session.semanticState === "blocked" ? "blocked / waiting" : session.semanticState} />
        <Metadata label="CWD" value={session.cwd} />
        <Metadata label="Git root" value={session.gitRoot ?? "not reported"} />
        <Metadata label="Worktree" value={session.worktreePath ?? "not reported"} />
        {session.projectDescription ? <Metadata label="Description" value={session.projectDescription} /> : null}
        <Metadata
          label="Last heartbeat"
          value={session.lastHeartbeatAt ? new Date(session.lastHeartbeatAt).toLocaleString() : "not reported"}
        />
      </div>
    </article>
  );
}

function ProjectIcon({ session }: { session: SessionSnapshot }) {
  if (session.projectIcon?.dataUrl) {
    return (
      <img
        className="h-11 w-11 shrink-0 rounded-xl border border-slate-800 bg-slate-900 object-contain p-1"
        src={session.projectIcon.dataUrl}
        alt=""
      />
    );
  }

  return (
    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-800 bg-cyan-500/10 text-sm font-bold text-cyan-200">
      {(session.projectName || "?").slice(0, 2).toUpperCase()}
    </div>
  );
}

function RenameInline({ label, value, endpoint, onRenamed }: { label: string; value: string; endpoint: string; onRenamed: () => Promise<void> }) {
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
        <span className="text-slate-500">{label}</span>
        <span>
          <span className="flex gap-2">
            <input
              className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100 outline-none ring-cyan-500/30 focus:ring-2"
              value={draft}
              onChange={(event) => setDraft(event.currentTarget.value)}
              disabled={busy}
            />
            <button className="rounded-lg bg-cyan-300 px-2 py-1 text-xs font-semibold text-slate-950" type="submit" disabled={busy}>
              Save
            </button>
            <button className="rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-300" type="button" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </button>
          </span>
          {error ? <span className="mt-1 block text-xs text-rose-300">{error}</span> : null}
        </span>
      </form>
    );
  }

  return (
    <div className="grid grid-cols-[7rem_1fr] gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="break-all text-slate-300">
        {value}{" "}
        <button className="ml-2 text-xs font-semibold text-cyan-300 hover:text-cyan-100" type="button" onClick={() => setEditing(true)}>
          rename
        </button>
      </dd>
    </div>
  );
}

function Metadata({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="break-all text-slate-300">{value}</dd>
    </div>
  );
}

function historyStatusClass(status: AskRequestSnapshot["status"]): string {
  const base = "rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ring-1";
  if (status === "answered") return `${base} bg-emerald-500/10 text-emerald-300 ring-emerald-500/30`;
  if (status === "cancelled") return `${base} bg-amber-500/10 text-amber-200 ring-amber-500/30`;
  if (status === "expired") return `${base} bg-slate-500/10 text-slate-300 ring-slate-500/30`;
  return `${base} bg-cyan-500/10 text-cyan-200 ring-cyan-500/30`;
}

function semanticClass(state: SessionSnapshot["semanticState"]): string {
  const base = "rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ring-1";
  if (state === "blocked") return `${base} bg-rose-500/10 text-rose-200 ring-rose-500/40`;
  if (state === "working") return `${base} bg-cyan-500/10 text-cyan-200 ring-cyan-500/30`;
  if (state === "idle") return `${base} bg-slate-500/10 text-slate-300 ring-slate-500/30`;
  return `${base} bg-slate-700/40 text-slate-400 ring-slate-600/50`;
}

function presenceClass(presence: SessionSnapshot["presence"]): string {
  const base = "rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ring-1";
  if (presence === "live") return `${base} bg-emerald-500/10 text-emerald-300 ring-emerald-500/30`;
  if (presence === "stale") return `${base} bg-amber-500/10 text-amber-300 ring-amber-500/30`;
  return `${base} bg-slate-700/40 text-slate-300 ring-slate-600/50`;
}
