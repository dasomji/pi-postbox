<script lang="ts">
  import { store } from "../lib/store.svelte";

  const connection = $derived(store.connection);
  const label = $derived(
    connection.status === "checking"
      ? "Checking server…"
      : connection.status === "connected"
        ? `Connected · protocol ${connection.health.protocolVersion}`
        : "Server unavailable"
  );
</script>

<span
  class="inline-block h-2 w-2 shrink-0 rounded-full {connection.status === 'connected'
    ? 'bg-success'
    : connection.status === 'checking'
      ? 'animate-pulse bg-postbox-border-strong'
      : 'bg-warning'}"
  role="status"
  title={label}
  aria-label={label}
></span>
