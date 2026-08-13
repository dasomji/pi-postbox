/**
 * Sample question + session used by the mock-question toggle so the open-question
 * UI can be exercised when no real Pi question is pending. Deliberately rich:
 * every contextual surface (question context, handoff context, code, fork
 * reference) is populated so the layout variations have something to hide/show.
 */
import type { AskRequestSnapshot, SessionSnapshot } from "@pi-postbox/protocol";

const createdAt = new Date(Date.now() - 1000 * 60 * 4).toISOString();

export const mockRequest: AskRequestSnapshot = {
  requestId: "mock-request",
  sessionId: "mock-session",
  mode: "single",
  status: "pending",
  createdAt,
  question: {
    prompt: "How should we store the per-session draft answers?",
    context:
      "Drafts currently live only in component state, so a refresh while composing a long note loses everything the reviewer typed.",
    relevance:
      "Reviewers often step away mid-decision. Persisting drafts decides whether we need a migration and a cleanup job.",
    decisionImpact:
      "Picking IndexedDB commits us to an async storage layer everywhere a draft is read or written."
  },
  options: [
    {
      value: "localstorage",
      label: "localStorage, keyed by request id",
      description: "Synchronous, trivial to implement, survives reloads on the same device.",
      meaning: "Ship the smallest change that solves the reported data loss.",
      context: "~5 lines in the form factory; no schema, no migration."
    },
    {
      value: "indexeddb",
      label: "IndexedDB via a small wrapper",
      description: "Room for larger drafts and structured history, at the cost of async reads everywhere.",
      meaning: "Invest now in storage we will not outgrow.",
      context: "Adds an async boundary to every draft read/write and a wrapper to maintain."
    },
    {
      value: "server",
      label: "Persist drafts to the server",
      description: "Drafts follow the reviewer across devices, but every keystroke becomes a network concern.",
      meaning: "Treat drafts as first-class, multi-device state.",
      context: "Needs a new endpoint, debounce, and conflict handling."
    }
  ],
  context: {
    problemContext:
      "Reviewers report losing half-written notes when the dashboard reloads during a deploy. It happens a few times a week and erodes trust in the tool.",
    codebaseContext:
      "Answer state lives in createQuestionForm() in apps/web/src/lib/questionForm.svelte.ts. There is no persistence layer in the web app today.",
    additionalInfo: [
      {
        kind: "code",
        title: "Where the draft note is held today",
        language: "ts",
        content: "let note = $state(\"\");\n// lost on reload — nothing persists this between sessions"
      },
      {
        kind: "text",
        title: "Constraint",
        content: "Whatever we choose has to degrade gracefully when storage is unavailable (private browsing)."
      }
    ]
  },
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
