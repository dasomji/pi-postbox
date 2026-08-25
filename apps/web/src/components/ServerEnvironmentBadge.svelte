<script lang="ts">
  import { store } from "../lib/store.svelte";

  const developmentProfile = $derived(
    store.connection.status === "connected" && store.connection.health.profile.kind === "development"
      ? store.connection.health.profile
      : undefined
  );
</script>

{#if developmentProfile}
  <span
    class="inline-flex items-center rounded-md border border-warning-border bg-warning/10 px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-warning-foreground"
    title={`Development server · ${developmentProfile.id}`}
  >
    Development server
  </span>
{/if}
