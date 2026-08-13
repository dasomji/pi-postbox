import type { AskRequestSnapshot, SessionSnapshot } from "@pi-postbox/protocol";
import { describe, expect, it } from "vitest";
import { groupOpenQuestions } from "./openQuestionsQueue";

function request(requestId: string, sessionId: string, urgency: AskRequestSnapshot["urgency"], createdAt: string): AskRequestSnapshot {
  return { requestId, sessionId, mode: "single", urgency, question: { prompt: requestId },
    options: [{ value: "yes", label: "Yes" }], status: "pending", createdAt };
}

function session(sessionId: string, worktreeId: string, featureId: string): SessionSnapshot {
  return {
    sessionId, machineId: "machine-1", machineName: "Workstation", hostname: "workstation", projectId: worktreeId,
    projectName: worktreeId, cwd: `/workspace/${worktreeId}`, semanticState: "blocked", presence: "live",
    updatedAt: "2026-08-13T00:00:00.000Z",
    repository: { repositoryId: "repo-1", remote: "github.com/acme/postbox" },
    worktree: { worktreeId, machineId: "machine-1", path: `/workspace/${worktreeId}` },
    feature: { featureId, name: featureId }
  } as SessionSnapshot;
}

describe("feature queue grouping", () => {
  it("groups repository, then worktree/feature, without urgency changing group order", () => {
    const groups = groupOpenQuestions([
      request("zeta-high", "zeta-session", "high", "2026-08-13T11:00:00.000Z"),
      request("alpha-low", "alpha-session", "low", "2026-08-13T08:00:00.000Z")
    ], [session("zeta-session", "wt-zeta", "feature-zeta"), session("alpha-session", "wt-alpha", "feature-alpha")]) as any[];

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ repositoryId: "repo-1" });
    expect(groups[0].worktreeFeatures.map((group: any) => group.feature.featureId)).toEqual(["feature-alpha", "feature-zeta"]);
  });

  it("orders grouped Questions as an oldest-root parent tree", () => {
    const child = { ...request("child", "session", "high", "2026-08-13T08:00:00.000Z"), parentQuestionId: "parent" };
    const parent = request("parent", "session", "low", "2026-08-13T09:00:00.000Z");
    const olderRoot = request("older-root", "session", "high", "2026-08-13T07:00:00.000Z");
    const group = groupOpenQuestions([child, parent, olderRoot], [session("session", "wt", "feature")])[0]!;
    expect(group.questions.map((item) => item.request.requestId)).toEqual(["older-root", "parent", "child"]);
    expect(group.questionTree?.map((node) => node.request.requestId)).toEqual(["older-root", "parent"]);
  });

  it("uses persisted Question identities after its session changes feature and orders each parent tree oldest first", () => {
    const changedSession = session("session", "wt-current", "feature-new");
    const persisted = (id: string, createdAt: string, parentQuestionId?: string) => ({
      ...request(id, "session", id === "new-root" ? "high" : "low", createdAt),
      repository: { repositoryId: "repo-original", remote: "github.com/acme/postbox" },
      worktree: { worktreeId: "wt-original", machineId: "machine-1", path: "/workspace/original" },
      feature: { featureId: "feature-original", name: "Original" },
      parentQuestionId
    }) as AskRequestSnapshot;
    const groups = groupOpenQuestions([
      persisted("new-root", "2026-08-13T11:00:00.000Z"),
      persisted("child", "2026-08-13T12:00:00.000Z", "old-root"),
      persisted("old-root", "2026-08-13T08:00:00.000Z")
    ], [changedSession]) as any[];

    expect(groups[0]).toMatchObject({ repositoryId: "repo-original" });
    expect(groups[0].worktreeFeatures[0]).toMatchObject({
      worktree: { worktreeId: "wt-original" }, feature: { featureId: "feature-original" }
    });
    expect(groups[0].worktreeFeatures[0].questions.map((item: any) => item.request.requestId)).toEqual(["old-root", "child", "new-root"]);
  });
});
