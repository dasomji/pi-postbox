import type { AskRequestSnapshot, SessionSnapshot } from "@pi-postbox/protocol";
import { describe, expect, it } from "vitest";
import { groupOpenQuestions } from "./openQuestionsQueue";

const request = (requestId: string, createdAt: string, parentQuestionId?: string) => ({
  requestId, sessionId: "session", mode: "single", urgency: "normal",
  question: { prompt: `Resolve ${requestId}?` }, options: [{ value: "yes", label: "Yes" }], status: "pending", createdAt,
  parentQuestionId
}) as AskRequestSnapshot;

const session = {
  sessionId: "session", machineId: "machine", machineName: "Workstation", hostname: "host", projectId: "project",
  projectName: "Postbox", cwd: "/repo", semanticState: "blocked", presence: "live", updatedAt: "2026-08-13T12:00:00.000Z"
} as SessionSnapshot;

describe("dashboard Question hierarchy", () => {
  it("builds a primary-parent tree with oldest roots first while retaining every pending child", () => {
    const [group] = groupOpenQuestions([
      request("root-new", "2026-08-13T11:00:00.000Z"), request("grandchild", "2026-08-13T13:00:00.000Z", "child"),
      request("child", "2026-08-13T12:00:00.000Z", "root-old"), request("root-old", "2026-08-13T08:00:00.000Z")
    ], [session]);
    const tree = (group as any).questionTree;
    expect(tree.map((node: any) => node.request.requestId)).toEqual(["root-old", "root-new"]);
    expect(tree[0].children[0].request.requestId).toBe("child");
    expect(tree[0].children[0].children[0].request.requestId).toBe("grandchild");
    expect(tree.flatMap((node: any) => [node, ...node.children, ...node.children.flatMap((child: any) => child.children)])).toHaveLength(4);
  });
});
