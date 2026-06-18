<script lang="ts">
  import { layout } from "../lib/layout.svelte";
  import { store } from "../lib/store.svelte";

  // The mock only renders when there is no real pending question to show.
  const realQuestionActive = $derived(store.selection.kind === "request" && Boolean(store.selectedRequest));
</script>

<button
  class="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium shadow-postbox-panel backdrop-blur transition {layout.mockQuestion
    ? 'border-attention bg-attention/15 text-attention-foreground'
    : 'border-postbox-border bg-postbox-surface/95 text-postbox-subtle hover:text-postbox-text'}"
  onclick={() => layout.toggleMock()}
  title={realQuestionActive ? "A real question is active — the mock shows when none is." : "Show a mock question to test the UI"}
>
  <span class="h-2 w-2 rounded-full {layout.mockQuestion ? 'bg-attention' : 'bg-postbox-border-strong'}"></span>
  Dev mock · {layout.mockQuestion ? "On" : "Off"}
  {#if layout.mockQuestion && realQuestionActive}<span class="text-postbox-muted">(hidden)</span>{/if}
</button>
