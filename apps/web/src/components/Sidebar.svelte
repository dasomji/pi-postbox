<script lang="ts">
  import { store } from "../lib/store.svelte";
  import ConnectionBadge from "./ConnectionBadge.svelte";
  import NotificationSubscriptionControl from "./NotificationSubscriptionControl.svelte";
  import PwaInstallButton from "./PwaInstallButton.svelte";
  import SidebarProject from "./SidebarProject.svelte";

  let { onNavigate }: { onNavigate?: () => void } = $props();

  const projects = $derived(store.projects);
  const historyActive = $derived(store.selection.kind === "history");

  function showHistory(): void {
    store.showHistory();
    onNavigate?.();
  }

  function showQueue(): void {
    store.clearSelection();
    onNavigate?.();
  }
</script>

<aside class="flex h-full min-h-0 w-full shrink-0 flex-col border-b border-postbox-border bg-postbox-surface/60 md:h-full md:max-w-xs md:border-b-0 md:border-r">
  <header class="border-b border-postbox-border px-4 py-4">
    <div class="flex items-baseline gap-2">
      <button
        class="text-xs font-semibold uppercase tracking-[0.3em] text-attention-foreground transition hover:text-postbox-text"
        title="Show all open questions"
        onclick={showQueue}
      >
        Pi Postbox
      </button>
      <span class="rounded-full bg-attention/15 px-1.5 py-0.5 text-[10px] font-medium text-attention-foreground">v{__APP_VERSION__}</span>
    </div>
    <div class="mt-2">
      <ConnectionBadge />
    </div>
  </header>

  <div class="min-h-0 flex-1 overflow-y-auto px-2 py-3">
    {#if store.snapshot.status === "loading"}
      <p class="px-3 py-6 text-sm text-postbox-muted">Loading sessions…</p>
    {:else if store.snapshot.status === "error"}
      <p class="px-3 py-6 text-sm text-danger-foreground">{store.snapshot.message}</p>
    {:else if projects.length === 0}
      <p class="px-3 py-6 text-sm text-postbox-muted">
        No active Pi sessions. Start Pi with the Postbox extension configured to this server.
      </p>
    {:else}
      {#each projects as project (project.projectId)}
        <SidebarProject {project} {onNavigate} />
      {/each}
    {/if}
  </div>

  <footer class="space-y-2 border-t border-postbox-border px-2 py-2">
    <PwaInstallButton />
    <NotificationSubscriptionControl />
    <button
      class="w-full rounded-lg px-3 py-2 text-left text-sm text-postbox-subtle transition hover:bg-white/5 {historyActive
        ? 'bg-white/10 text-postbox-text'
        : ''}"
      onclick={showHistory}
    >
      Decision history
    </button>
  </footer>
</aside>
