<script lang="ts">
  import { formatTime } from "../lib/format";
  import { store } from "../lib/store.svelte";
  import HistoryCard from "./HistoryCard.svelte";

  const history = $derived(store.history);
  const records = $derived(history.status === "ready" ? history.data.history : []);
  const timestamp = $derived(history.status === "ready" ? formatTime(history.data.timestamp) : undefined);
</script>

<section class="mx-auto max-w-3xl px-6 py-8">
  <div class="flex items-center justify-between gap-4">
    <div>
      <h1 class="font-display text-2xl font-semibold text-postbox-text">Decision history</h1>
      <p class="mt-1 text-sm text-postbox-muted">
        {#if history.status === "loading"}
          Loading history…
        {:else if history.status === "error"}
          History unavailable: {history.message}
        {:else}
          {records.length} resolved, cancelled, or expired request{records.length === 1 ? "" : "s"}.
        {/if}
      </p>
    </div>
    {#if timestamp}<time class="text-xs text-postbox-muted opacity-70">{timestamp}</time>{/if}
  </div>

  {#if records.length > 0}
    <div class="mt-6 grid gap-4">
      {#each records as record (record.request.requestId)}
        <HistoryCard {record} />
      {/each}
    </div>
  {:else if history.status === "ready"}
    <div class="mt-6 rounded-2xl border border-dashed border-history-border bg-postbox-canvas/50 p-8 text-center text-history-foreground opacity-75">
      No recent history yet. Resolved, cancelled, and expired Postbox Questions appear here for audit without storing Question Chat transcripts.
    </div>
  {/if}
</section>
