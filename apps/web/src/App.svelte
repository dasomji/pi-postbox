<script lang="ts">
  import { onMount } from "svelte";
  import { store } from "./lib/store.svelte";
  import DevMockToggle from "./components/DevMockToggle.svelte";
  import MainView from "./components/MainView.svelte";
  import Sidebar from "./components/Sidebar.svelte";

  onMount(() => store.start());
</script>

<div class="flex h-full w-full overflow-hidden bg-postbox-canvas text-postbox-text">
  <Sidebar />
  <MainView />
  {#if import.meta.env.DEV}
    <DevMockToggle />
  {/if}
</div>
