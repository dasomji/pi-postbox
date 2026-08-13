import { describe, expect, it } from "vitest";
import {
  HarnessLineageSchema,
  OwnerIdentitySchema,
  ownerIdentityKey
} from "./ownerIdentity.js";

describe("harness-neutral owner identity", () => {
  it.each([
    ["pi", "550e8400-e29b-41d4-a716-446655440000"],
    ["codex", "01912345-aaaa-7bbb-8ccc-0123456789ab"],
    ["claude-code", "agent_01JABC"]
  ] as const)("keeps the %s addressable execution ID distinct from control-session metadata", (harness, ownerId) => {
    expect(OwnerIdentitySchema.parse({ harness, ownerId })).toEqual({ harness, ownerId });
    expect(() => OwnerIdentitySchema.parse({ harness, ownerId, sessionId: "broader-control-session" })).toThrow();
  });

  it("distinguishes sibling owners that share a broader harness session", () => {
    const left = OwnerIdentitySchema.parse({ harness: "claude-code", ownerId: "agent-left" });
    const right = OwnerIdentitySchema.parse({ harness: "claude-code", ownerId: "agent-right" });

    expect(ownerIdentityKey(left)).not.toBe(ownerIdentityKey(right));
    expect(HarnessLineageSchema.parse({ harnessSessionId: "shared-control-session" })).toEqual({
      harnessSessionId: "shared-control-session"
    });
  });

  it("keeps lineage descriptive and excludes authority-bearing owner identity", () => {
    const lineage = HarnessLineageSchema.parse({
      parentOwnerId: "agent-parent",
      rootOwnerId: "agent-root",
      harnessSessionId: "shared-control-session",
      depth: 2,
      path: "/root/worker",
      taskLabel: "red tests"
    });

    expect(lineage).not.toHaveProperty("harness");
    expect(lineage).not.toHaveProperty("ownerId");
    expect(() => HarnessLineageSchema.parse({ ...lineage, ownerId: "agent-attacker" })).toThrow();
  });
});
