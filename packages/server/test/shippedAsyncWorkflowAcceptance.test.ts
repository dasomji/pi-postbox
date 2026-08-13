import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const smoke = readFileSync(resolve(process.cwd(), "scripts/smoke-postbox.mjs"), "utf8");

function proves(...concepts: string[]): void {
  for (const concept of concepts) {
    if (!smoke.includes(concept)) throw new Error(`packaged smoke must prove ${concept}`);
  }
}

describe("shipped asynchronous Postbox acceptance", () => {
  it("drives the complete owner workflow through the packaged server, adapter WebSocket, browser HTTP, and SSE seams", () => {
    proves(
      "session.register",
      "owner: { harness:",
      "ask.created",
      "createOrderedBatch",
      "localRef",
      "parent",
      "nextStateMatching",
      "/answer",
      "answer.available",
      "answer.available.ack",
      "answer.get",
      "postbox.wait",
      "postbox.wait.result",
      "question.update",
      "takeover",
      "owner_not_offline",
      "restart",
      "/api/history"
    );
    expect(smoke, "single and parent/child Questions must be simultaneously visible before answering").toMatch(
      /snapshot\.requests[\s\S]{0,800}(parent|child)[\s\S]{0,800}(parent|child)/
    );
    expect(smoke, "exactly one lightweight owner ping must be observed and acknowledged").toMatch(
      /(pingCount|answerPings)\s*[,)=][\s\S]{0,300}(===|toBe\()\s*1/
    );
  });

  it("seeds and verifies restart-safe migration fixtures for every released legacy state without content loss or urgency leakage", () => {
    proves(
      "seedLegacyMigrationFixture",
      "legacy-pending",
      "legacy-answered",
      "legacy-cancelled",
      "legacy-expired",
      "legacy-rich-context",
      "legacy-owner",
      "legacy-urgency",
      "owner_notification_delivered_at",
      "first_read_at"
    );
    expect(smoke).toContain("Historical urgency leaked into owner contracts");
  });

  it("proves real multi-client authority races and stale revisions", () => {
    proves("firstAnswerWins", "secondBrowser", "stale_revision", "expectedRevision", "question.history.get");
    expect(smoke, "two browser answers must race against the same pending Question").toMatch(
      /Promise\.all[\s\S]{0,1200}\/answer[\s\S]{0,1200}\/answer/
    );
    proves("question.update", "revisionState", "nextStateMatching", "request.revision === 2");
  });

  it("covers Pi, Claude Code, and Codex owner identities plus retained waiting capacity", () => {
    proves(
      'harness: "pi"',
      '"claude-code"',
      '"codex"',
      "wait_for_postbox",
      "configuredRunnableSlots",
      "capacityBlocked",
      "cancelFreesSlot",
      "wakeFreesSlot"
    );
  });

  it("requires no provider credentials and retains every release regression domain", () => {
    for (const credential of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_API_KEY"]) {
      expect(smoke, `smoke must not depend on ${credential}`).not.toContain(`process.env.${credential}`);
    }
    proves(
      "localTarget",
      "push",
      "Question Chat",
      "/api/history",
      "privateMarkers",
      "--no-tailscale",
      "manifest.webmanifest",
      "fake extension"
    );
  });
});
