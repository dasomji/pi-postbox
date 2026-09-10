import type { AskRequestSnapshot, SessionSnapshot } from "@pi-postbox/protocol";
import { describe, expect, it } from "vitest";
import { groupOpenQuestions } from "./openQuestionsQueue";

function request(requestId: string, sessionId: string, createdAt: string): AskRequestSnapshot {
  return {
    requestId,
    sessionId,
    revision: 1,
    ownerRevision: 1,
    creator: { harness: "pi", ownerId: "test-owner" },
    owner: { harness: "pi", ownerId: "test-owner" },
    images: [],
      mode: "single",
    question: { prompt: `Resolve ${requestId}?` },
    options: [{ value: "yes", label: "Yes" }],
    status: "pending",
    createdAt
  };
}

function session(sessionId: string, projectId: string, projectName: string): SessionSnapshot {
  return {
    sessionId,
    machineId: "machine-1",
    machineName: "Workstation",
    hostname: "workstation.local",
    projectId,
    projectName,
    cwd: `/workspace/${projectId}`,
    semanticState: "blocked",
    presence: "live",
    updatedAt: "2026-06-24T12:00:00.000Z"
  };
}

describe("open questions queue groups", () => {
  it("orders projects by their oldest pending question", () => {
    const groups = groupOpenQuestions(
      [
        request("alpha-old", "alpha-session", "2026-06-24T08:00:00.000Z"),
        request("zeta-new", "zeta-session", "2026-06-24T11:00:00.000Z")
      ],
      [session("alpha-session", "alpha", "Alpha"), session("zeta-session", "zeta", "Zeta")]
    );

    expect(groups.map((group) => group.projectName)).toEqual(["Alpha", "Zeta"]);
  });
});
