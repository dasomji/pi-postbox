import { OTHER_OPTION_VALUE, type AskRequestSnapshot, type SessionSnapshot } from "@pi-postbox/protocol";

export function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function formatTimestamp(timestamp: string): string {
  return new Date(timestamp).toLocaleString();
}

export function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString();
}

/** "just now", "5 min ago", "3 h ago", "2 days ago" — for question age at a glance. */
export function formatTimeAgo(timestamp: string, now: Date = new Date()): string {
  const then = new Date(timestamp).getTime();
  if (Number.isNaN(then)) return "unknown";
  const seconds = Math.max(0, Math.floor((now.getTime() - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${formatCount(days, "day")} ago`;
}

export function selectedOptionLabels(request: AskRequestSnapshot): string | undefined {
  const result = request.result;
  if (result?.status !== "answered") return undefined;

  return result.selectedValues
    .map((value) => request.options.find((option) => option.value === value)?.label ?? (value === OTHER_OPTION_VALUE ? "Other" : value))
    .join(", ");
}

export function sessionTitle(session: SessionSnapshot): string {
  const worktreeLabel = session.worktreePath ? session.worktreePath.split("/").filter(Boolean).at(-1) : undefined;
  const fallbackTitle = `${session.repoName ?? session.projectName}${worktreeLabel ? ` / ${worktreeLabel}` : ""}${session.branch ? ` · ${session.branch}` : ""}`;
  return session.title ?? fallbackTitle;
}

export function abbreviatedHead(session: SessionSnapshot): string {
  if (session.headSha) return `${session.headSha.slice(0, 12)}${session.isDirty ? " + dirty" : ""}`;
  return session.isDirty ? "dirty" : "unknown";
}
