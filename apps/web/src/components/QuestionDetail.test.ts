import { render } from "svelte/server";
import { describe, expect, it } from "vitest";
import type { AskRequestSnapshot } from "@pi-postbox/protocol";
import QuestionDetail from "./QuestionDetail.svelte";

const REQUEST: AskRequestSnapshot = {
  requestId: "request-rich-options",
  sessionId: "session-rich-options",
  mode: "single",
  urgency: "normal",
  question: { prompt: "Which storage strategy should we use?" },
  options: [
    {
      value: "sqlite",
      label: "SQLite",
      description: "Keep the deployment self-contained.",
      meaning: "Persist decisions in the same local database as sessions.",
      context: "This avoids introducing a second service for a single-user deployment."
    }
  ],
  status: "pending",
  createdAt: "2026-07-17T12:00:00.000Z"
};

describe("selected Postbox Question detail", () => {
  it("shows the description, meaning, and context supplied for an answer option", () => {
    const { body } = render(QuestionDetail, { props: { request: REQUEST, isMock: true } });

    expect(body).toContain("Keep the deployment self-contained.");
    expect(body).toContain("Meaning: Persist decisions in the same local database as sessions.");
    expect(body).toContain("Context: This avoids introducing a second service for a single-user deployment.");
  });

  it("does not show empty metadata rows when an answer option has no rich metadata", () => {
    const request: AskRequestSnapshot = {
      ...REQUEST,
      requestId: "request-plain-option",
      options: [{ value: "sqlite", label: "SQLite" }]
    };

    const { body } = render(QuestionDetail, { props: { request, isMock: true } });

    expect(body).not.toContain("Meaning:");
    expect(body).not.toContain("Context:");
  });

  it("badges an authoritative Chat suggestion in the ordinary chronological option list", () => {
    const request: AskRequestSnapshot = {
      ...REQUEST,
      options: [
        ...REQUEST.options,
        { value: "chat_opaque", label: "Stage first", provenance: "chat" }
      ]
    };

    const { body } = render(QuestionDetail, { props: { request, isMock: true } });
    expect(body.indexOf("SQLite")).toBeLessThan(body.indexOf("Stage first"));
    expect(body).toContain("Suggested in Chat");
  });
});
