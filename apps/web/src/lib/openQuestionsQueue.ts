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

function orderQuestionTree(items: QuestionQueueItem[]): { questions: QuestionQueueItem[]; tree: QuestionTreeNode[] } {
  const nodes = new Map(items.map((item) => [item.request.requestId, { ...item, children: [] } as QuestionTreeNode]));
  const roots: QuestionTreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.request.parentQuestionId ? nodes.get(node.request.parentQuestionId) : undefined;
    if (parent) parent.children.push(node); else roots.push(node);
  }
  const oldestFirst = (a: QuestionTreeNode, b: QuestionTreeNode) => a.request.createdAt.localeCompare(b.request.createdAt) || a.request.requestId.localeCompare(b.request.requestId);
  const sort = (values: QuestionTreeNode[]): void => { values.sort(oldestFirst); values.forEach((node) => sort(node.children)); };
  sort(roots);
  const questions: QuestionQueueItem[] = [];
  const visit = (node: QuestionTreeNode): void => { questions.push(node); node.children.forEach(visit); };
  roots.forEach(visit);
  return { questions, tree: roots };
}

export function groupOpenQuestions(
  requests: AskRequestSnapshot[],
  sessions: SessionSnapshot[],
  projectFilter?: string
): QuestionProjectGroup[] {
  if (requests.some((request) => request.repository && request.worktree && request.feature) || sessions.some((session) => session.repository && session.worktree && session.feature)) {
    const sessionsById = new Map(sessions.map((session) => [session.sessionId, session]));
    const repositories = new Map<string, QuestionProjectGroup>();
    for (const request of requests) {
      const session = sessionsById.get(request.sessionId);
      const repositoryIdentity = request.repository ?? session?.repository;
      const worktreeIdentity = request.worktree ?? session?.worktree;
      const featureIdentity = request.feature ?? session?.feature;
      if (!repositoryIdentity || !worktreeIdentity || !featureIdentity) continue;
      if (projectFilter && repositoryIdentity.repositoryId !== projectFilter) continue;
      let repository = repositories.get(repositoryIdentity.repositoryId);
      if (!repository) {
        repository = { projectId: repositoryIdentity.repositoryId, repositoryId: repositoryIdentity.repositoryId,
          projectName: repositoryIdentity.remote ?? session?.projectName ?? repositoryIdentity.repositoryId, questions: [], worktreeFeatures: [] };
        repositories.set(repositoryIdentity.repositoryId, repository);
      }
      const key = `${worktreeIdentity.worktreeId}:${featureIdentity.featureId}`;
      let subgroup = repository.worktreeFeatures!.find((candidate) => `${candidate.worktree.worktreeId}:${candidate.feature.featureId}` === key);
      if (!subgroup) {
        subgroup = { worktree: worktreeIdentity, feature: featureIdentity, questions: [] };
        repository.worktreeFeatures!.push(subgroup);
      }
      const item = { request, session };
      subgroup.questions.push(item);
      repository.questions.push(item);
    }
    for (const repository of repositories.values()) {
      for (const subgroup of repository.worktreeFeatures!) {
        const ordered = orderQuestionTree(subgroup.questions);
        subgroup.questions = ordered.questions;
      }
      repository.worktreeFeatures!.sort((a, b) => a.questions[0]!.request.createdAt.localeCompare(b.questions[0]!.request.createdAt));
      const repositoryItems = repository.worktreeFeatures!.flatMap((subgroup) => subgroup.questions);
      repository.questions = repositoryItems;
      repository.questionTree = orderQuestionTree(repositoryItems).tree;
    }
    return [...repositories.values()].sort((a, b) => a.questions[0]!.request.createdAt.localeCompare(b.questions[0]!.request.createdAt));
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
    const ordered = orderQuestionTree(group.questions);
    group.questionTree = ordered.tree;
    group.questions = ordered.questions;
  }
  groups.sort((a, b) => {
    const questionOrder = comparePendingRequests(a.questions[0]!.request, b.questions[0]!.request);
    return questionOrder || a.projectName.localeCompare(b.projectName);
  });
  return groups;
}
