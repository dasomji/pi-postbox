<script lang="ts">
  import { OTHER_OPTION_VALUE, type AskRequestSnapshot, type SessionSnapshot } from "@pi-postbox/protocol";
  import { cubicInOut } from "svelte/easing";
  import { fade, fly, slide } from "svelte/transition";
  import { formatTimeAgo } from "../lib/format";
  import { modalFocus } from "../lib/modalFocus";
  import type { QuestionForm } from "../lib/questionForm.svelte";
  import { branchLabel } from "../lib/status";
  import RichContext from "./RichContext.svelte";
  import QuestionChatActivation from "./QuestionChatActivation.svelte";

  let {
    request,
    session,
    form
  }: { request: AskRequestSnapshot; session?: SessionSnapshot; form: QuestionForm } = $props();

  let showContext = $state(false);
  let showNote = $state(false);
  let contextPanelOpener = $state<HTMLElement | null>(null);
  // "Why this decision matters" starts collapsed to the context line only.
  let decisionContextExpanded = $state(false);
  // Set when the answer is stamped (submitted); cleared again if the submit errors.
  let stamped = $state(false);

  const hasDecisionContext = $derived(
    Boolean(request.question.context || request.question.relevance || request.question.decisionImpact)
  );
  const hasMoreDecisionContext = $derived(Boolean(request.question.relevance || request.question.decisionImpact));
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
  const showStamp = $derived(stamped && !form.error);

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

  function submitWithStamp(): void {
    if (!form.canSubmit) return;
    stamped = true;
    form.submit();
  }
</script>

<svelte:window {onkeydown} />

<div class="flex min-h-full flex-col px-4 py-4 sm:px-6">
  <div class="flex flex-wrap items-center justify-between gap-3 text-xs text-postbox-muted">
    <span class="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <span><span class="font-medium text-postbox-subtle">Project:</span> {projectLabel}</span>
      <span class="text-attention">•</span>
      <span><span class="font-medium text-postbox-subtle">Branch:</span> {branch}</span>
    </span>
    <button
      class="rounded-full border border-postbox-border bg-postbox-elevated px-3 py-1 font-medium text-postbox-subtle transition hover:border-attention-border hover:text-attention-foreground"
      onclick={openContextPanel}
    >
      ⓘ Context
    </button>
  </div>

  <div class="mt-3">
    <QuestionChatActivation requestId={request.requestId} />
  </div>

  <div class="flex flex-1 justify-center py-6 sm:py-8">
    <div class="w-full max-w-2xl">
      <!-- Letter strip: the question arrives on a piece of ruled writing paper. -->
      <div class="letter-paper rounded-md shadow-postbox-paper">
        <h1 class="py-6 pl-12 pr-5 font-display text-base font-bold leading-6 text-postbox-text sm:pr-8">
          {request.question.prompt}
        </h1>
      </div>

      {#if hasDecisionContext}
        <!-- Postal double frame with a navy envelope stamp. -->
        <section class="mt-5 rounded-lg border-2 border-history/50 bg-history/5 p-[3px] shadow-postbox-section">
          <div class="rounded-md border border-history/40 p-3 text-left sm:p-4">
            {#if hasMoreDecisionContext}
              <button
                type="button"
                class="flex w-full items-start gap-3 text-left"
                aria-expanded={decisionContextExpanded}
                onclick={() => (decisionContextExpanded = !decisionContextExpanded)}
              >
                <span class="stamp-edge mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-sm bg-history text-postbox-elevated" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-5 w-5"><rect x="3" y="5" width="18" height="14" rx="1" /><path d="m3 7 9 6 9-6" /></svg>
                </span>
                <span class="min-w-0 flex-1">
                  <span class="flex items-center gap-3">
                    <span class="text-xs font-bold uppercase tracking-wide text-history-foreground">Why this decision matters</span>
                    <span class="hidden h-px min-w-4 flex-1 bg-history/40 sm:block" aria-hidden="true"></span>
                    <span
                      class="shrink-0 text-history-foreground transition-transform duration-200 {decisionContextExpanded ? 'rotate-180' : ''}"
                      aria-hidden="true">▾</span
                    >
                  </span>
                  {#if request.question.context}
                    <span class="mt-1 block whitespace-pre-wrap text-sm leading-relaxed text-postbox-subtle">{request.question.context}</span>
                  {/if}
                </span>
              </button>
              {#if decisionContextExpanded}
                <dl class="mt-3 grid gap-3 pl-12 text-sm text-postbox-subtle" transition:slide={{ duration: 180, easing: cubicInOut }}>
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
              {/if}
            {:else}
              <div class="flex items-start gap-3">
                <span class="stamp-edge mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-sm bg-history text-postbox-elevated" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-5 w-5"><rect x="3" y="5" width="18" height="14" rx="1" /><path d="m3 7 9 6 9-6" /></svg>
                </span>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-3">
                    <p class="text-xs font-bold uppercase tracking-wide text-history-foreground">Why this decision matters</p>
                    <span class="hidden h-px min-w-4 flex-1 bg-history/40 sm:block" aria-hidden="true"></span>
                  </div>
                  {#if request.question.context}
                    <p class="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-postbox-subtle">{request.question.context}</p>
                  {/if}
                </div>
              </div>
            {/if}
          </div>
        </section>
      {/if}

      <p class="mt-4 text-xs uppercase tracking-wide text-postbox-muted">
        {request.mode === "single" ? "Choose one" : "Choose one or more"} · asked {formatTimeAgo(request.createdAt)}
      </p>

      <div class="mt-3 space-y-3">
        {#each request.options as option (option.value)}
          <button
            type="button"
            class="flex w-full items-start gap-3 rounded-lg border p-4 text-left shadow-postbox-section transition {form.isSelected(option.value)
              ? 'border-attention bg-attention/5 ring-1 ring-attention'
              : 'border-postbox-border bg-postbox-elevated hover:border-attention-border'}"
            onclick={() => {
              form.toggle(option.value);
              if (option.value === OTHER_OPTION_VALUE) showNote = true;
            }}
          >
            <span
              class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 {form.isSelected(option.value)
                ? 'border-attention'
                : 'border-postbox-border-strong'}"
              aria-hidden="true"
            >
              {#if form.isSelected(option.value)}<span class="h-2.5 w-2.5 rounded-full bg-attention"></span>{/if}
            </span>
            <span class="w-px self-stretch bg-postbox-border" aria-hidden="true"></span>
            <span class="min-w-0">
              <span class="block font-display text-base font-semibold text-postbox-text">{option.label}</span>
              {#if option.description}<span class="mt-1 block text-sm text-postbox-muted">{option.description}</span>{/if}
              {#if option.meaning}<span class="mt-2 block text-sm text-attention-foreground/80">Meaning: {option.meaning}</span>{/if}
              {#if option.context}<span class="mt-1 block text-sm text-postbox-muted">Context: {option.context}</span>{/if}
            </span>
          </button>
        {/each}

        {#if !hasExistingOther}
          <button
            type="button"
            class="flex w-full items-start gap-3 rounded-lg border border-dashed p-4 text-left transition {form.isSelected(OTHER_OPTION_VALUE)
              ? 'border-attention bg-attention/5 ring-1 ring-attention'
              : 'border-postbox-border-strong bg-postbox-elevated/60 hover:border-attention-border'}"
            onclick={chooseOther}
          >
            <span
              class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 {form.isSelected(OTHER_OPTION_VALUE)
                ? 'border-attention'
                : 'border-postbox-border-strong'}"
              aria-hidden="true"
            >
              {#if form.isSelected(OTHER_OPTION_VALUE)}<span class="h-2.5 w-2.5 rounded-full bg-attention"></span>{/if}
            </span>
            <span class="w-px self-stretch bg-postbox-border" aria-hidden="true"></span>
            <span class="min-w-0">
              <span class="block font-display text-base font-semibold text-postbox-text">Other</span>
              <span class="mt-1 block text-sm text-postbox-muted">Choose this when none of the listed answers fit. A note box will open below.</span>
            </span>
          </button>
        {/if}
      </div>

      {#if showNote}
        <textarea
          class="mt-4 min-h-24 w-full rounded-lg border border-postbox-border bg-postbox-elevated p-3 text-postbox-text outline-none ring-attention/30 placeholder:text-postbox-muted focus:ring-2"
          bind:value={form.note}
          placeholder="Add nuance for the coding agent…"
        ></textarea>
      {/if}

      {#if form.error}<p class="mt-4 rounded-lg bg-danger/10 p-3 text-center text-sm text-danger-foreground">{form.error}</p>{/if}
      {#if form.done && !showStamp}<p class="mt-4 rounded-lg bg-success/10 p-3 text-center text-sm text-success-foreground">{form.done}</p>{/if}

      <div class="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
        <button
          class="inline-flex w-full items-center justify-center gap-2.5 rounded-md border border-attention-foreground bg-attention px-8 py-3 font-display text-sm font-bold uppercase tracking-[0.12em] text-attention-contrast shadow-postbox-paper ring-2 ring-inset ring-white/25 transition hover:bg-attention-foreground disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          type="button"
          disabled={!form.canSubmit}
          onclick={submitWithStamp}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" class="h-4 w-4 shrink-0" aria-hidden="true"><path d="M2 21l21-9L2 3v7l15 2-15 2z" /></svg>
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

  <div class="-mx-4 mt-auto pt-4 sm:-mx-6" aria-hidden="true">
    <div class="postal-stripes h-[3px] w-full opacity-70"></div>
  </div>
</div>

{#if showStamp}
  <!-- Delivered: the reused variation-1 stamp slams onto the page. -->
  <button
    type="button"
    class="fixed inset-0 z-50 flex cursor-default flex-col items-center justify-center gap-6 bg-postbox-canvas/70 backdrop-blur-sm"
    aria-label="Answer submitted. Dismiss."
    onclick={() => (stamped = false)}
    transition:fade={{ duration: 150, easing: cubicInOut }}
  >
    <img
      src="/stamp-delivered.png"
      alt=""
      class="animate-stamp-down w-56 max-w-[70vw] drop-shadow-lg sm:w-72"
      draggable="false"
    />
    <p class="text-sm font-medium text-postbox-subtle" role="status" aria-live="polite">
      {form.busy ? "Delivering your answer…" : (form.done ?? "Answer delivered")}
    </p>
  </button>
{/if}

{#if showContext}
  <div class="fixed inset-0 z-40 flex items-end justify-center sm:items-stretch sm:justify-end">
    <button
      class="absolute inset-0 cursor-default bg-black/30 backdrop-blur-sm transition-opacity duration-200 ease-in-out"
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
        {#if hasSidebarContext || hasDecisionContext}
          <RichContext {request} forceOpen />
        {:else}
          <p class="mt-4 text-sm text-postbox-muted">No additional context was provided for this question.</p>
        {/if}
      </div>
    </div>
  </div>
{/if}
