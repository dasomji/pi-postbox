/**
 * Sample question + session used by the mock-question toggle so the open-question
 * UI can be exercised when no real Pi question is pending. Deliberately rich:
 * every current metadata surface (ambiguity, option details, and fork
 * reference) is populated so the layout variations have something to hide/show.
 */
import type { AskRequestSnapshot, SessionSnapshot } from "@pi-postbox/protocol";

const createdAt = new Date(Date.now() - 1000 * 60 * 4).toISOString();

export const mockRequest: AskRequestSnapshot = {
  requestId: "mock-request",
  sessionId: "mock-session",
  revision: 1,
  ownerRevision: 1,
  creator: { harness: "pi", ownerId: "mock-owner" },
  owner: { harness: "pi", ownerId: "mock-owner" },
  mode: "single",
  status: "pending",
  createdAt,
  question: {
    prompt: "How should we store the per-session draft answers?",
    ambiguity:
      "Should draft persistence optimize for the smallest synchronous implementation or for a larger asynchronous storage model?"
  },
  options: [
    {
      value: "localstorage",
      label: "localStorage, keyed by request id",
      description: "Synchronous, trivial to implement, survives reloads on the same device.",
      impact: "Ship the smallest change that solves the reported data loss; ~5 lines in the form factory, with no schema or migration."
    },
    {
      value: "indexeddb",
      label: "IndexedDB via a small wrapper",
      description: "Room for larger drafts and structured history, at the cost of async reads everywhere.",
      impact: "Invest now in storage we will not outgrow, adding an async boundary to every draft read/write and a wrapper to maintain."
    },
    {
      value: "server",
      label: "Persist drafts to the server",
      description: "Drafts follow the reviewer across devices, but every keystroke becomes a network concern.",
      impact: "Treat drafts as first-class, multi-device state; this needs a new endpoint, debounce, and conflict handling."
    }
  ],
  forkReference: {
    agentSessionId: "mock-agent-session",
    leafId: "leaf-7f3a",
    cwd: "/home/dev/Development/Harnesssssing/dashboard",
    model: "claude-opus-4-8"
  }
};

export const mockSession: SessionSnapshot = {
  sessionId: "mock-session",
  title: "Draft persistence",
  machineId: "mock-machine",
  machineName: "workshop",
  hostname: "workshop.local",
  projectId: "mock-project",
  projectName: "Pi Postbox",
  cwd: "/home/dev/Development/Harnesssssing/dashboard",
  branch: "main",
  semanticState: "blocked",
  presence: "live",
  updatedAt: createdAt
};
