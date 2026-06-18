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
