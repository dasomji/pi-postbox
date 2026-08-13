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
  repositoryId?: string;
  worktreeFeatures?: Array<{
    worktree: NonNullable<SessionSnapshot["worktree"]>;
    feature: NonNullable<SessionSnapshot["feature"]>;
    questions: QuestionQueueItem[];
  }>;
  questionTree?: QuestionTreeNode[];
}

export interface QuestionTreeNode extends QuestionQueueItem { children: QuestionTreeNode[] }

export function groupOpenQuestions(
  requests: AskRequestSnapshot[],
  sessions: SessionSnapshot[],
  projectFilter?: string
): QuestionProjectGroup[] {
  if (sessions.some((session) => session.repository && session.worktree && session.feature)) {
    const sessionsById = new Map(sessions.map((session) => [session.sessionId, session]));
    const repositories = new Map<string, QuestionProjectGroup>();
    for (const request of requests) {
      const session = sessionsById.get(request.sessionId);
      if (!session?.repository || !session.worktree || !session.feature) continue;
      if (projectFilter && session.repository.repositoryId !== projectFilter) continue;
      let repository = repositories.get(session.repository.repositoryId);
      if (!repository) {
        repository = { projectId: session.repository.repositoryId, repositoryId: session.repository.repositoryId,
          projectName: session.repository.remote ?? session.projectName, questions: [], worktreeFeatures: [] };
        repositories.set(session.repository.repositoryId, repository);
      }
      const key = `${session.worktree.worktreeId}:${session.feature.featureId}`;
      let subgroup = repository.worktreeFeatures!.find((candidate) => `${candidate.worktree.worktreeId}:${candidate.feature.featureId}` === key);
      if (!subgroup) {
        subgroup = { worktree: session.worktree, feature: session.feature, questions: [] };
        repository.worktreeFeatures!.push(subgroup);
      }
      const item = { request, session };
      subgroup.questions.push(item);
      repository.questions.push(item);
    }
    for (const repository of repositories.values()) repository.worktreeFeatures!.sort((a, b) =>
      a.feature.name?.localeCompare(b.feature.name ?? "") || a.feature.featureId.localeCompare(b.feature.featureId));
    return [...repositories.values()].sort((a, b) => a.projectName.localeCompare(b.projectName));
  }
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
        questions: [item],
        questionTree: []
      });
  }

  const groups = [...grouped.values()];
  for (const group of groups) {
    group.questions.sort((a, b) => comparePendingRequests(a.request, b.request));
    const nodes = new Map(group.questions.map((item) => [item.request.requestId, { ...item, children: [] } as QuestionTreeNode]));
    const roots: QuestionTreeNode[] = [];
    for (const node of nodes.values()) {
      const parentId = node.request.parentQuestionId;
      const parent = parentId ? nodes.get(parentId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    const oldestFirst = (a: QuestionTreeNode, b: QuestionTreeNode) => a.request.createdAt.localeCompare(b.request.createdAt) || a.request.requestId.localeCompare(b.request.requestId);
    const sortTree = (nodesToSort: QuestionTreeNode[]): void => { nodesToSort.sort(oldestFirst); nodesToSort.forEach((node) => sortTree(node.children)); };
    sortTree(roots);
    group.questionTree = roots;
  }
  groups.sort((a, b) => {
    const questionOrder = comparePendingRequests(a.questions[0]!.request, b.questions[0]!.request);
    return questionOrder || a.projectName.localeCompare(b.projectName);
  });
  return groups;
}
