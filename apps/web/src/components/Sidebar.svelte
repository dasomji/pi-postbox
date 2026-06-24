<script lang="ts">
  import { store } from "../lib/store.svelte";
  import ConnectionBadge from "./ConnectionBadge.svelte";
  import ProjectIcon from "./ProjectIcon.svelte";
  import SidebarSession from "./SidebarSession.svelte";

  const projects = $derived(store.projects);
  const historyActive = $derived(store.selection.kind === "history");
</script>

<aside class="flex h-full min-h-0 w-full shrink-0 flex-col border-b border-postbox-border bg-postbox-surface/60 md:h-full md:max-w-xs md:border-b-0 md:border-r">
  <header class="border-b border-postbox-border px-4 py-4">
    <div class="flex items-baseline gap-2">
      <p class="text-xs font-semibold uppercase tracking-[0.3em] text-attention-foreground">Pi Postbox</p>
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
        <section class="mb-4">
          <div class="flex items-center gap-2 px-3 pb-1.5">
            <ProjectIcon name={project.projectName} icon={project.projectIcon} size="sm" />
            <h2 class="min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wide text-postbox-muted">
              {project.projectName}
            </h2>
          </div>
          <ul class="space-y-0.5">
            {#each project.sessions as session (session.sessionId)}
              <SidebarSession {session} />
            {/each}
          </ul>
        </section>
      {/each}
    {/if}
  </div>

  <footer class="border-t border-postbox-border px-2 py-2">
    <button
      class="w-full rounded-lg px-3 py-2 text-left text-sm text-postbox-subtle transition hover:bg-white/5 {historyActive
        ? 'bg-white/10 text-postbox-text'
        : ''}"
      onclick={() => store.showHistory()}
    >
      Decision history
    </button>
  </footer>
</aside>
