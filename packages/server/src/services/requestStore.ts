import {
  AskAnswerPayloadSchema,
  AskCancelPayloadSchema,
  AskCreatePayloadSchema,
  ProposeAnswerPayloadSchema,
  compareAskUrgency,
  OTHER_OPTION_VALUE,
  type AskAnswerPayload,
  type AskCancelPayload,
  type AskCreatePayload,
  type AskQuestionDraft,
  type AskBatchReceipt,
  type AskRequestSnapshot,
  type AskResult,
  type AskStatus,
  type AskUrgency,
  type AskOption,
  type ProposeAnswerPayload,
  type ProposedAnswerOption
} from "@pi-postbox/protocol";
import { randomUUID } from "node:crypto";
import type { SqliteDatabase } from "../db/database.js";
import { normalizeProposedOptionLabel } from "./proposedOptionPolicy.js";

interface AskRequestRow {
  request_id: string;
  session_id: string;
  mode: "single" | "multi";
  urgency: AskUrgency;
  prompt: string;
  question_json: string | null;
  options_json: string;
  context_json: string | null;
  fork_reference_json: string | null;
  parent_question_id: string | null;
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
export interface AnswerAvailable {
  questionId: string;
  question: string;
  answerId: string;
  ownerHarness: string;
  ownerId: string;
}
type AnswerAvailableListener = (answer: AnswerAvailable) => void;

export interface RequestStoreOptions {
  askTimeoutMs?: number;
  generateProposedOptionValue?: () => string;
}

export interface ProposedAnswerAppend {
  option: ProposedAnswerOption;
  request: AskRequestSnapshot;
}

export interface QuestionDiscoveryCaller {
  owner: { harness: string; ownerId: string };
  repository: string;
  worktree: string;
  feature: string;
}

export interface QuestionDiscoveryFilters {
  caller: QuestionDiscoveryCaller;
  owner?: { harness: string; ownerId: string };
  repository?: string;
  worktree?: string;
  feature?: string;
  status?: AskStatus;
  global?: boolean;
  cursor?: string;
  pageSize?: number;
}

const EXPIRED_RATIONALE = "Postbox request expired before an answer was submitted.";
const SESSION_SHUTDOWN_NOTE = "Originating Pi session shut down.";
const PROPOSED_OPTION_VALUE_ATTEMPTS = 4;
const OPTIONS_MAX = 20;

export class RequestStore {
  private readonly listeners = new Map<string, Set<ResolutionListener>>();
  private readonly globalResolutionListeners = new Set<ResolutionListener>();
  private readonly answerAvailableListeners = new Set<AnswerAvailableListener>();
  private closed = false;
  private readonly askTimeoutMs: number | undefined;
  private readonly generateProposedOptionValue: () => string;

  constructor(
    private readonly db: SqliteDatabase,
    private readonly now: () => number,
    options: RequestStoreOptions = {}
  ) {
    this.askTimeoutMs = options.askTimeoutMs;
    this.generateProposedOptionValue = options.generateProposedOptionValue ?? (() => `chat_${randomUUID()}`);
  }

  close(): void {
    this.closed = true;
    this.listeners.clear();
    this.globalResolutionListeners.clear();
    this.answerAvailableListeners.clear();
  }

  create(payload: AskCreatePayload): AskRequestSnapshot {
    if (this.closed) throw new Error("request store is closed");
    this.expireDue();
    const parsed = AskCreatePayloadSchema.parse(payload);

    const existing = this.get(parsed.requestId);
    if (existing) return existing;

    const nowIso = new Date(this.now()).toISOString();
    const expiresAt = parsed.expiresAt ?? (this.askTimeoutMs === undefined
      ? undefined
      : new Date(this.now() + this.askTimeoutMs).toISOString());

    const session = this.db.prepare("SELECT session_id, owner_harness, owner_id, repository_id, worktree_id, feature_id FROM sessions WHERE session_id = ?").get(parsed.sessionId) as
      { session_id: string; owner_harness: string | null; owner_id: string | null; repository_id: string | null; worktree_id: string | null; feature_id: string | null } | undefined;
    if (!session) throw new RequestStoreError("session_not_found", "Cannot create an ask for an unknown session");

    const insertLegacy = this.db.prepare(
        `INSERT INTO ask_requests (
          request_id, session_id, mode, urgency, prompt, question_json, options_json, context_json, fork_reference_json, parent_question_id, status,
          selected_values_json, note, rationale, created_at, expires_at, resolved_at, updated_at
        ) VALUES (
          @requestId, @sessionId, @mode, @urgency, @prompt, @questionJson, @optionsJson, @contextJson, @forkReferenceJson, @parentQuestionId, 'pending',
          NULL, NULL, NULL, @nowIso, @expiresAt, NULL, @nowIso
        )`
      );
    const createDecision = this.db.transaction(() => {
      insertLegacy.run({
        requestId: parsed.requestId,
        sessionId: parsed.sessionId,
        mode: parsed.mode,
        urgency: parsed.urgency,
        prompt: parsed.question.prompt,
        questionJson: JSON.stringify(parsed.question),
        optionsJson: JSON.stringify(parsed.options),
        contextJson: parsed.context ? JSON.stringify(parsed.context) : null,
        forkReferenceJson: parsed.forkReference ? JSON.stringify(parsed.forkReference) : null,
        parentQuestionId: parsed.parentQuestionId ?? null,
        nowIso,
        expiresAt
      });
      if (session.owner_harness && session.owner_id) this.db.prepare(`INSERT INTO questions (
        question_id, legacy_request_id, creator_harness, creator_owner_id, owner_harness, owner_owner_id,
        revision, mode, urgency, question_json, options_json, context_json, parent_question_id, status, expires_at, resolved_at,
        repository_id, worktree_id, feature_id, created_at, updated_at
      ) VALUES (@requestId, @requestId, @harness, @ownerId, @harness, @ownerId,
        1, @mode, @urgency, @questionJson, @optionsJson, @contextJson, @parentQuestionId, 'pending', @expiresAt, NULL,
        @repositoryId, @worktreeId, @featureId, @nowIso, @nowIso)`)
        .run({
          requestId: parsed.requestId,
          harness: session.owner_harness,
          ownerId: session.owner_id,
          mode: parsed.mode,
          urgency: parsed.urgency,
          questionJson: JSON.stringify(parsed.question),
          optionsJson: JSON.stringify(parsed.options),
          contextJson: JSON.stringify(parsed.context),
          parentQuestionId: parsed.parentQuestionId ?? null,
          repositoryId: session.repository_id,
          worktreeId: session.worktree_id,
          featureId: session.feature_id,
          expiresAt,
          nowIso
        });
    });
    createDecision();

    const snapshot = this.get(parsed.requestId);
    if (!snapshot) throw new Error("created request could not be loaded");
    return snapshot;
  }

  createOne(sessionId: string, draft: AskQuestionDraft): { questionId: string; revision: number; status: "created"; nudge?: string } {
    const parentQuestionId = draft.parent && "questionId" in draft.parent ? draft.parent.questionId : undefined;
    const hierarchy = this.validateHierarchy(parentQuestionId);
    const request = this.create({ ...draft, sessionId, parentQuestionId });
    const nudge = hierarchy.childCount === 3 ? "This is the fourth direct child Question." : hierarchy.depth === 3 ? "This is a level-four Question." : undefined;
    return { questionId: request.requestId, revision: 1, status: "created", ...(nudge ? { nudge } : {}) };
  }

  createBatch(sessionId: string, drafts: AskQuestionDraft[]): AskBatchReceipt {
    const items: AskBatchReceipt["items"] = [];
    const localIds = new Map<string, string>();
    let aborted = false;
    this.db.transaction(() => {
      for (const draft of drafts) {
        if (aborted) {
          items.push({ localRef: draft.localRef, status: "rejected", reason: { code: "batch_aborted", message: "An earlier Question violated the hierarchy contract." } });
          continue;
        }
        let parentQuestionId: string | undefined;
        if (draft.parent && "localRef" in draft.parent) {
          parentQuestionId = localIds.get(draft.parent.localRef);
          if (!parentQuestionId) {
            aborted = true;
            items.push({ localRef: draft.localRef, status: "rejected", reason: { code: "forward_parent_reference", message: "A batch parent must appear before its child." } });
            continue;
          }
        } else if (draft.parent && "questionId" in draft.parent) parentQuestionId = draft.parent.questionId;
        try {
          this.validateHierarchy(parentQuestionId);
          const request = this.create({ ...draft, sessionId, parentQuestionId });
          localIds.set(draft.localRef, request.requestId);
          items.push({ localRef: draft.localRef, status: "created", questionId: request.requestId, revision: 1 });
        } catch (error) {
          const code = error instanceof RequestStoreError && ["parent_not_found", "child_limit_reached", "depth_limit_reached"].includes(error.code)
            ? error.code as "parent_not_found" | "child_limit_reached" | "depth_limit_reached" : "invalid_draft";
          aborted = true;
          items.push({ localRef: draft.localRef, status: "rejected", reason: { code, message: error instanceof Error ? error.message : "Question was rejected." } });
        }
      }
    })();
    const created = items.filter((item) => item.status === "created").length;
    return { status: created === items.length ? "created" : created ? "partial" : "rejected", items };
  }

  private validateHierarchy(parentQuestionId?: string): { childCount: number; depth: number } {
    if (!parentQuestionId) return { childCount: 0, depth: 1 };
    const parent = this.db.prepare("SELECT question_id, parent_question_id FROM questions WHERE question_id = ?").get(parentQuestionId) as
      { question_id: string; parent_question_id: string | null } | undefined;
    if (!parent) throw new RequestStoreError("parent_not_found", "Parent Question was not found.");
    const childCount = (this.db.prepare("SELECT COUNT(*) AS count FROM questions WHERE parent_question_id = ?").get(parentQuestionId) as { count: number }).count;
    if (childCount >= 5) throw new RequestStoreError("child_limit_reached", "A Question may have no more than five direct children.");
    let depth = 2;
    let ancestorId = parent.parent_question_id;
    while (ancestorId) {
      depth += 1;
      ancestorId = (this.db.prepare("SELECT parent_question_id FROM questions WHERE question_id = ?").get(ancestorId) as { parent_question_id: string | null } | undefined)?.parent_question_id ?? null;
    }
    if (depth > 4) throw new RequestStoreError("depth_limit_reached", "A Question hierarchy may have no more than four levels.");
    return { childCount, depth };
  }

  list(filters: { status?: AskStatus } = {}): AskRequestSnapshot[] {
    const rows =
      filters.status === "pending"
        ? (this.db
            .prepare("SELECT * FROM ask_requests WHERE status = 'pending' ORDER BY created_at ASC")
            .all() as AskRequestRow[]).sort((a, b) => compareAskUrgency(a.urgency, b.urgency))
        : filters.status
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

  listQuestions(filters: QuestionDiscoveryFilters): {
    questions: Array<{ questionId: string; question: string }>;
    nextCursor?: string;
  } {
    const pageSize = filters.pageSize ?? 25;
    if (!Number.isSafeInteger(pageSize) || pageSize < 1) {
      throw new RequestStoreError("invalid_page_size", "Question page size must be a positive integer");
    }
    const offset = this.decodeQuestionCursor(filters.cursor);
    const clauses: string[] = [];
    const parameters: Record<string, unknown> = { limit: pageSize + 1, offset };
    if (!filters.global) {
      clauses.push("COALESCE(q.repository_id, p.repo_name) = @repository", "COALESCE(q.worktree_id, s.worktree_path, p.worktree_path, s.cwd) = @worktree", "COALESCE(q.feature_id, s.branch, p.branch) = @feature");
      parameters.repository = filters.repository ?? filters.caller.repository;
      parameters.worktree = filters.worktree ?? filters.caller.worktree;
      parameters.feature = filters.feature ?? filters.caller.feature;
    } else {
      if (filters.repository !== undefined) { clauses.push("COALESCE(q.repository_id, p.repo_name) = @repository"); parameters.repository = filters.repository; }
      if (filters.worktree !== undefined) { clauses.push("COALESCE(q.worktree_id, s.worktree_path, p.worktree_path, s.cwd) = @worktree"); parameters.worktree = filters.worktree; }
      if (filters.feature !== undefined) { clauses.push("COALESCE(q.feature_id, s.branch, p.branch) = @feature"); parameters.feature = filters.feature; }
    }
    if (filters.owner) {
      clauses.push("q.owner_harness = @ownerHarness", "q.owner_owner_id = @ownerId");
      parameters.ownerHarness = filters.owner.harness;
      parameters.ownerId = filters.owner.ownerId;
    }
    clauses.push("q.status = @status");
    parameters.status = filters.status ?? "pending";
    const rows = this.db.prepare(`SELECT q.question_id, q.question_json
      FROM questions q
      JOIN ask_requests r ON r.request_id = q.legacy_request_id
      JOIN sessions s ON s.session_id = r.session_id
      JOIN projects p ON p.project_id = s.project_id
      WHERE ${clauses.join(" AND ")}
      ORDER BY q.created_at ASC, q.question_id ASC
      LIMIT @limit OFFSET @offset`).all(parameters) as Array<{ question_id: string; question_json: string }>;
    const hasMore = rows.length > pageSize;
    const questions = rows.slice(0, pageSize).map((row) => ({
      questionId: row.question_id,
      question: (JSON.parse(row.question_json) as { prompt: string }).prompt
    }));
    return { questions, ...(hasMore ? { nextCursor: this.encodeQuestionCursor(offset + pageSize) } : {}) };
  }

  getQuestions(input: { questionIds: string[] }): Array<Record<string, unknown>> {
    if (input.questionIds.length === 0) return [];
    const select = this.db.prepare(`SELECT q.*, a.answer_id, a.first_reader_harness
      FROM questions q LEFT JOIN answers a ON a.question_id = q.question_id
      WHERE q.question_id = ? ORDER BY a.question_revision DESC, a.created_at DESC LIMIT 1`);
    return input.questionIds.flatMap((questionId) => {
      const row = select.get(questionId) as Record<string, unknown> | undefined;
      if (!row) return [];
      return [{
        questionId: row.question_id,
        revision: row.revision,
        mode: row.mode,
        urgency: row.urgency,
        question: JSON.parse(row.question_json as string),
        options: JSON.parse(row.options_json as string),
        ...(row.context_json ? { context: JSON.parse(row.context_json as string) } : {}),
        status: row.status,
        owner: { harness: row.owner_harness, ownerId: row.owner_owner_id },
        creator: { harness: row.creator_harness, ownerId: row.creator_owner_id },
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        ...(row.expires_at ? { expiresAt: row.expires_at } : {}),
        ...(row.resolved_at ? { resolvedAt: row.resolved_at } : {}),
        ...(row.answer_id ? { answerId: row.answer_id, answerRead: row.first_reader_harness !== null } : {})
      }];
    });
  }

  listQuestionStatus(filters: QuestionDiscoveryFilters & {
    readState?: "read" | "unread";
    includeTerminal?: boolean;
  }): Array<Record<string, unknown>> {
    const clauses: string[] = [];
    const parameters: Record<string, unknown> = {};
    const owner = filters.owner ?? filters.caller.owner;
    if (!filters.global || filters.owner) {
      clauses.push("q.owner_harness = @ownerHarness", "q.owner_owner_id = @ownerId");
      parameters.ownerHarness = owner.harness;
      parameters.ownerId = owner.ownerId;
    }
    if (!filters.global) {
      clauses.push("p.repo_name = @repository", "COALESCE(s.worktree_path, p.worktree_path, s.cwd) = @worktree", "COALESCE(s.branch, p.branch) = @feature");
      parameters.repository = filters.repository ?? filters.caller.repository;
      parameters.worktree = filters.worktree ?? filters.caller.worktree;
      parameters.feature = filters.feature ?? filters.caller.feature;
    } else {
      if (filters.repository !== undefined) { clauses.push("p.repo_name = @repository"); parameters.repository = filters.repository; }
      if (filters.worktree !== undefined) { clauses.push("COALESCE(s.worktree_path, p.worktree_path, s.cwd) = @worktree"); parameters.worktree = filters.worktree; }
      if (filters.feature !== undefined) { clauses.push("COALESCE(s.branch, p.branch) = @feature"); parameters.feature = filters.feature; }
    }
    if (filters.status) { clauses.push("q.status = @status"); parameters.status = filters.status; }
    else if (filters.readState === "read") clauses.push("a.first_reader_harness IS NOT NULL");
    else if (filters.readState === "unread") clauses.push("a.answer_id IS NOT NULL", "a.first_reader_harness IS NULL");
    else clauses.push("(q.status = 'pending' OR (a.answer_id IS NOT NULL AND a.first_reader_harness IS NULL))");
    const rows = this.db.prepare(`SELECT q.question_id, q.status, a.answer_id, a.first_reader_harness
      FROM questions q
      LEFT JOIN answers a ON a.question_id = q.question_id
      JOIN ask_requests r ON r.request_id = q.legacy_request_id
      JOIN sessions s ON s.session_id = r.session_id
      JOIN projects p ON p.project_id = s.project_id
      WHERE ${clauses.length ? clauses.join(" AND ") : "1 = 1"}
      ORDER BY q.created_at ASC, q.question_id ASC`).all(parameters) as Array<{
        question_id: string; status: string; answer_id: string | null; first_reader_harness: string | null
      }>;
    return rows.map((row) => ({
      questionId: row.question_id,
      status: row.status,
      ...(row.answer_id ? { answerId: row.answer_id, answerRead: row.first_reader_harness !== null } : {})
    }));
  }

  proposeAnswer(requestId: string, ownerSessionId: string, payload: ProposeAnswerPayload): ProposedAnswerAppend {
    if (this.closed) throw new Error("request store is closed");
    this.expireDue();
    let appended: ProposedAnswerAppend | undefined;

    const transaction = this.db.transaction(() => {
      const row = this.db.prepare("SELECT * FROM ask_requests WHERE request_id = ?").get(requestId) as AskRequestRow | undefined;
      if (!row) throw new RequestStoreError("request_not_found", "Question not found.");
      if (row.status !== "pending") throw new RequestStoreError("request_terminal", "Question is no longer pending.");
      const durableQuestion = this.db.prepare("SELECT 1 FROM questions WHERE legacy_request_id = ?").get(requestId);
      const ownsQuestion = durableQuestion ? this.db.prepare(`SELECT 1 FROM questions q JOIN sessions s
        ON s.owner_harness = q.owner_harness AND s.owner_id = q.owner_owner_id
        WHERE q.legacy_request_id = ? AND s.session_id = ? AND q.status = 'pending'`).get(requestId, ownerSessionId) : row.session_id === ownerSessionId;
      if (!ownsQuestion) throw new RequestStoreError("wrong_owner", "Question Chat does not own this Question.");

      const parsed = ProposeAnswerPayloadSchema.safeParse(payload);
      if (!parsed.success || normalizeProposedOptionLabel(parsed.data.label).length === 0) {
        throw new RequestStoreError("invalid_proposal", "Suggested option is invalid.");
      }

      const options = JSON.parse(row.options_json) as AskOption[];
      if (options.length >= OPTIONS_MAX) {
        throw new RequestStoreError("option_limit_reached", "Question already has the maximum number of options.");
      }

      const normalizedLabel = normalizeProposedOptionLabel(parsed.data.label);
      if (options.some((option) => normalizeProposedOptionLabel(option.label) === normalizedLabel)) {
        throw new RequestStoreError("duplicate_option", "An option with that label already exists.");
      }

      const usedValues = new Set([...options.map((option) => option.value), OTHER_OPTION_VALUE]);
      let value: string | undefined;
      for (let attempt = 0; attempt < PROPOSED_OPTION_VALUE_ATTEMPTS; attempt += 1) {
        const candidate = this.generateProposedOptionValue();
        if (typeof candidate === "string" && candidate.length > 0 && candidate.length <= 200 && !usedValues.has(candidate)) {
          value = candidate;
          break;
        }
      }
      if (!value) {
        throw new RequestStoreError("option_value_collision", "Could not allocate a unique option value.");
      }

      const option: ProposedAnswerOption = { value, ...parsed.data, provenance: "chat" };
      const updatedAt = new Date(this.now()).toISOString();
      const changes = this.db.prepare(
        `UPDATE ask_requests
         SET options_json = @optionsJson,
             updated_at = @updatedAt
         WHERE request_id = @requestId
           AND status = 'pending'`
      ).run({
        requestId,
        ownerSessionId,
        optionsJson: JSON.stringify([...options, option]),
        updatedAt
      }).changes;

      if (changes !== 1) throw new RequestStoreError("request_terminal", "Question is no longer pending.");
      const durableChanges = this.db.prepare(`UPDATE questions SET options_json = @optionsJson, revision = revision + 1, updated_at = @updatedAt
        WHERE legacy_request_id = @requestId AND owner_harness = (
          SELECT owner_harness FROM sessions WHERE session_id = @ownerSessionId
        ) AND owner_owner_id = (
          SELECT owner_id FROM sessions WHERE session_id = @ownerSessionId
        ) AND status = 'pending'`).run({ requestId, ownerSessionId, optionsJson: JSON.stringify([...options, option]), updatedAt }).changes;
      if (durableQuestion && durableChanges !== 1) throw new RequestStoreError("wrong_owner", "Question Chat does not own this Question.");
      const request = this.get(requestId);
      if (!request) throw new Error("updated request could not be loaded");
      appended = { option, request };
    });

    transaction();
    if (!appended) throw new Error("proposal transaction did not produce a result");
    return appended;
  }

  answer(requestId: string, payload: AskAnswerPayload): AskResult {
    this.expireDue();
    const parsed = AskAnswerPayloadSchema.parse(payload);
    let result: AskResult | undefined;
    let available: AnswerAvailable | undefined;

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
      const question = this.db.prepare(`UPDATE questions SET status = 'answered', resolved_at = @resolvedAt, updated_at = @resolvedAt
        WHERE legacy_request_id = @requestId AND status = 'pending'
        RETURNING question_id, revision, question_json, owner_harness, owner_owner_id`)
        .get({ requestId, resolvedAt }) as { question_id: string; revision: number; question_json: string; owner_harness: string; owner_owner_id: string } | undefined;
      const answerId = randomUUID();
      const affectedDescendantIds = question ? this.openDescendantIds(question.question_id) : [];
      if (question) this.db.prepare(`INSERT INTO answers (
        answer_id, question_id, question_revision, status, selected_values_json, note, rationale, created_at
      ) VALUES (@answerId, @questionId, @revision, 'answered', @selectedValuesJson, @note, @rationale, @resolvedAt)`)
        .run({ answerId, questionId: question.question_id, revision: question.revision,
          selectedValuesJson: JSON.stringify(parsed.selectedValues), note: parsed.note ?? null, rationale: parsed.rationale ?? null, resolvedAt });
      result = {
        status: "answered",
        requestId,
        ...(question ? { questionId: question.question_id, answerId, alreadyRead: false } : {}),
        selectedValues: parsed.selectedValues,
        note: parsed.note,
        rationale: parsed.rationale,
        affectedDescendantIds,
        resolvedAt
      };
      if (question) available = {
        questionId: question.question_id,
        question: (JSON.parse(question.question_json) as { prompt: string }).prompt,
        answerId,
        ownerHarness: question.owner_harness,
        ownerId: question.owner_owner_id
      };
    });

    transaction();
    if (!result) throw new Error("answer transaction did not produce a result");
    if (available) for (const listener of [...this.answerAvailableListeners]) listener(available);
    this.notify(requestId, result);
    return result;
  }

  onAnswerAvailable(listener: AnswerAvailableListener): () => void {
    this.answerAvailableListeners.add(listener);
    return () => this.answerAvailableListeners.delete(listener);
  }

  pendingOwnerNotifications(owner: { harness: string; ownerId: string }): AnswerAvailable[] {
    const rows = this.db.prepare(`SELECT a.answer_id, q.question_id, q.question_json, q.owner_harness, q.owner_owner_id
      FROM answers a JOIN questions q ON q.question_id = a.question_id
      WHERE q.owner_harness = ? AND q.owner_owner_id = ? AND a.owner_notification_delivered_at IS NULL
      ORDER BY a.created_at ASC`).all(owner.harness, owner.ownerId) as Array<{
        answer_id: string; question_id: string; question_json: string; owner_harness: string; owner_owner_id: string
      }>;
    return rows.map((row) => ({ answerId: row.answer_id, questionId: row.question_id,
      question: (JSON.parse(row.question_json) as { prompt: string }).prompt,
      ownerHarness: row.owner_harness, ownerId: row.owner_owner_id }));
  }

  acknowledgeOwnerNotification(answerId: string, owner: { harness: string; ownerId: string }): boolean {
    return this.db.prepare(`UPDATE answers SET owner_notification_delivered_at = ? WHERE answer_id = ?
      AND owner_notification_delivered_at IS NULL AND question_id IN
      (SELECT question_id FROM questions WHERE owner_harness = ? AND owner_owner_id = ?)`)
      .run(new Date(this.now()).toISOString(), answerId, owner.harness, owner.ownerId).changes === 1;
  }

  getAnswer(questionId: string, reader: { harness: string; ownerId: string }): Record<string, unknown> {
    let output: Record<string, unknown> | undefined;
    this.db.transaction(() => {
      const question = this.db.prepare(`SELECT question_id, revision, mode, urgency, question_json, options_json, context_json,
          owner_harness, owner_owner_id, created_at, resolved_at
        FROM questions WHERE question_id = ?`).get(questionId) as {
          question_id: string; revision: number; mode: "single" | "multi"; urgency: "low" | "normal" | "high";
          question_json: string; options_json: string; context_json: string | null; owner_harness: string; owner_owner_id: string;
          created_at: string; resolved_at: string | null
        } | undefined;
      if (!question) throw new RequestStoreError("request_not_found", "Question not found");
      if (question.owner_harness !== reader.harness || question.owner_owner_id !== reader.ownerId) {
        throw new RequestStoreError("wrong_owner", "Reader does not own this Question");
      }
      const answer = this.db.prepare(`SELECT * FROM answers WHERE question_id = ? ORDER BY question_revision DESC, created_at DESC LIMIT 1`).get(questionId) as {
        answer_id: string; question_revision: number; status: "answered"; selected_values_json: string; note: string | null; rationale: string | null;
        first_reader_harness: string | null; first_reader_owner_id: string | null; first_read_at: string | null; created_at: string
      } | undefined;
      if (!answer) throw new RequestStoreError("answer_not_found", "Answer not found");
      const alreadyRead = answer.first_reader_harness !== null;
      const readAt = answer.first_read_at ?? new Date(this.now()).toISOString();
      if (!alreadyRead) this.db.prepare(`UPDATE answers SET first_reader_harness = ?, first_reader_owner_id = ?, first_read_at = ?
        WHERE answer_id = ? AND first_reader_harness IS NULL`).run(reader.harness, reader.ownerId, readAt, answer.answer_id);
      const firstReader = alreadyRead
        ? { harness: answer.first_reader_harness!, ownerId: answer.first_reader_owner_id! }
        : reader;
      output = {
        alreadyRead,
        question: {
          questionId: question.question_id, revision: question.revision, mode: question.mode, urgency: question.urgency,
          question: JSON.parse(question.question_json), options: JSON.parse(question.options_json),
          ...(question.context_json ? { context: JSON.parse(question.context_json) } : {}),
          createdAt: question.created_at, resolvedAt: question.resolved_at
        },
        answer: {
          answerId: answer.answer_id,
          questionRevision: answer.question_revision,
          status: answer.status,
          selectedValues: JSON.parse(answer.selected_values_json),
          note: answer.note ?? undefined,
          rationale: answer.rationale ?? undefined,
          createdAt: answer.created_at
        },
        firstRead: { reader: firstReader, readAt }
      };
    })();
    return output!;
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
      this.db.prepare(`UPDATE questions SET status = 'cancelled', resolved_at = @resolvedAt, updated_at = @resolvedAt
        WHERE legacy_request_id = @requestId AND status = 'pending'`).run({ requestId, resolvedAt });
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
          this.db.prepare(`UPDATE questions SET status = 'cancelled', resolved_at = @resolvedAt, updated_at = @resolvedAt
            WHERE legacy_request_id = @requestId AND status = 'pending'`).run({ requestId: row.request_id, resolvedAt: nowIso });
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
          this.db.prepare(`UPDATE questions SET status = 'expired', resolved_at = @resolvedAt, updated_at = @resolvedAt
            WHERE legacy_request_id = @requestId AND status = 'pending'`).run({ requestId: row.request_id, resolvedAt: nowIso });
          results.push({ status: "expired", requestId: row.request_id, rationale: EXPIRED_RATIONALE, resolvedAt: nowIso });
        }
      }
    });

    transaction();
    for (const result of results) this.notify(result.requestId, result);
    return results;
  }

  onAnyResolved(listener: ResolutionListener): () => void {
    this.globalResolutionListeners.add(listener);
    return () => {
      this.globalResolutionListeners.delete(listener);
    };
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
    const grouping = this.db.prepare(`SELECT q.repository_id, q.worktree_id, q.feature_id, r.remote, r.machine_id, r.common_directory,
      w.machine_id AS worktree_machine_id, w.canonical_path, f.name AS feature_name FROM questions q
      LEFT JOIN repositories r ON r.repository_id=q.repository_id LEFT JOIN worktrees w ON w.worktree_id=q.worktree_id
      LEFT JOIN features f ON f.feature_id=q.feature_id WHERE q.legacy_request_id=?`).get(row.request_id) as any;
    return {
      requestId: row.request_id,
      sessionId: row.session_id,
      mode: row.mode,
      urgency: row.urgency ?? "normal",
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
      ,parentQuestionId: row.parent_question_id ?? undefined
      ,repository: grouping?.repository_id ? { repositoryId: grouping.repository_id, remote: grouping.remote ?? undefined,
        machineId: grouping.machine_id ?? undefined, commonDirectory: grouping.common_directory ?? undefined } : undefined
      ,worktree: grouping?.worktree_id ? { worktreeId: grouping.worktree_id, machineId: grouping.worktree_machine_id, path: grouping.canonical_path } : undefined
      ,feature: grouping?.feature_id ? { featureId: grouping.feature_id, name: grouping.feature_name ?? undefined } : undefined
    };
  }

  private openDescendantIds(questionId: string): string[] {
    return (this.db.prepare(`WITH RECURSIVE descendants(question_id) AS (
      SELECT question_id FROM questions WHERE parent_question_id = ?
      UNION ALL SELECT q.question_id FROM questions q JOIN descendants d ON q.parent_question_id = d.question_id
    ) SELECT q.question_id FROM questions q JOIN descendants d ON d.question_id = q.question_id
      WHERE q.status = 'pending' ORDER BY q.created_at, q.question_id`).all(questionId) as Array<{ question_id: string }>).map((row) => row.question_id);
  }

  private parseJson(value: string | null, fallback: unknown): unknown {
    if (!value) return fallback;
    return JSON.parse(value) as unknown;
  }

  private decodeQuestionCursor(cursor: string | undefined): number {
    if (cursor === undefined) return 0;
    const match = /^question-offset:(\d+)$/.exec(cursor);
    if (!match) throw new RequestStoreError("invalid_cursor", "Question cursor is invalid");
    const offset = Number(match[1]);
    if (!Number.isSafeInteger(offset)) throw new RequestStoreError("invalid_cursor", "Question cursor is invalid");
    return offset;
  }

  private encodeQuestionCursor(offset: number): string {
    return `question-offset:${offset}`;
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
    for (const listener of [...this.globalResolutionListeners]) listener(result);
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
