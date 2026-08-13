<script lang="ts">
  import { postJson } from "../api/postboxApi";
  import { groupOpenQuestions } from "../lib/openQuestionsQueue";
  import { store } from "../lib/store.svelte";
  import ProjectIcon from "./ProjectIcon.svelte";
  import QuestionTreeList from "./QuestionTreeList.svelte";

  /** When projectId is set, the queue shows only that project's questions. */
  let { projectId: projectFilter }: { projectId?: string } = $props();

  const filteredProject = $derived(
    projectFilter ? store.projects.find((project) => project.projectId === projectFilter) : undefined
  );

  const groups = $derived(groupOpenQuestions(store.pendingRequests, store.sessions, projectFilter));

  const questionCount = $derived(groups.reduce((count, group) => count + group.questions.length, 0));
  const heading = $derived(
    projectFilter ? (filteredProject?.projectName ?? groups[0]?.projectName ?? "Project") : "Questions waiting for you"
  );

  // Manual escape hatch for stuck questions, e.g. when the agent abandoned an
  // ask without telling the server. Cancels the request server-side.
  let dismissingRequestId = $state<string | undefined>(undefined);
  let dismissError = $state<string | undefined>(undefined);

  async function dismissRequest(requestId: string): Promise<void> {
    if (dismissingRequestId) return;
    dismissingRequestId = requestId;
    dismissError = undefined;
    try {
      await postJson(`/api/requests/${encodeURIComponent(requestId)}/cancel`, {
        note: "Dismissed manually from the dashboard queue."
      });
      await store.refresh();
    } catch (error) {
      dismissError = error instanceof Error ? error.message : "Unable to dismiss question";
    } finally {
      dismissingRequestId = undefined;
    }
  }
</script>

<div class="mx-auto flex min-h-full w-full max-w-5xl flex-col px-4 py-6 sm:px-6 lg:px-8">
  <header class="border-b border-postbox-border pb-5">
    <p class="text-xs font-semibold uppercase tracking-[0.3em] text-attention-foreground">
      {projectFilter ? "Project queue" : "Open queue"}
    </p>
    <div class="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 class="font-display text-3xl font-semibold tracking-tight text-postbox-text">{heading}</h1>
        <p class="mt-2 max-w-2xl text-sm leading-6 text-postbox-subtle">
          {projectFilter
            ? "Pending Postbox decisions for this project, arranged as oldest-first parent trees."
            : "All pending Postbox decisions, grouped by repository and arranged as oldest-first parent trees."}
        </p>
      </div>
      <div class="rounded-full border border-attention-border bg-attention/10 px-3 py-1 text-sm font-semibold text-attention-foreground">
        {questionCount} open
      </div>
    </div>
  </header>

  {#if dismissError}
    <p class="mt-4 rounded-lg bg-danger/10 p-3 text-sm text-danger-foreground" role="alert">{dismissError}</p>
  {/if}

  {#if groups.length === 0}
    <div class="flex flex-1 flex-col items-center justify-center py-20 text-center" aria-live="polite">
      {#if store.syncing}
        <h2 class="font-display text-2xl font-semibold text-postbox-text">Checking for questions…</h2>
        <p class="mt-2 max-w-md text-postbox-subtle">Syncing with your Postbox server.</p>
      {:else}
        <h2 class="font-display text-2xl font-semibold text-postbox-text">No open questions</h2>
        <p class="mt-2 max-w-md text-postbox-subtle">
          {projectFilter
            ? "When an agent in this project needs a decision, it will appear here."
            : "When an agent needs a decision, it will appear here grouped by project."}
        </p>
      {/if}
    </div>
  {:else}
    <div class="mt-6 space-y-6">
      {#each groups as group (group.projectId)}
        <section class="rounded-lg border border-postbox-border bg-postbox-elevated p-3 shadow-postbox-paper sm:p-4">
          {#if !projectFilter}
            <div class="flex items-center gap-3 border-b border-postbox-border pb-3">
              <ProjectIcon name={group.projectName} icon={group.projectIcon} size="md" />
              <div class="min-w-0 flex-1">
                <h2 class="truncate text-base font-semibold text-postbox-text">{group.projectName}</h2>
                <p class="text-xs text-postbox-muted">{group.questions.length} open question{group.questions.length === 1 ? "" : "s"}</p>
              </div>
            </div>
          {/if}

          <div class={projectFilter ? "" : "mt-3"}>
            <QuestionTreeList nodes={group.questionTree ?? []} {dismissingRequestId} onDismiss={dismissRequest} />
          </div>
        </section>
      {/each}
    </div>
  {/if}
</div>
