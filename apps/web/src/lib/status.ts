import type { SessionSnapshot } from "@pi-postbox/protocol";

export type DotColor = "green" | "red" | "blue" | "gray";

/**
 * Sidebar status dot for an agent session:
 * - red   → blocked, or has an open question waiting for us
 * - green → actively working
 * - blue  → done / idle
 * - gray  → offline or unknown
 */
export function sessionDot(session: SessionSnapshot, hasOpenQuestion: boolean): DotColor {
  if (session.presence === "offline") return "gray";
  if (hasOpenQuestion || session.semanticState === "blocked") return "red";
  if (session.semanticState === "working") return "green";
  if (session.semanticState === "idle") return "blue";
  return "gray";
}

export const dotClass: Record<DotColor, string> = {
  green: "bg-emerald-600",
  red: "bg-rose-600",
  blue: "bg-blue-600",
  gray: "bg-slate-400"
};

export const dotLabel: Record<DotColor, string> = {
  green: "Working",
  red: "Needs you",
  blue: "Done",
  gray: "Offline"
};

/** The agent's displayed name in the sidebar is its branch name. */
export function branchLabel(session: SessionSnapshot): string {
  return session.branch ?? session.title ?? session.repoName ?? session.sessionId.slice(0, 8);
}
