import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPostboxDatabase } from "../src/db/database.js";
import { RequestStore } from "../src/services/requestStore.js";
import { SessionStore } from "../src/services/sessionStore.js";

describe("owner Question/Answer source of truth", () => {
  it("creates, answers, and derives compatibility snapshots without writing ask_requests", () => {
    const db = openPostboxDatabase(":memory:");
    const sessions = new SessionStore(db, () => 1_000, {});
    sessions.register("connection", {
      machine: { machineId: "machine", hostname: "host" },
      project: { projectId: "project", name: "repo", cwd: "/repo" },
      session: { sessionId: "session", cwd: "/repo", semanticState: "working",
        owner: { harness: "pi", ownerId: "owner" } }
    });
    const telemetry: Array<Record<string, unknown>> = [];
    const store = new RequestStore(db, () => 2_000, { recordTelemetry: (event) => telemetry.push(event) });
    store.create({ requestId: "question", sessionId: "session", mode: "single",
      question: { prompt: "Ship?", context: "question context", relevance: "relevant", decisionImpact: "impact" },
      options: [{ value: "yes", label: "Yes", description: "description", meaning: "meaning", context: "option context" }],
      context: { codebaseContext: "code", problemContext: "problem" }, expiresAt: "2026-08-14T00:00:00.000Z" });
    expect(db.prepare("SELECT count(*) count FROM ask_requests").get()).toEqual({ count: 0 });
    expect(store.get("question")).toMatchObject({ requestId: "question", sessionId: "session", status: "pending" });
    store.answer("question", { expectedRevision: 1, selectedValues: ["yes"], note: "n", rationale: "why" });
    expect(store.get("question")).toMatchObject({ status: "answered", result: { selectedValues: ["yes"], note: "n", rationale: "why" } });
    expect(db.prepare("SELECT count(*) count FROM answers WHERE question_id='question'").get()).toEqual({ count: 1 });
    expect(telemetry).toContainEqual(expect.objectContaining({ operation: "question.create", questionContextLength: 16,
      relevanceLength: 8, decisionImpactLength: 6, optionDescriptionLength: 11, optionMeaningLength: 7,
      optionContextLength: 14, requestSerializedBytes: expect.any(Number) }));
    expect(telemetry).toContainEqual(expect.objectContaining({ operation: "answer.create", noteLength: 1,
      rationaleLength: 3, selectedIdCount: 1, answerResponseBytes: expect.any(Number) }));
    expect(JSON.stringify(telemetry)).not.toContain("Ship?");
    store.close(); sessions.close(); db.close();
  });

  it("preserves explicit twelve-hour expiry, clears only provenance-marked defaults, and repairs partial Answer migration", () => {
    const root = mkdtempSync(join(tmpdir(), "postbox-owner-migration-"));
    const path = join(root, "postbox.sqlite");
    let db = openPostboxDatabase(path);
    const sessions = new SessionStore(db, () => Date.parse("2026-01-01T00:00:00.000Z"), {});
    sessions.register("connection", { machine: { machineId: "m", hostname: "h" },
      project: { projectId: "p", name: "p", cwd: "/p" },
      session: { sessionId: "legacy-session", cwd: "/p", semanticState: "idle" } });
    const insert = db.prepare(`INSERT INTO ask_requests (request_id,session_id,mode,prompt,options_json,status,
      selected_values_json,created_at,expires_at,expiry_provenance,resolved_at,updated_at)
      VALUES (?,?, 'single', ?, '[{"value":"yes","label":"Yes"}]', ?, ?, ?, ?, ?, ?, ?)`);
    const created = "2026-01-01T00:00:00.000Z";
    const twelveHours = "2026-01-01T12:00:00.000Z";
    insert.run("explicit", "legacy-session", "Explicit?", "pending", null, created, twelveHours, null, null, created);
    insert.run("default", "legacy-session", "Default?", "pending", null, created, twelveHours, "manufactured_default", null, created);
    insert.run("answered", "legacy-session", "Answered?", "answered", '["yes"]', created, null, null,
      "2026-01-01T00:01:00.000Z", "2026-01-01T00:01:00.000Z");
    sessions.close(); db.close();

    db = openPostboxDatabase(path);
    expect(db.prepare("SELECT question_id,expires_at FROM questions WHERE question_id IN ('explicit','default') ORDER BY question_id").all())
      .toEqual([{ question_id: "default", expires_at: null }, { question_id: "explicit", expires_at: twelveHours }]);
    db.prepare("UPDATE answers SET first_reader_harness=NULL,first_reader_owner_id=NULL,first_read_at=NULL,owner_notification_delivered_at=NULL WHERE question_id='answered'").run();
    db.prepare(`UPDATE ask_requests SET fork_reference_json='{"leafId":"legacy-leaf"}' WHERE request_id='answered'`).run();
    db.prepare(`UPDATE questions SET legacy_request_id=NULL,source_session_id=NULL,fork_reference_json=NULL,
      question_json='{}',options_json='[]',status='pending',resolved_at=NULL WHERE question_id='answered'`).run();
    db.prepare(`UPDATE question_revisions SET question_json='{}',options_json='[]' WHERE question_id='answered'`).run();
    db.prepare(`UPDATE questions SET legacy_request_id=NULL,source_session_id=NULL,
      question_json='{"prompt":"Newer intentional wording"}',options_json='[{"value":"keep","label":"Keep"}]',
      updated_at='2026-02-01T00:00:00.000Z' WHERE question_id='explicit'`).run();
    // A previously interrupted mirror may already contain the manufactured
    // timestamp but not its provenance. The resumed migration must clear it.
    db.prepare("UPDATE questions SET expires_at=?,expiry_provenance=NULL WHERE question_id='default'").run(twelveHours);
    db.close();

    db = openPostboxDatabase(path);
    expect(db.prepare(`SELECT first_reader_harness,first_reader_owner_id,first_read_at,owner_notification_delivered_at
      FROM answers WHERE question_id='answered'`).get()).toEqual({ first_reader_harness: "legacy",
        first_reader_owner_id: "legacy-session", first_read_at: "2026-01-01T00:01:00.000Z",
        owner_notification_delivered_at: "2026-01-01T00:01:00.000Z" });
    expect(db.prepare("SELECT count(*) count FROM answers WHERE question_id='answered'").get()).toEqual({ count: 1 });
    expect(db.prepare(`SELECT legacy_request_id,source_session_id,fork_reference_json,question_json,options_json,status,resolved_at
      FROM questions WHERE question_id='answered'`).get()).toEqual({ legacy_request_id: "answered",
        source_session_id: "legacy-session", fork_reference_json: '{"leafId":"legacy-leaf"}',
        question_json: '{"prompt":"Answered?"}', options_json: '[{"value":"yes","label":"Yes"}]', status: "answered",
        resolved_at: "2026-01-01T00:01:00.000Z" });
    expect(db.prepare("SELECT facts_json FROM migration_ledger WHERE migration_key='owner-contract-v1-expiry'").get())
      .toEqual({ facts_json: '{"unknownLegacyExpiry":"preserved","clearOnly":"manufactured_default"}' });
    expect(db.prepare("SELECT legacy_request_id,source_session_id,question_json,options_json FROM questions WHERE question_id='explicit'").get())
      .toEqual({ legacy_request_id: "explicit", source_session_id: "legacy-session",
        question_json: '{"prompt":"Newer intentional wording"}', options_json: '[{"value":"keep","label":"Keep"}]' });
    expect(db.prepare("SELECT expires_at,expiry_provenance FROM questions WHERE question_id='default'").get())
      .toEqual({ expires_at: null, expiry_provenance: "manufactured_default" });
    db.close(); rmSync(root, { recursive: true, force: true });
  });
});
