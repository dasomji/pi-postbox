import { describe, expect, it } from "vitest";
import { AskCreatePayloadSchema } from "./ask.js";
import { SessionRegisterPayloadSchema } from "./session.js";
import * as protocol from "./index.js";

const repository = { repositoryId: "repo-1", remote: "github.com/acme/postbox" };
const worktree = { worktreeId: "worktree-1", machineId: "machine-1", path: "/workspace/postbox" };
const feature = { featureId: "feature-1", name: "async-postbox" };

describe("repository, worktree, and feature identity contracts", () => {
  it("retains all three independent identities during session registration", () => {
    const parsed = SessionRegisterPayloadSchema.parse({
      machine: { machineId: "machine-1", hostname: "workstation" },
      project: { projectId: "project-1", name: "postbox", cwd: "/workspace/postbox" },
      session: {
        sessionId: "session-1",
        cwd: "/workspace/postbox",
        semanticState: "working",
        repository,
        worktree,
        feature
      }
    }) as Record<string, any>;

    expect(parsed.session).toMatchObject({ repository, worktree, feature });
  });

  it("records identities on the Question independently of creator and owner", () => {
    const parsed = AskCreatePayloadSchema.parse({
      requestId: "question-1",
      sessionId: "session-1",
      mode: "single",
      question: { prompt: "Which path?" },
      options: [{ value: "a", label: "A" }],
      context: { codebaseContext: "Postbox", problemContext: "Choose a path" },
      repository,
      worktree,
      feature
    }) as Record<string, any>;

    expect(parsed).toMatchObject({ repository, worktree, feature });
    expect(parsed.repository).not.toHaveProperty("ownerId");
    expect(parsed.feature).not.toHaveProperty("creator");
  });

  it("defines strict explicit start, select, and cross-worktree inherit actions", () => {
    const schema = (protocol as Record<string, any>).FeatureActionSchema;
    expect(schema).toBeDefined();
    expect(schema.parse({ action: "start", name: "New feature" })).toEqual({ action: "start", name: "New feature" });
    expect(schema.parse({ action: "select", featureId: "feature-2" })).toEqual({ action: "select", featureId: "feature-2" });
    expect(schema.parse({ action: "inherit", featureId: "feature-1" })).toEqual({ action: "inherit", featureId: "feature-1" });
    expect(schema.safeParse({ action: "infer", branch: "feature/maybe" }).success).toBe(false);
  });
});
