<script lang="ts">
  import type { AskRequestSnapshot, SessionSnapshot } from "@pi-postbox/protocol";
  import { branchLabel } from "../lib/status";
  import { store } from "../lib/store.svelte";
  import ProjectIcon from "./ProjectIcon.svelte";

  interface QuestionQueueItem {
    request: AskRequestSnapshot;
    session?: SessionSnapshot;
  }

  interface QuestionProjectGroup {
    projectId: string;
    projectName: string;
    projectIcon?: SessionSnapshot["projectIcon"];
    questions: QuestionQueueItem[];
  }

  /** When projectId is set, the queue shows only that project's questions. */
  let { projectId: projectFilter }: { projectId?: string } = $props();

  const filteredProject = $derived(
    projectFilter ? store.projects.find((project) => project.projectId === projectFilter) : undefined
  );

  const groups = $derived.by<QuestionProjectGroup[]>(() => {
    const sessionsById = new Map(store.sessions.map((session) => [session.sessionId, session]));
    const grouped = new Map<string, QuestionProjectGroup>();

    for (const request of store.pendingRequests) {
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

    const list = [...grouped.values()].sort((a, b) => a.projectName.localeCompare(b.projectName));
    for (const group of list) {
      group.questions.sort((a, b) => Date.parse(a.request.createdAt) - Date.parse(b.request.createdAt));
    }
    return list;
  });

  const questionCount = $derived(groups.reduce((count, group) => count + group.questions.length, 0));
  const heading = $derived(
    projectFilter ? (filteredProject?.projectName ?? groups[0]?.projectName ?? "Project") : "Questions waiting for you"
  );

  function formatCreatedAt(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Waiting";
    return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date);
  }
</script>

<div class="mx-auto flex min-h-full w-full max-w-5xl flex-col px-4 py-6 sm:px-6 lg:px-8">
  <header class="border-b border-postbox-border pb-5">
    <p class="text-xs font-semibold uppercase tracking-[0.3em] text-attention-foreground">
      {projectFilter ? "Project queue" : "Open queue"}
    </p>
    <div class="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 class="text-3xl font-semibold tracking-tight text-postbox-text">{heading}</h1>
        <p class="mt-2 max-w-2xl text-sm leading-6 text-postbox-subtle">
          {projectFilter
            ? "Pending Postbox decisions for this project, oldest first."
            : "All pending Postbox decisions, grouped by project so you can clear the highest-context work first."}
        </p>
      </div>
      <div class="rounded-full border border-attention-border bg-attention/10 px-3 py-1 text-sm font-semibold text-attention-foreground">
        {questionCount} open
      </div>
    </div>
  </header>

  {#if groups.length === 0}
    <div class="flex flex-1 flex-col items-center justify-center py-20 text-center">
      <h2 class="text-2xl font-semibold text-postbox-text">No open questions</h2>
      <p class="mt-2 max-w-md text-postbox-subtle">
        {projectFilter
          ? "When an agent in this project needs a decision, it will appear here."
          : "When an agent needs a decision, it will appear here grouped by project."}
      </p>
    </div>
  {:else}
    <div class="mt-6 space-y-6">
      {#each groups as group (group.projectId)}
        <section class="rounded-2xl border border-postbox-border bg-postbox-surface/45 p-3 shadow-postbox-panel sm:p-4">
          {#if !projectFilter}
            <div class="flex items-center gap-3 border-b border-postbox-border pb-3">
              <ProjectIcon name={group.projectName} icon={group.projectIcon} size="md" />
              <div class="min-w-0 flex-1">
                <h2 class="truncate text-base font-semibold text-postbox-text">{group.projectName}</h2>
                <p class="text-xs text-postbox-muted">{group.questions.length} open question{group.questions.length === 1 ? "" : "s"}</p>
              </div>
            </div>
          {/if}

          <ul class="divide-y divide-postbox-border/70 {projectFilter ? '' : 'mt-3'}">
            {#each group.questions as item (item.request.requestId)}
              {@const active = store.selection.kind === "request" && store.selection.requestId === item.request.requestId}
              <li>
                <button
                  type="button"
                  class="group flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-attention/60 {active
                    ? 'bg-attention/10 ring-1 ring-attention-border'
                    : ''}"
                  onclick={() => store.selectRequest(item.request.requestId)}
                >
                  <span class="mt-1 h-2 w-2 shrink-0 rounded-full bg-attention shadow-[0_0_18px_rgba(103,232,249,0.65)]"></span>
                  <span class="min-w-0 flex-1">
                    <span class="line-clamp-2 text-sm font-medium leading-5 text-postbox-text group-hover:text-attention-foreground">
                      {item.request.question.prompt}
                    </span>
                    <span class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-postbox-muted">
                      <span>{item.session ? branchLabel(item.session) : "Detached session"}</span>
                      <span>{item.request.mode === "multi" ? "Multiple choice" : "Single choice"}</span>
                      <span>Asked {formatCreatedAt(item.request.createdAt)}</span>
                    </span>
                  </span>
                </button>
              </li>
            {/each}
          </ul>
        </section>
      {/each}
    </div>
  {/if}
</div>
