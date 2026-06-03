import { describe, expect, it } from "vitest";
import {
  ExtensionClientMessageSchema,
  SessionRegisterPayloadSchema,
  StateSnapshotSchema
} from "./index.js";

const registration = {
  machine: { machineId: "machine-1", hostname: "workstation" },
  project: {
    projectId: "project-1",
    name: "pi-postbox",
    cwd: "/repo",
    branch: "main",
    worktreePath: "/repo"
  },
  session: {
    sessionId: "session-1",
    title: "Build presence",
    cwd: "/repo",
    branch: "main",
    semanticState: "working"
  }
};

describe("session registration protocol", () => {
  it("validates extension session registration messages", () => {
    expect(
      ExtensionClientMessageSchema.parse({
        type: "session.register",
        requestId: "req-1",
        payload: registration
      })
    ).toMatchObject({ type: "session.register", payload: { session: { sessionId: "session-1" } } });
  });

  it("rejects registration messages without machine identity", () => {
    expect(() => SessionRegisterPayloadSchema.parse({ ...registration, machine: { hostname: "workstation" } })).toThrow();
  });

  it("validates state snapshots exposed to the browser", () => {
    const timestamp = new Date(0).toISOString();

    expect(
      StateSnapshotSchema.parse({
        timestamp,
        sessions: [
          {
            sessionId: "session-1",
            title: "Build presence",
            machineId: "machine-1",
            machineName: "workstation",
            hostname: "workstation",
            projectId: "project-1",
            projectName: "pi-postbox",
            cwd: "/repo",
            branch: "main",
            worktreePath: "/repo",
            semanticState: "working",
            presence: "live",
            lastHeartbeatAt: timestamp,
            connectedAt: timestamp,
            updatedAt: timestamp
          }
        ]
      }).sessions[0]?.presence
    ).toBe("live");
  });
});
