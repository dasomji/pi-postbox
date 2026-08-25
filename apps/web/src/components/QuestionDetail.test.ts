import { render } from "svelte/server";
import { describe, expect, it } from "vitest";
import type { AskRequestSnapshot } from "@pi-postbox/protocol";
import QuestionDetail from "./QuestionDetail.svelte";

const REQUEST: AskRequestSnapshot = {
  requestId: "request-rich-options",
  sessionId: "session-rich-options",
  revision: 1,
  ownerRevision: 1,
  creator: { harness: "pi", ownerId: "test-owner" },
  owner: { harness: "pi", ownerId: "test-owner" },
  mode: "single",
  question: { prompt: "Which storage strategy should we use?" },
  options: [
    {
      value: "sqlite",
      label: "SQLite",
      description: "Keep the deployment self-contained.",
      impact: "Persist decisions in the same local database as sessions."
    }
  ],
  status: "pending",
  createdAt: "2026-07-17T12:00:00.000Z"
};

describe("selected Postbox Question detail", () => {
  it("shows the description and impact supplied for an answer option", () => {
    const { body } = render(QuestionDetail, { props: { request: REQUEST, isMock: true } });

    expect(body).toContain("Keep the deployment self-contained.");
    expect(body).toContain("Impact: Persist decisions in the same local database as sessions.");
  });

  it("does not show empty metadata rows when an answer option has no rich metadata", () => {
    const request: AskRequestSnapshot = {
      ...REQUEST,
      requestId: "request-plain-option",
      options: [{ value: "sqlite", label: "SQLite" }]
    };

    const { body } = render(QuestionDetail, { props: { request, isMock: true } });

    expect(body).not.toContain("Impact:");
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

  it("renders native radio controls for single-choice Questions", () => {
    const { body } = render(QuestionDetail, { props: { request: REQUEST, isMock: true } });

    expect(body).toContain('type="radio"');
    expect(body).not.toContain('type="checkbox"');
  });

  it("renders rounded checkbox controls for multi-choice Questions", () => {
    const request = { ...REQUEST, mode: "multi" as const };
    const { body } = render(QuestionDetail, { props: { request, isMock: true } });

    expect(body).toContain('type="checkbox"');
    expect(body).not.toContain('type="radio"');
    expect(body).toContain("rounded-[4px]");
  });

  it("keeps a child answerable while linking to its nearest unanswered ancestor", () => {
    const child = { ...REQUEST, requestId: "question-child", parentQuestionId: "question-root" } as AskRequestSnapshot;
    const ancestor = { ...REQUEST, requestId: "question-root", question: { prompt: "Choose the overall rollout?" } };
    const { body } = render(QuestionDetail, { props: { request: child, unansweredAncestors: [ancestor], isMock: true } as any });

    expect(body).toMatch(/unanswered ancestor/i);
    expect(body).toContain("Choose the overall rollout?");
    expect(body).toContain("question-root");
    expect(body).toContain("type=\"submit\"");
    expect(body).not.toContain("disabled");
  });

  it("links the direct unanswered parent when multiple ancestors remain open", () => {
    const direct = { ...REQUEST, requestId: "direct-parent", question: { prompt: "Direct parent?" } };
    const root = { ...REQUEST, requestId: "root-parent", question: { prompt: "Root parent?" } };
    const child = { ...REQUEST, requestId: "child", parentQuestionId: direct.requestId };
    const { body } = render(QuestionDetail, { props: { request: child, unansweredAncestors: [direct, root], isMock: true } as any });
    expect(body).toContain("Direct parent?");
    expect(body).not.toContain("Root parent?");
    expect(body).toContain("question=direct-parent");
  });

  it("disables an obsolete revision, discloses meaningful changes, and offers refresh to latest content", () => {
    const latest = { ...REQUEST, revision: 3, question: { prompt: "Updated storage strategy?" } } as AskRequestSnapshot;
    const obsolete = { ...REQUEST, revision: 2 } as AskRequestSnapshot;
    const { body } = render(QuestionDetail, { props: { request: obsolete, latestRequest: latest,
      revisionChanges: ["Question text changed", "One option was removed"], isMock: true } as any });
    expect(body).toMatch(/newer revision|obsolete revision/i);
    expect(body).toContain("Question text changed");
    expect(body).toContain("One option was removed");
    expect(body).toMatch(/refresh.*latest/i);
    expect(body).toContain("disabled");
  });
});
