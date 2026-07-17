import type { AskRequestSnapshot, SessionSnapshot } from "@pi-postbox/protocol";
import { describe, expect, it } from "vitest";
import { groupOpenQuestions } from "./openQuestionsQueue";

function request(requestId: string, sessionId: string, urgency: AskRequestSnapshot["urgency"], createdAt: string): AskRequestSnapshot {
  return {
    requestId,
    sessionId,
    mode: "single",
    urgency,
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
  it("orders projects by their most urgent pending question before project name", () => {
    const groups = groupOpenQuestions(
      [
        request("alpha-low", "alpha-session", "low", "2026-06-24T08:00:00.000Z"),
        request("zeta-high", "zeta-session", "high", "2026-06-24T11:00:00.000Z")
      ],
      [session("alpha-session", "alpha", "Alpha"), session("zeta-session", "zeta", "Zeta")]
    );

    expect(groups.map((group) => group.projectName)).toEqual(["Zeta", "Alpha"]);
  });
});
