<script lang="ts">
  import type { QuestionTreeNode } from "../lib/openQuestionsQueue";
  import { branchLabel } from "../lib/status";
  import { store } from "../lib/store.svelte";
  import QuestionTreeList from "./QuestionTreeList.svelte";

  let { nodes, depth = 0, dismissingRequestId, onDismiss }: {
    nodes: QuestionTreeNode[];
    depth?: number;
    dismissingRequestId?: string;
    onDismiss: (requestId: string) => void;
  } = $props();

  function formatCreatedAt(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Waiting";
    return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date);
  }
</script>

<ul class:mt-2={depth > 0} class="space-y-1" aria-label={depth === 0 ? "Question hierarchy" : undefined}>
  {#each nodes as node (node.request.requestId)}
    {@const active = store.selection.kind === "request" && store.selection.requestId === node.request.requestId}
    <li class:border-l={depth > 0} class:pl-4={depth > 0} class="border-postbox-border/70" data-question-depth={depth}>
      <div class="flex items-start gap-1">
        <button type="button"
          class="group flex min-w-0 flex-1 items-start gap-3 rounded-lg px-3 py-3 text-left transition hover:bg-postbox-text/5 focus:outline-none focus:ring-2 focus:ring-attention/60 {active ? 'bg-attention/5 ring-1 ring-attention-border' : ''}"
          onclick={() => store.selectRequest(node.request.requestId)}>
          <span class="mt-1 h-2 w-2 shrink-0 rounded-full bg-attention"></span>
          <span class="min-w-0 flex-1">
            <span class="line-clamp-2 text-sm font-medium leading-5 text-postbox-text group-hover:text-attention-foreground">{node.request.question.prompt}</span>
            <span class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-postbox-muted">
              <span>{node.session ? branchLabel(node.session) : "Detached session"}</span>
              <span>{node.request.mode === "multi" ? "Multiple choice" : "Single choice"}</span>
              <span>Asked {formatCreatedAt(node.request.createdAt)}</span>
            </span>
          </span>
        </button>
        <button type="button" class="mt-2 shrink-0 rounded-full p-1.5 text-postbox-muted transition hover:bg-attention/10 hover:text-attention-foreground disabled:cursor-wait disabled:opacity-50"
          title="Dismiss this question (cancels it without answering)" aria-label="Dismiss question: {node.request.question.prompt}"
          disabled={dismissingRequestId !== undefined} onclick={() => onDismiss(node.request.requestId)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-3.5 w-3.5" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
      {#if node.children.length > 0}
        <QuestionTreeList nodes={node.children} depth={depth + 1} {dismissingRequestId} {onDismiss} />
      {/if}
    </li>
  {/each}
</ul>
