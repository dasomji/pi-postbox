<script lang="ts">
  import { postJson } from "../api/postboxApi";
  import { store } from "../lib/store.svelte";

  let { label, value, endpoint }: { label: string; value: string; endpoint: string } = $props();

  let editing = $state(false);
  let draft = $state("");
  let error = $state<string | undefined>(undefined);
  let busy = $state(false);

  // Keep the draft in sync with the latest value while not actively editing.
  $effect(() => {
    if (!editing) draft = value;
  });

  function startEditing() {
    draft = value;
    error = undefined;
    editing = true;
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    const displayName = draft.trim();
    if (!displayName) return;
    busy = true;
    error = undefined;
    try {
      await postJson(endpoint, { displayName });
      editing = false;
      await store.refresh();
    } catch (caught) {
      error = caught instanceof Error ? caught.message : "Rename failed";
    } finally {
      busy = false;
    }
  }
</script>

{#if editing}
  <form class="grid grid-cols-[7rem_1fr] gap-3" onsubmit={save}>
    <span class="text-postbox-muted">{label}</span>
    <span>
      <span class="flex gap-2">
        <input
          class="min-w-0 flex-1 rounded-lg border border-postbox-border-strong bg-postbox-canvas px-2 py-1 text-postbox-text outline-none ring-attention/30 focus:ring-2"
          bind:value={draft}
          disabled={busy}
        />
        <button class="rounded-lg bg-attention px-2 py-1 text-xs font-semibold text-attention-contrast" type="submit" disabled={busy}>
          Save
        </button>
        <button
          class="rounded-lg border border-postbox-border-strong px-2 py-1 text-xs text-postbox-subtle"
          type="button"
          onclick={() => (editing = false)}
          disabled={busy}
        >
          Cancel
        </button>
      </span>
      {#if error}<span class="mt-1 block text-xs text-danger-foreground">{error}</span>{/if}
    </span>
  </form>
{:else}
  <div class="grid grid-cols-[7rem_1fr] gap-3">
    <dt class="text-postbox-muted">{label}</dt>
    <dd class="break-all text-postbox-subtle">
      {value}
      <button
        class="ml-2 text-xs font-semibold text-attention-foreground hover:text-attention-foreground/80"
        type="button"
        onclick={startEditing}
      >
        rename
      </button>
    </dd>
  </div>
{/if}
