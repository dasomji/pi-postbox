import type { AskRequestSnapshot, SessionSnapshot } from "@pi-postbox/protocol";
import { comparePendingRequests } from "./store.svelte";

export interface QuestionQueueItem {
  request: AskRequestSnapshot;
  session?: SessionSnapshot;
}

export interface QuestionProjectGroup {
  projectId: string;
  projectName: string;
  projectIcon?: SessionSnapshot["projectIcon"];
  questions: QuestionQueueItem[];
}

export function groupOpenQuestions(
  requests: AskRequestSnapshot[],
  sessions: SessionSnapshot[],
  projectFilter?: string
): QuestionProjectGroup[] {
  const sessionsById = new Map(sessions.map((session) => [session.sessionId, session]));
  const grouped = new Map<string, QuestionProjectGroup>();

  for (const request of requests) {
    const session = sessionsById.get(request.sessionId);
    const projectId = session?.projectId ?? request.sessionId;
    if (projectFilter && projectId !== projectFilter) continue;
    const group = grouped.get(projectId);
    const item = { request, session };

    if (group) group.questions.push(item);
    else
      grouped.set(projectId, {
        projectId,
        projectName: session?.projectName ?? "Unknown project",
        projectIcon: session?.projectIcon,
        questions: [item]
      });
  }

  const groups = [...grouped.values()];
  for (const group of groups) {
    group.questions.sort((a, b) => comparePendingRequests(a.request, b.request));
  }
  groups.sort((a, b) => {
    const questionOrder = comparePendingRequests(a.questions[0]!.request, b.questions[0]!.request);
    return questionOrder || a.projectName.localeCompare(b.projectName);
  });
  return groups;
}
