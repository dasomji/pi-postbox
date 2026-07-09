<script lang="ts">
  import { branchLabel, dotLabel, sessionDot } from "../lib/status";
  import { store, type ProjectGroup } from "../lib/store.svelte";
  import ProjectIcon from "./ProjectIcon.svelte";
  import StatusDot from "./StatusDot.svelte";

  let { project, onNavigate }: { project: ProjectGroup; onNavigate?: () => void } = $props();

  const questions = $derived(
    project.sessions
      .flatMap((session) => store.openQuestionsFor(session.sessionId))
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
  );
  const projectSelected = $derived(
    store.selection.kind === "project" && store.selection.projectId === project.projectId
  );

  function selectProject(): void {
    store.selectProject(project.projectId);
    onNavigate?.();
  }

  function selectSession(sessionId: string): void {
    store.selectSession(sessionId);
    onNavigate?.();
  }

  function selectRequest(requestId: string): void {
    store.selectRequest(requestId);
    onNavigate?.();
  }
</script>

<section class="mb-3">
  <div class="flex items-center gap-1">
    <button
      class="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-postbox-text/5 {projectSelected
        ? 'bg-postbox-text/10'
        : ''}"
      onclick={selectProject}
      title="Show open questions for {project.projectName}"
    >
      <ProjectIcon name={project.projectName} icon={project.projectIcon} size="sm" />
      <h2 class="min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wide text-postbox-text">
        {project.projectName}
      </h2>
    </button>
    <div class="flex shrink-0 items-center gap-0.5 pr-1">
      {#each project.sessions as session (session.sessionId)}
        {@const dot = sessionDot(session, store.openQuestionsFor(session.sessionId).length > 0)}
        {@const active = store.selection.kind === "session" && store.selection.sessionId === session.sessionId}
        <button
          class="rounded-full p-1 transition hover:bg-postbox-text/10 {active ? 'bg-postbox-text/10 ring-1 ring-attention-border' : ''}"
          title="{branchLabel(session)} — {dotLabel[dot]}"
          aria-label="{branchLabel(session)} — {dotLabel[dot]}"
          onclick={() => selectSession(session.sessionId)}
        >
          <StatusDot color={dot} />
        </button>
      {/each}
    </div>
  </div>

  {#if questions.length > 0}
    <ul class="mt-0.5 space-y-0.5 pl-2">
      {#each questions as question (question.requestId)}
        {@const active = store.selection.kind === "request" && store.selection.requestId === question.requestId}
        <li>
          <button
            class="block w-full truncate rounded-md px-2 py-1 text-left text-xs transition hover:bg-postbox-text/5 hover:text-postbox-text {active
              ? 'bg-attention/10 text-attention-foreground'
              : 'text-postbox-subtle'}"
            onclick={() => selectRequest(question.requestId)}
            title={question.question.prompt}
          >
            {question.question.prompt}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>
