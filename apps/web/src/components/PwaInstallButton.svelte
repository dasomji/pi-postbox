<script lang="ts">
  import { onMount } from "svelte";

  type InstallOutcome = "accepted" | "dismissed";

  type BeforeInstallPromptEvent = Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: InstallOutcome; platform?: string }>;
  };

  let installPrompt = $state<BeforeInstallPromptEvent | null>(null);
  let isStandalone = $state(false);
  let outcome = $state<InstallOutcome | null>(null);
  let busy = $state(false);

  const canInstall = $derived(installPrompt !== null && outcome === null);

  function isIosStandalone(): boolean {
    return "standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  }

  function detectStandaloneMode(displayModeQuery: MediaQueryList): boolean {
    return displayModeQuery.matches || isIosStandalone();
  }

  async function installApp(): Promise<void> {
    if (!installPrompt || busy || isStandalone) return;

    busy = true;
    const promptEvent = installPrompt;

    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      outcome = choice.outcome;
      installPrompt = null;
    } catch (error) {
      console.warn("Postbox install prompt failed", error);
      outcome = "dismissed";
      installPrompt = null;
    } finally {
      busy = false;
    }
  }

  onMount(() => {
    const displayModeQuery = window.matchMedia("(display-mode: standalone)");
    const refreshStandaloneMode = (): void => {
      isStandalone = detectStandaloneMode(displayModeQuery);
      if (isStandalone) installPrompt = null;
    };

    // The beforeinstallprompt event is saved after preventDefault() so install only starts from the button click.
    const handleBeforeInstallPrompt = (event: Event): void => {
      event.preventDefault();
      if (isStandalone) return;
      outcome = null;
      installPrompt = event as BeforeInstallPromptEvent;
    };

    refreshStandaloneMode();
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    displayModeQuery.addEventListener("change", refreshStandaloneMode);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      displayModeQuery.removeEventListener("change", refreshStandaloneMode);
    };
  });
</script>

{#if canInstall && !isStandalone}
  <section class="rounded-lg border border-attention-border bg-attention/10 px-3 py-2" aria-label="Install app">
    <p class="text-xs font-semibold uppercase tracking-wide text-attention-foreground">Install app</p>
    <p class="mt-1 text-xs leading-5 text-postbox-subtle">Add Pi Postbox to this device for a standalone app window.</p>
    <button
      type="button"
      class="mt-2 w-full rounded-md border border-attention-border bg-attention/15 px-2 py-1.5 text-left text-xs font-medium text-attention-foreground transition hover:bg-attention/20 disabled:cursor-wait disabled:opacity-60"
      disabled={busy}
      onclick={installApp}
    >
      Install Pi Postbox
    </button>
  </section>
{:else if !isStandalone && outcome === "dismissed"}
  <p class="px-3 py-1 text-xs text-postbox-muted" role="status" aria-live="polite">Install prompt dismissed.</p>
{:else if !isStandalone && outcome === "accepted"}
  <p class="px-3 py-1 text-xs text-postbox-muted" role="status" aria-live="polite">Install prompt accepted.</p>
{/if}
