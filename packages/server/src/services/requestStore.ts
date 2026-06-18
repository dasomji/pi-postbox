import {
  AskAnswerPayloadSchema,
  AskCancelPayloadSchema,
  AskCreatePayloadSchema,
  OTHER_OPTION_VALUE,
  type AskAnswerPayload,
  type AskCancelPayload,
  type AskCreatePayload,
  type AskRequestSnapshot,
  type AskResult,
  type AskStatus
} from "@pi-postbox/protocol";
import type { SqliteDatabase } from "../db/database.js";

interface AskRequestRow {
  request_id: string;
  session_id: string;
  mode: "single" | "multi";
  prompt: string;
  question_json: string | null;
  options_json: string;
  context_json: string | null;
  fork_reference_json: string | null;
  status: AskStatus;
  selected_values_json: string | null;
  note: string | null;
  rationale: string | null;
  created_at: string;
  expires_at: string | null;
  resolved_at: string | null;
  updated_at: string;
}

type ResolutionListener = (result: AskResult) => void;

export interface RequestStoreOptions {
  askTimeoutMs?: number;
}

const DEFAULT_ASK_TIMEOUT_MS = 12 * 60 * 60 * 1000;
const EXPIRED_RATIONALE = "Postbox request expired before an answer was submitted.";
const SESSION_SHUTDOWN_NOTE = "Originating Pi session shut down.";

export class RequestStore {
  private readonly listeners = new Map<string, Set<ResolutionListener>>();
  private closed = false;
  private readonly askTimeoutMs: number;

  constructor(
    private readonly db: SqliteDatabase,
    private readonly now: () => number,
    options: RequestStoreOptions = {}
  ) {
    this.askTimeoutMs = options.askTimeoutMs ?? DEFAULT_ASK_TIMEOUT_MS;
  }

  close(): void {
    this.closed = true;
    this.listeners.clear();
  }

  create(payload: AskCreatePayload): AskRequestSnapshot {
    if (this.closed) throw new Error("request store is closed");
    this.expireDue();
    const parsed = AskCreatePayloadSchema.parse(payload);

    const existing = this.get(parsed.requestId);
    if (existing) return existing;

    const nowIso = new Date(this.now()).toISOString();
    const expiresAt = parsed.expiresAt ?? new Date(this.now() + this.askTimeoutMs).toISOString();

    const session = this.db.prepare("SELECT session_id FROM sessions WHERE session_id = ?").get(parsed.sessionId);
    if (!session) throw new RequestStoreError("session_not_found", "Cannot create an ask for an unknown session");

    this.db
      .prepare(
        `INSERT INTO ask_requests (
          request_id, session_id, mode, prompt, question_json, options_json, context_json, fork_reference_json, status,
          selected_values_json, note, rationale, created_at, expires_at, resolved_at, updated_at
        ) VALUES (
          @requestId, @sessionId, @mode, @prompt, @questionJson, @optionsJson, @contextJson, @forkReferenceJson, 'pending',
          NULL, NULL, NULL, @nowIso, @expiresAt, NULL, @nowIso
        )`
      )
      .run({
        requestId: parsed.requestId,
        sessionId: parsed.sessionId,
        mode: parsed.mode,
        prompt: parsed.question.prompt,
        questionJson: JSON.stringify(parsed.question),
        optionsJson: JSON.stringify(parsed.options),
        contextJson: parsed.context ? JSON.stringify(parsed.context) : null,
        forkReferenceJson: parsed.forkReference ? JSON.stringify(parsed.forkReference) : null,
        nowIso,
        expiresAt
      });

    const snapshot = this.get(parsed.requestId);
    if (!snapshot) throw new Error("created request could not be loaded");
    return snapshot;
  }

  list(filters: { status?: AskStatus } = {}): AskRequestSnapshot[] {
    const rows = filters.status
      ? (this.db
          .prepare("SELECT * FROM ask_requests WHERE status = ? ORDER BY created_at ASC")
          .all(filters.status) as AskRequestRow[])
      : (this.db.prepare("SELECT * FROM ask_requests ORDER BY created_at ASC").all() as AskRequestRow[]);
    return rows.map((row) => this.toSnapshot(row));
  }

  get(requestId: string): AskRequestSnapshot | undefined {
    const row = this.db.prepare("SELECT * FROM ask_requests WHERE request_id = ?").get(requestId) as AskRequestRow | undefined;
    return row ? this.toSnapshot(row) : undefined;
  }

  answer(requestId: string, payload: AskAnswerPayload): AskResult {
    this.expireDue();
    const parsed = AskAnswerPayloadSchema.parse(payload);
    let result: AskResult | undefined;

    const transaction = this.db.transaction(() => {
      const existing = this.getPending(requestId);
      this.validateSelectedValues(existing, parsed.selectedValues);
      const resolvedAt = new Date(this.now()).toISOString();

      const changes = this.db
        .prepare(
          `UPDATE ask_requests
           SET status = 'answered',
               selected_values_json = @selectedValuesJson,
               note = @note,
               rationale = @rationale,
               resolved_at = @resolvedAt,
               updated_at = @resolvedAt
           WHERE request_id = @requestId AND status = 'pending'`
        )
        .run({
          requestId,
          selectedValuesJson: JSON.stringify(parsed.selectedValues),
          note: parsed.note ?? null,
          rationale: parsed.rationale ?? null,
          resolvedAt
        }).changes;

      if (changes !== 1) throw new RequestStoreError("request_already_resolved", "Ask request is already resolved");
      result = {
        status: "answered",
        requestId,
        selectedValues: parsed.selectedValues,
        note: parsed.note,
        rationale: parsed.rationale,
        resolvedAt
      };
    });

    transaction();
    if (!result) throw new Error("answer transaction did not produce a result");
    this.notify(requestId, result);
    return result;
  }

  cancel(requestId: string, payload: AskCancelPayload = {}): AskResult {
    this.expireDue();
    const parsed = AskCancelPayloadSchema.parse(payload);
    let result: AskResult | undefined;

    const transaction = this.db.transaction(() => {
      this.getPending(requestId);
      const resolvedAt = new Date(this.now()).toISOString();

      const changes = this.db
        .prepare(
          `UPDATE ask_requests
           SET status = 'cancelled',
               note = @note,
               rationale = @rationale,
               resolved_at = @resolvedAt,
               updated_at = @resolvedAt
           WHERE request_id = @requestId AND status = 'pending'`
        )
        .run({ requestId, note: parsed.note ?? null, rationale: parsed.rationale ?? null, resolvedAt }).changes;

      if (changes !== 1) throw new RequestStoreError("request_already_resolved", "Ask request is already resolved");
      result = {
        status: "cancelled",
        requestId,
        note: parsed.note,
        rationale: parsed.rationale,
        resolvedAt
      };
    });

    transaction();
    if (!result) throw new Error("cancel transaction did not produce a result");
    this.notify(requestId, result);
    return result;
  }

  cancelPendingForSession(sessionId: string, rationale: string): AskResult[] {
    this.expireDue();
    const nowIso = new Date(this.now()).toISOString();
    const pendingRows = this.db
      .prepare("SELECT * FROM ask_requests WHERE session_id = ? AND status = 'pending' ORDER BY created_at ASC")
      .all(sessionId) as AskRequestRow[];

    if (pendingRows.length === 0) return [];

    const results: AskResult[] = [];
    const transaction = this.db.transaction(() => {
      for (const row of pendingRows) {
        const changes = this.db
          .prepare(
            `UPDATE ask_requests
             SET status = 'cancelled',
                 note = COALESCE(note, @note),
                 rationale = COALESCE(rationale, @rationale),
                 resolved_at = @resolvedAt,
                 updated_at = @resolvedAt
             WHERE request_id = @requestId AND status = 'pending'`
          )
          .run({ requestId: row.request_id, note: SESSION_SHUTDOWN_NOTE, rationale, resolvedAt: nowIso }).changes;

        if (changes === 1) {
          results.push({ status: "cancelled", requestId: row.request_id, note: SESSION_SHUTDOWN_NOTE, rationale, resolvedAt: nowIso });
        }
      }
    });

    transaction();
    for (const result of results) this.notify(result.requestId, result);
    return results;
  }

  expireDue(): AskResult[] {
    const nowIso = new Date(this.now()).toISOString();
    const dueRows = this.db
      .prepare("SELECT * FROM ask_requests WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at <= ? ORDER BY created_at ASC")
      .all(nowIso) as AskRequestRow[];

    if (dueRows.length === 0) return [];

    const results: AskResult[] = [];
    const transaction = this.db.transaction(() => {
      for (const row of dueRows) {
        const changes = this.db
          .prepare(
            `UPDATE ask_requests
             SET status = 'expired',
                 rationale = COALESCE(rationale, @rationale),
                 resolved_at = @resolvedAt,
                 updated_at = @resolvedAt
             WHERE request_id = @requestId AND status = 'pending'`
          )
          .run({ requestId: row.request_id, rationale: EXPIRED_RATIONALE, resolvedAt: nowIso }).changes;

        if (changes === 1) {
          results.push({ status: "expired", requestId: row.request_id, rationale: EXPIRED_RATIONALE, resolvedAt: nowIso });
        }
      }
    });

    transaction();
    for (const result of results) this.notify(result.requestId, result);
    return results;
  }

  onResolved(requestId: string, listener: ResolutionListener): () => void {
    let listeners = this.listeners.get(requestId);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(requestId, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners?.delete(listener);
      if (listeners?.size === 0) this.listeners.delete(requestId);
    };
  }

  private getPending(requestId: string): AskRequestSnapshot {
    const existing = this.get(requestId);
    if (!existing) throw new RequestStoreError("request_not_found", "Ask request not found");
    if (existing.status !== "pending") throw new RequestStoreError("request_already_resolved", "Ask request is already resolved");
    return existing;
  }

  private validateSelectedValues(request: AskRequestSnapshot, selectedValues: string[]): void {
    if (request.mode === "single" && selectedValues.length !== 1) {
      throw new RequestStoreError("invalid_selection", "Single-choice asks require exactly one selected value");
    }

    const allowed = new Set([...request.options.map((option) => option.value), OTHER_OPTION_VALUE]);
    const invalid = selectedValues.find((value) => !allowed.has(value));
    if (invalid) throw new RequestStoreError("invalid_selection", `Unknown option value: ${invalid}`);
  }

  private toSnapshot(row: AskRequestRow): AskRequestSnapshot {
    const result = this.toResult(row);
    return {
      requestId: row.request_id,
      sessionId: row.session_id,
      mode: row.mode,
      question: this.parseJson(row.question_json, { prompt: row.prompt }) as AskRequestSnapshot["question"],
      options: JSON.parse(row.options_json) as AskRequestSnapshot["options"],
      context: row.context_json ? (this.parseJson(row.context_json, undefined) as AskRequestSnapshot["context"]) : undefined,
      forkReference: row.fork_reference_json
        ? (this.parseJson(row.fork_reference_json, undefined) as AskRequestSnapshot["forkReference"])
        : undefined,
      status: row.status,
      createdAt: row.created_at,
      expiresAt: row.expires_at ?? undefined,
      resolvedAt: row.resolved_at ?? undefined,
      result
    };
  }

  private parseJson(value: string | null, fallback: unknown): unknown {
    if (!value) return fallback;
    return JSON.parse(value) as unknown;
  }

  private toResult(row: AskRequestRow): AskResult | undefined {
    if (!row.resolved_at) return undefined;
    if (row.status === "answered") {
      return {
        status: "answered",
        requestId: row.request_id,
        selectedValues: JSON.parse(row.selected_values_json ?? "[]") as string[],
        note: row.note ?? undefined,
        rationale: row.rationale ?? undefined,
        resolvedAt: row.resolved_at
      };
    }
    if (row.status === "cancelled") {
      return {
        status: "cancelled",
        requestId: row.request_id,
        note: row.note ?? undefined,
        rationale: row.rationale ?? undefined,
        resolvedAt: row.resolved_at
      };
    }
    if (row.status === "expired") {
      return {
        status: "expired",
        requestId: row.request_id,
        rationale: row.rationale ?? undefined,
        resolvedAt: row.resolved_at
      };
    }
    return undefined;
  }

  private notify(requestId: string, result: AskResult): void {
    const listeners = this.listeners.get(requestId);
    if (!listeners) return;
    for (const listener of [...listeners]) listener(result);
    this.listeners.delete(requestId);
  }
}

export class RequestStoreError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "RequestStoreError";
  }
}
