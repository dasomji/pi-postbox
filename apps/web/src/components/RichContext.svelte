<script lang="ts">
  import type { AskRequestSnapshot } from "@pi-postbox/protocol";
  import MetadataRow from "./MetadataRow.svelte";

  let {
    request,
    forceOpen = false,
    showQuestionContext = true
  }: { request: AskRequestSnapshot; forceOpen?: boolean; showQuestionContext?: boolean } = $props();

  const hasQuestionContext = $derived(showQuestionContext && Boolean(request.question.ambiguity));
  const hasForkReference = $derived(Boolean(request.forkReference && Object.values(request.forkReference).some(Boolean)));
</script>

{#if hasQuestionContext || hasForkReference}
  <div class="mt-4 space-y-2">
    {#if hasQuestionContext}
      <details open={forceOpen} class="rounded-xl border border-attention-border bg-attention/10 p-3">
        <summary class="cursor-pointer text-sm font-semibold text-attention-foreground">Ambiguity</summary>
        <dl class="mt-3 grid gap-3 text-sm">
          {#if request.question.ambiguity}<MetadataRow label="Ambiguity" value={request.question.ambiguity} />{/if}
        </dl>
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
