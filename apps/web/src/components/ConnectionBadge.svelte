<script lang="ts">
  import { store } from "../lib/store.svelte";

  const connection = $derived(store.connection);
</script>

{#if connection.status === "checking"}
  <span class="inline-block rounded-full bg-white/10 px-3 py-1 text-xs text-postbox-subtle">Checking server…</span>
{:else if connection.status === "connected"}
  <span class="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-3 py-1 text-xs text-success-foreground ring-1 ring-success/30">
    <span class="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
    Connected · protocol {connection.health.protocolVersion}
  </span>
{:else}
  <span class="inline-block rounded-full bg-warning/10 px-3 py-1 text-xs text-warning-foreground ring-1 ring-warning/30">
    Server unavailable
  </span>
{/if}
