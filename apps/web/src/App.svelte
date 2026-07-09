<script lang="ts">
  import { onMount } from "svelte";
  import { store } from "./lib/store.svelte";
  import { modalFocus } from "./lib/modalFocus";
  import DevMockToggle from "./components/DevMockToggle.svelte";
  import MainView from "./components/MainView.svelte";
  import Sidebar from "./components/Sidebar.svelte";

  let mobileNavigationOpen = $state(false);
  let mobileNavigationOpener = $state<HTMLElement | null>(null);

  function openMobileNavigation(event: MouseEvent): void {
    mobileNavigationOpener = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    mobileNavigationOpen = true;
  }

  function closeMobileNavigation(): void {
    mobileNavigationOpen = false;
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && mobileNavigationOpen) mobileNavigationOpen = false;
  }

  onMount(() => store.start());
</script>

<svelte:window {onkeydown} />

<div class="flex h-full w-full flex-col overflow-hidden bg-postbox-canvas text-postbox-text md:flex-row">
  <div class="flex shrink-0 items-center gap-3 border-b border-postbox-border bg-postbox-surface/80 px-4 py-3 md:hidden">
    <button
      type="button"
      class="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-postbox-border text-postbox-subtle transition hover:border-attention-border hover:text-attention-foreground md:hidden"
      aria-label="Open navigation"
      aria-controls="mobile-sidebar"
      aria-expanded={mobileNavigationOpen}
      onclick={openMobileNavigation}
    >
      ☰
    </button>
    <button
      type="button"
      class="font-display text-base font-bold tracking-wide text-attention transition hover:text-postbox-text"
      title="Show all open questions"
      onclick={() => store.clearSelection()}
    >
      Pi Postbox
    </button>
  </div>

  <div class="hidden md:flex md:h-full md:w-80 md:shrink-0">
    <Sidebar />
  </div>

  {#if mobileNavigationOpen}
    <div
      class="fixed inset-0 z-50 md:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Navigation"
      tabindex="-1"
      use:modalFocus={mobileNavigationOpener}
    >
      <button
        class="absolute inset-0 cursor-default bg-black/30 backdrop-blur-sm"
        aria-label="Close navigation"
        tabindex="-1"
        onclick={closeMobileNavigation}
      ></button>
      <div id="mobile-sidebar" class="relative h-full w-[min(22rem,85vw)] shadow-postbox-panel">
        <Sidebar onNavigate={closeMobileNavigation} />
        <button
          type="button"
          class="absolute right-3 top-3 rounded-full px-3 py-2 text-postbox-muted transition hover:text-postbox-text"
          aria-label="Close navigation"
          data-modal-initial-focus
          onclick={closeMobileNavigation}
        >
          ✕
        </button>
      </div>
    </div>
  {/if}

  <MainView />
  {#if import.meta.env.DEV}
    <DevMockToggle />
  {/if}
</div>
