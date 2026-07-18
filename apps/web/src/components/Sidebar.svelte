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

<aside class="flex h-full min-h-0 w-full shrink-0 flex-col border-b border-postbox-border bg-postbox-surface md:h-full md:max-w-xs md:border-b-0 md:border-r" aria-label="Project and question navigation">
  <header class="border-b border-postbox-border px-4 py-4">
    <div class="flex items-center gap-2">
      <button
        class="font-display text-lg font-bold tracking-wide text-attention transition hover:text-postbox-text"
        title="Show all open questions"
        onclick={showQueue}
      >
        Pi Postbox
      </button>
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
    <!-- Airmail envelope holding notification settings and the decision history shortcut. -->
    <div class="airmail-border rounded-sm shadow-postbox-section">
      <div class="px-3 py-2">
        <NotificationSubscriptionControl />
        <div class="my-2 border-t border-dashed border-postbox-border-strong" aria-hidden="true"></div>
        <button
          class="flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-left text-sm text-postbox-subtle transition hover:bg-postbox-text/5 hover:text-postbox-text {historyActive
            ? 'bg-postbox-text/10 text-postbox-text'
            : ''}"
          onclick={showHistory}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-4 w-4 shrink-0" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
          Decision history
        </button>
      </div>
    </div>
    <p class="px-3 pb-1 text-[10px] text-postbox-muted">v{__APP_VERSION__}</p>
  </footer>
</aside>
