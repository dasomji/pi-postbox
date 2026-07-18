import type { AskCreatePayload, ProposeAnswerPayload } from "@pi-postbox/protocol";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openPostboxDatabase, type SqliteDatabase } from "../src/db/database.js";
import { RequestStore, RequestStoreError } from "../src/services/requestStore.js";
import { SessionStore } from "../src/services/sessionStore.js";

const CONTEXT = {
  codebaseContext: "Fastify server backed by SQLite.",
  problemContext: "Offer one more answer without resolving the Question."
};

function ask(requestId: string, options: AskCreatePayload["options"] = [{ value: "ship", label: "Ship now" }]): AskCreatePayload {
  return {
    requestId,
    sessionId: "session-owner",
    mode: "single",
    question: { prompt: "Which release path?" },
    options,
    context: CONTEXT
  };
}

function proposal(label: string): ProposeAnswerPayload {
  return {
    label,
    description: "Deploy to a limited cohort.",
    meaning: "A reversible rollout.",
    context: "The pipeline supports staged deployments."
  };
}

describe("RequestStore Chat-proposed options", () => {
  let db: SqliteDatabase;
  let sessions: SessionStore;

  beforeEach(() => {
    db = openPostboxDatabase(":memory:");
    sessions = new SessionStore(db, () => 1_000, { staleAfterMs: 30_000, offlineAfterMs: 60_000 });
    sessions.register("connection-owner", {
      machine: { machineId: "machine-1", hostname: "workstation" },
      project: { projectId: "project-1", name: "postbox", cwd: "/repo" },
      session: { sessionId: "session-owner", cwd: "/repo", semanticState: "waiting_for_user" }
    });
  });

  afterEach(() => {
    sessions.close();
    db.close();
  });

  it("atomically appends an authoritative, answerable option without persisting Chat internals", () => {
    const store = new RequestStore(db, () => 2_000, { generateProposedOptionValue: () => "chat_opaque_1" });
    store.create(ask("ask-success"));
    db.prepare("UPDATE ask_requests SET note = ?, rationale = ? WHERE request_id = ?")
      .run("draft-note", "draft-rationale", "ask-success");

    const appended = store.proposeAnswer("ask-success", "session-owner", proposal("Stage first"));

    expect(appended.option).toEqual({
      value: "chat_opaque_1",
      label: "Stage first",
      description: "Deploy to a limited cohort.",
      meaning: "A reversible rollout.",
      context: "The pipeline supports staged deployments.",
      provenance: "chat"
    });
    expect(appended.request.options).toEqual([
      { value: "ship", label: "Ship now" },
      appended.option
    ]);
    const row = db.prepare("SELECT options_json, note, rationale FROM ask_requests WHERE request_id = ?")
      .get("ask-success") as { options_json: string; note: string; rationale: string };
    expect(JSON.parse(row.options_json)).toEqual(appended.request.options);
    expect(row).toMatchObject({ note: "draft-note", rationale: "draft-rationale" });
    expect(row.options_json).not.toContain("toolCall");
    expect(row.options_json).not.toContain("transcript");

    expect(store.answer("ask-success", { selectedValues: [appended.option.value] })).toMatchObject({
      status: "answered",
      selectedValues: ["chat_opaque_1"]
    });
    expect(store.get("ask-success")?.options[1]).toEqual(appended.option);
  });

  it("keeps an appended proposal authoritative after closing and reopening file-backed SQLite", () => {
    const root = mkdtempSync(join(tmpdir(), "postbox-proposal-reopen-"));
    const databasePath = join(root, "postbox.sqlite");
    let fileDb = openPostboxDatabase(databasePath);
    let fileSessions = new SessionStore(fileDb, () => 1_000, { staleAfterMs: 30_000, offlineAfterMs: 60_000 });
    try {
      fileSessions.register("connection-owner", {
        machine: { machineId: "machine-1", hostname: "workstation" },
        project: { projectId: "project-1", name: "postbox", cwd: "/repo" },
        session: { sessionId: "session-owner", cwd: "/repo", semanticState: "waiting_for_user" }
      });
      const firstStore = new RequestStore(fileDb, () => 2_000, {
        generateProposedOptionValue: () => "chat_durable"
      });
      firstStore.create(ask("ask-durable"));
      const appended = firstStore.proposeAnswer("ask-durable", "session-owner", proposal("Stage first"));
      firstStore.close();
      fileSessions.close();
      fileDb.close();

      fileDb = openPostboxDatabase(databasePath);
      fileSessions = new SessionStore(fileDb, () => 3_000, { staleAfterMs: 30_000, offlineAfterMs: 60_000 });
      const reopenedStore = new RequestStore(fileDb, () => 3_000);
      expect(reopenedStore.get("ask-durable")?.options).toEqual([
        { value: "ship", label: "Ship now" },
        appended.option
      ]);
      expect(reopenedStore.answer("ask-durable", { selectedValues: ["chat_durable"] })).toMatchObject({
        status: "answered",
        selectedValues: ["chat_durable"]
      });
      reopenedStore.close();
    } finally {
      fileSessions.close();
      fileDb.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    "  stage   FIRST  ",
    "Ｓｔａｇｅ　Ｆｉｒｓｔ",
    "stage first"
  ])("rejects a normalized duplicate label: %s", (duplicate) => {
    const store = new RequestStore(db, () => 2_000, { generateProposedOptionValue: () => "chat_unique" });
    store.create(ask(`ask-duplicate-${duplicate.length}`, [{ value: "stage", label: "Stage First" }]));

    expect(() => store.proposeAnswer(`ask-duplicate-${duplicate.length}`, "session-owner", { label: duplicate }))
      .toThrowError(expect.objectContaining({ code: "duplicate_option" }));
  });

  it("retries generated value collisions and succeeds with the first unique opaque value", () => {
    const generate = vi.fn()
      .mockReturnValueOnce("ship")
      .mockReturnValueOnce("other")
      .mockReturnValueOnce("chat_unique");
    const store = new RequestStore(db, () => 2_000, { generateProposedOptionValue: generate });
    store.create(ask("ask-retry"));

    expect(store.proposeAnswer("ask-retry", "session-owner", { label: "Stage first" }).option.value).toBe("chat_unique");
    expect(generate).toHaveBeenCalledTimes(3);
  });

  it("returns a typed collision after bounded generated-value retries are exhausted", () => {
    const generate = vi.fn(() => "ship");
    const store = new RequestStore(db, () => 2_000, { generateProposedOptionValue: generate });
    store.create(ask("ask-collision"));

    expect(() => store.proposeAnswer("ask-collision", "session-owner", { label: "Stage first" }))
      .toThrowError(expect.objectContaining({ code: "option_value_collision" }));
    expect(generate.mock.calls.length).toBeGreaterThan(1);
    expect(generate.mock.calls.length).toBeLessThanOrEqual(5);
    expect(store.get("ask-collision")?.options).toHaveLength(1);
  });

  it("returns bounded typed errors for invalid, wrong-owner, terminal, and option-limit proposals", () => {
    const store = new RequestStore(db, () => 2_000, { generateProposedOptionValue: () => "chat_unique" });
    store.create(ask("ask-errors"));
    expect(() => store.proposeAnswer("ask-errors", "session-owner", { label: "" }))
      .toThrowError(expect.objectContaining({ code: "invalid_proposal" }));
    expect(() => store.proposeAnswer("ask-errors", "session-attacker", { label: "Stage first" }))
      .toThrowError(expect.objectContaining({ code: "wrong_owner" }));

    store.answer("ask-errors", { selectedValues: ["ship"] });
    expect(() => store.proposeAnswer("ask-errors", "session-owner", { label: "Stage first" }))
      .toThrowError(expect.objectContaining({ code: "request_terminal" }));

    store.create(ask("ask-limit", Array.from({ length: 20 }, (_, index) => ({ value: `v-${index}`, label: `Option ${index}` }))));
    expect(() => store.proposeAnswer("ask-limit", "session-owner", { label: "One too many" }))
      .toThrowError(expect.objectContaining({ code: "option_limit_reached" }));
    expect(store.get("ask-limit")?.options).toHaveLength(20);
  });

  it("distinguishes a missing request from a terminal request", () => {
    const store = new RequestStore(db, () => 2_000);
    let error: unknown;
    try {
      store.proposeAnswer("missing", "session-owner", { label: "Stage first" });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(RequestStoreError);
    expect(error).toMatchObject({ code: "request_not_found", message: "Question not found." });
  });
});
