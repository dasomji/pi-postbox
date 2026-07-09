<script lang="ts">
  import type { AskRequestSnapshot } from "@pi-postbox/protocol";
  import MetadataRow from "./MetadataRow.svelte";

  let {
    request,
    forceOpen = false,
    showQuestionContext = true
  }: { request: AskRequestSnapshot; forceOpen?: boolean; showQuestionContext?: boolean } = $props();

  const hasQuestionContext = $derived(
    showQuestionContext && Boolean(request.question.context || request.question.relevance || request.question.decisionImpact)
  );
  const hasHandoffContext = $derived(
    Boolean(request.context?.codebaseContext || request.context?.problemContext || request.context?.additionalInfo?.length)
  );
  const hasForkReference = $derived(Boolean(request.forkReference && Object.values(request.forkReference).some(Boolean)));
</script>

{#if hasQuestionContext || hasHandoffContext || hasForkReference}
  <div class="mt-4 space-y-2">
    {#if hasQuestionContext}
      <details open={forceOpen} class="rounded-xl border border-attention-border bg-attention/10 p-3">
        <summary class="cursor-pointer text-sm font-semibold text-attention-foreground">Why this decision matters</summary>
        <dl class="mt-3 grid gap-3 text-sm">
          {#if request.question.context}<MetadataRow label="Context" value={request.question.context} />{/if}
          {#if request.question.relevance}<MetadataRow label="Relevance" value={request.question.relevance} />{/if}
          {#if request.question.decisionImpact}<MetadataRow label="Impact" value={request.question.decisionImpact} />{/if}
        </dl>
      </details>
    {/if}

    {#if hasHandoffContext}
      <details open={forceOpen} class="rounded-xl border border-postbox-border bg-postbox-elevated/70 p-3">
        <summary class="cursor-pointer text-sm font-semibold text-postbox-text">Interviewer handoff context</summary>
        <dl class="mt-3 grid gap-3 text-sm">
          {#if request.context?.problemContext}<MetadataRow label="Problem" value={request.context.problemContext} />{/if}
          {#if request.context?.codebaseContext}<MetadataRow label="Codebase" value={request.context.codebaseContext} />{/if}
        </dl>
        {#if request.context?.additionalInfo?.length}
          <div class="mt-3 space-y-2">
            {#each request.context.additionalInfo as item, index (`${item.title ?? item.kind}-${index}`)}
              <div class="rounded-lg border border-postbox-border bg-postbox-canvas/70 p-3">
                <p class="text-xs font-semibold uppercase tracking-wide text-postbox-muted">
                  {item.kind}{item.language ? ` · ${item.language}` : ""}
                </p>
                {#if item.title}<p class="mt-1 font-medium text-postbox-text">{item.title}</p>{/if}
                {#if item.kind === "code"}
                  <pre class="mt-2 overflow-x-auto whitespace-pre-wrap rounded-lg border border-postbox-border bg-postbox-text/5 p-3 text-xs text-postbox-subtle"><code
                    >{item.content}</code
                  ></pre>
                {:else}
                  <p class="mt-2 whitespace-pre-wrap text-sm text-postbox-subtle">{item.content}</p>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </details>
    {/if}

    {#if hasForkReference}
      <details open={forceOpen} class="rounded-xl border border-postbox-border bg-postbox-elevated/70 p-3">
        <summary class="cursor-pointer text-sm font-semibold text-postbox-text">Future fork reference</summary>
        <dl class="mt-3 grid gap-3 text-sm">
          {#if request.forkReference?.agentSessionId}<MetadataRow label="Session ID" value={request.forkReference.agentSessionId} />{/if}
          {#if request.forkReference?.agentSessionPath}<MetadataRow label="Session path" value={request.forkReference.agentSessionPath} />{/if}
          {#if request.forkReference?.leafId}<MetadataRow label="Leaf ID" value={request.forkReference.leafId} />{/if}
          {#if request.forkReference?.cwd}<MetadataRow label="CWD" value={request.forkReference.cwd} />{/if}
          {#if request.forkReference?.model}<MetadataRow label="Model" value={request.forkReference.model} />{/if}
        </dl>
      </details>
    {/if}
  </div>
{/if}
