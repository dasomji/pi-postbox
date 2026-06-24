<script lang="ts">
  import { OTHER_OPTION_VALUE, type AskRequestSnapshot, type SessionSnapshot } from "@pi-postbox/protocol";
  import { cubicInOut } from "svelte/easing";
  import { fade, fly } from "svelte/transition";
  import { formatTimestamp } from "../lib/format";
  import { modalFocus } from "../lib/modalFocus";
  import type { QuestionForm } from "../lib/questionForm.svelte";
  import { branchLabel } from "../lib/status";
  import RichContext from "./RichContext.svelte";

  let {
    request,
    session,
    form
  }: { request: AskRequestSnapshot; session?: SessionSnapshot; form: QuestionForm } = $props();

  let showContext = $state(false);
  let showNote = $state(false);
  let contextPanelOpener = $state<HTMLElement | null>(null);

  const hasDecisionContext = $derived(
    Boolean(request.question.context || request.question.relevance || request.question.decisionImpact)
  );
  const hasSidebarContext = $derived(
    Boolean(
      request.context?.codebaseContext ||
        request.context?.problemContext ||
        request.context?.additionalInfo?.length ||
        (request.forkReference && Object.values(request.forkReference).some(Boolean))
    )
  );
  const hasExistingOther = $derived(request.options.some((option) => option.value === OTHER_OPTION_VALUE));
  const projectLabel = $derived(session?.projectName ?? session?.repoName ?? "Unknown project");
  const branch = $derived(session ? branchLabel(session) : "Unknown branch");

  function openContextPanel(event: MouseEvent): void {
    contextPanelOpener = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    showContext = true;
  }

  function closeContextPanel(): void {
    showContext = false;
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && showContext) closeContextPanel();
  }

  function chooseOther(): void {
    form.toggle(OTHER_OPTION_VALUE);
    showNote = true;
  }
</script>

<svelte:window {onkeydown} />

<div class="flex min-h-full flex-col px-4 py-4 sm:px-6">
  <div class="flex flex-wrap items-center justify-between gap-3 text-xs text-postbox-muted">
    <span class="uppercase tracking-wide">
      {request.mode === "single" ? "Choose one" : "Choose one or more"} · {formatTimestamp(request.createdAt)}
    </span>
    {#if hasSidebarContext}
      <button
        class="rounded-full border border-postbox-border px-3 py-1 font-medium text-postbox-subtle transition hover:border-attention-border hover:text-attention-foreground"
        onclick={openContextPanel}
      >
        ⓘ Context
      </button>
    {/if}
  </div>

  <div class="flex flex-1 items-center justify-center py-8 sm:py-12">
    <div class="w-full max-w-2xl">
      <h1 class="text-center text-2xl font-semibold leading-snug text-postbox-text sm:text-4xl">
      {request.question.prompt}
    </h1>

    {#if hasDecisionContext}
      <section class="mt-6 rounded-2xl border border-attention-border bg-attention/10 p-4 text-left shadow-postbox-panel">
        <h2 class="text-sm font-semibold uppercase tracking-wide text-attention-foreground">Why this decision matters</h2>
        <dl class="mt-3 grid gap-3 text-sm text-postbox-subtle">
          {#if request.question.context}
            <div>
              <dt class="font-medium text-postbox-text">Context</dt>
              <dd class="mt-1 whitespace-pre-wrap leading-relaxed">{request.question.context}</dd>
            </div>
          {/if}
          {#if request.question.relevance}
            <div>
              <dt class="font-medium text-postbox-text">Relevance</dt>
              <dd class="mt-1 whitespace-pre-wrap leading-relaxed">{request.question.relevance}</dd>
            </div>
          {/if}
          {#if request.question.decisionImpact}
            <div>
              <dt class="font-medium text-postbox-text">Impact</dt>
              <dd class="mt-1 whitespace-pre-wrap leading-relaxed">{request.question.decisionImpact}</dd>
            </div>
          {/if}
        </dl>
      </section>
    {/if}

    <div class="mt-10 space-y-3">
      {#each request.options as option (option.value)}
        <button
          type="button"
          class="w-full rounded-2xl border p-5 text-left transition {form.isSelected(option.value)
            ? 'border-attention bg-attention/10 ring-1 ring-attention'
            : 'border-postbox-border bg-postbox-elevated/60 hover:border-attention-border'}"
          onclick={() => {
            form.toggle(option.value);
            if (option.value === OTHER_OPTION_VALUE) showNote = true;
          }}
        >
          <span class="block text-lg font-medium text-postbox-text">{option.label}</span>
          {#if option.description}<span class="mt-1 block text-sm text-postbox-muted">{option.description}</span>{/if}
        </button>
      {/each}

      {#if !hasExistingOther}
        <button
          type="button"
          class="w-full rounded-2xl border border-dashed p-5 text-left transition {form.isSelected(OTHER_OPTION_VALUE)
            ? 'border-attention bg-attention/10 ring-1 ring-attention'
            : 'border-postbox-border bg-postbox-elevated/40 hover:border-attention-border'}"
          onclick={chooseOther}
        >
          <span class="block text-lg font-medium text-postbox-text">Other</span>
          <span class="mt-1 block text-sm text-postbox-muted">Choose this when none of the listed answers fit. A note box will open below.</span>
        </button>
      {/if}
    </div>

    {#if showNote}
      <textarea
        class="mt-4 min-h-24 w-full rounded-xl border border-postbox-border bg-postbox-canvas p-3 text-postbox-text outline-none ring-attention/30 focus:ring-2"
        bind:value={form.note}
        placeholder="Add nuance for the coding agent…"
      ></textarea>
    {/if}

    {#if form.error}<p class="mt-4 rounded-lg bg-danger/10 p-3 text-center text-sm text-danger-foreground">{form.error}</p>{/if}
    {#if form.done}<p class="mt-4 rounded-lg bg-success/10 p-3 text-center text-sm text-success-foreground">{form.done}</p>{/if}

    <div class="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
      <button
        class="w-full rounded-full bg-attention px-8 py-3 font-semibold text-attention-contrast transition disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
        type="button"
        disabled={!form.canSubmit}
        onclick={() => form.submit()}
      >
        Submit answer
      </button>
      <button
        class="w-full rounded-full px-4 py-3 text-center text-sm text-postbox-muted transition hover:text-postbox-subtle sm:w-auto"
        type="button"
        onclick={() => (showNote = !showNote)}
      >
        {showNote ? "Hide note" : "+ Add a note"}
      </button>
      <button
        class="w-full rounded-full px-4 py-3 text-center text-sm text-postbox-muted transition hover:text-danger-foreground disabled:opacity-50 sm:w-auto"
        type="button"
        disabled={form.busy}
        onclick={() => form.cancel()}
      >
        Cancel
      </button>
    </div>
    </div>
  </div>

  <footer class="sticky bottom-0 -mx-4 mt-auto border-t border-postbox-border/70 bg-postbox-canvas/80 px-4 py-3 text-center text-xs text-postbox-muted backdrop-blur sm:-mx-6 sm:px-6">
    <span class="inline-flex flex-wrap justify-center gap-x-2 gap-y-1">
      <span><span class="font-medium text-postbox-subtle">Project:</span> {projectLabel}</span>
      <span class="text-postbox-border-strong">•</span>
      <span><span class="font-medium text-postbox-subtle">Branch:</span> {branch}</span>
    </span>
  </footer>
</div>

{#if showContext}
  <div class="fixed inset-0 z-40 flex items-end justify-center sm:items-stretch sm:justify-end">
    <button
      class="absolute inset-0 cursor-default bg-black/60 backdrop-blur-sm transition-opacity duration-200 ease-in-out"
      aria-label="Close context"
      tabindex="-1"
      onclick={closeContextPanel}
      transition:fade={{ duration: 180, easing: cubicInOut }}
    ></button>
    <div
      class="relative z-10 h-[85vh] w-full overflow-y-auto rounded-t-3xl border-t border-postbox-border bg-postbox-surface p-5 shadow-postbox-panel transition-transform duration-200 ease-in-out sm:h-full sm:max-w-md sm:rounded-none sm:border-l sm:border-t-0"
      role="dialog"
      aria-modal="true"
      aria-labelledby="context-panel-title"
      tabindex="-1"
      use:modalFocus={contextPanelOpener}
      transition:fly={{ y: 24, duration: 220, easing: cubicInOut }}
    >
      <div class="flex items-center justify-between">
        <h2 id="context-panel-title" class="text-sm font-semibold uppercase tracking-wide text-postbox-muted">Context</h2>
        <button class="text-postbox-muted transition hover:text-postbox-text" aria-label="Close" data-modal-initial-focus onclick={closeContextPanel}>✕</button>
      </div>
      <div class="mt-2">
        <RichContext {request} showQuestionContext={false} forceOpen />
      </div>
    </div>
  </div>
{/if}
