<script lang="ts">
  import type { SessionSnapshot } from "@pi-postbox/protocol";
  import { branchLabel, dotLabel, sessionDot } from "../lib/status";
  import { store } from "../lib/store.svelte";
  import StatusDot from "./StatusDot.svelte";

  let { session, onNavigate }: { session: SessionSnapshot; onNavigate?: () => void } = $props();

  const questions = $derived(store.openQuestionsFor(session.sessionId));
  const dot = $derived(sessionDot(session, questions.length > 0));
  const selected = $derived(store.selection.kind === "session" && store.selection.sessionId === session.sessionId);

  function selectSession(): void {
    store.selectSession(session.sessionId);
    onNavigate?.();
  }

  function selectRequest(requestId: string): void {
    store.selectRequest(requestId);
    onNavigate?.();
  }
</script>

<li>
  <button
    class="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left transition hover:bg-white/5 {selected
      ? 'bg-white/10'
      : ''}"
    onclick={selectSession}
    title={dotLabel[dot]}
  >
    <StatusDot color={dot} />
    <span class="min-w-0 flex-1 truncate text-sm font-medium text-postbox-text">{branchLabel(session)}</span>
    {#if questions.length > 0}
      <span class="shrink-0 rounded-full bg-rose-500/20 px-1.5 text-xs font-semibold text-rose-300">{questions.length}</span>
    {/if}
  </button>

  {#if questions.length > 0}
    <ul class="mb-1 ml-[1.35rem] space-y-0.5 border-l border-postbox-border pl-2">
      {#each questions as question (question.requestId)}
        {@const active = store.selection.kind === "request" && store.selection.requestId === question.requestId}
        <li>
          <button
            class="block w-full truncate rounded-md px-2 py-1 text-left text-xs transition hover:bg-white/5 hover:text-postbox-text {active
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
</li>
