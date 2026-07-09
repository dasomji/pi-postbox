<script lang="ts">
  import { onMount } from "svelte";
  import type { PushConfigResponse } from "@pi-postbox/protocol";
  import { deletePushSubscription, fetchPushConfig, savePushSubscription } from "../api/postboxApi";
  import {
    browserPushIsSupported,
    getCurrentPushSubscription,
    savePushSubscriptionWithBrowserRollback,
    subscribeToBrowserPush,
    unsubscribeFromBrowserPush,
    describePushSubscriptionError,
    type PushNotificationState
  } from "../lib/pushNotifications";

  type NotificationControlState = PushNotificationState | "checking";

  let notificationState = $state<NotificationControlState>("checking");
  let message = $state("Checking notification support…");
  let busy = $state(false);
  let config = $state<PushConfigResponse | null>(null);

  function setState(nextState: NotificationControlState, nextMessage: string): void {
    notificationState = nextState;
    message = nextMessage;
  }

  async function refreshNotificationState(): Promise<void> {
    if (!browserPushIsSupported()) {
      setState("unsupported", "Notifications are unsupported in this browser.");
      return;
    }

    if (Notification.permission === "denied") {
      setState("permission-denied", "Notification permission denied. Re-enable it in your browser settings.");
      return;
    }

    try {
      config = await fetchPushConfig();
    } catch (error) {
      console.warn("Postbox push config check failed", error);
      setState("unavailable", "Notifications are unavailable right now.");
      return;
    }

    if (!config.available) {
      setState("unavailable", config.message ?? "Notifications are unavailable on this Postbox server.");
      return;
    }

    try {
      const subscription = await getCurrentPushSubscription();
      if (subscription) {
        setState("subscribed", "Notifications are subscribed for this device.");
      } else {
        setState("unsubscribed", "Notifications are unsubscribed for this device.");
      }
    } catch (error) {
      console.warn("Postbox push subscription check failed", error);
      setState("unavailable", "Notifications are unavailable right now.");
    }
  }

  async function enableNotifications(): Promise<void> {
    if (busy) return;
    busy = true;

    try {
      if (!browserPushIsSupported()) {
        setState("unsupported", "Notifications are unsupported in this browser.");
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission === "denied") {
        setState("permission-denied", "Notification permission denied. Re-enable it in your browser settings.");
        return;
      }
      if (permission !== "granted") {
        setState("unsubscribed", "Permission was not granted. Tap Enable and choose Allow to subscribe.");
        return;
      }

      const nextConfig = config?.available ? config : await fetchPushConfig();
      config = nextConfig;
      if (!nextConfig.available) {
        setState("unavailable", nextConfig.message ?? "Notifications are unavailable on this Postbox server.");
        return;
      }

      const subscription = await subscribeToBrowserPush(nextConfig.publicKey);
      await savePushSubscriptionWithBrowserRollback(subscription, savePushSubscription);
      setState("subscribed", "Notifications are subscribed for this device.");
    } catch (error) {
      console.warn("Postbox notification subscribe failed", {
        permission: Notification.permission,
        hasServiceWorker: "serviceWorker" in navigator,
        hasPushManager: "PushManager" in window,
        error
      });
      setState("unavailable", describePushSubscriptionError(error));
    } finally {
      busy = false;
    }
  }

  async function disableNotifications(): Promise<void> {
    if (busy) return;
    busy = true;

    try {
      const endpoint = await unsubscribeFromBrowserPush();
      if (endpoint) await deletePushSubscription(endpoint);
      setState("unsubscribed", "Notifications are unsubscribed for this device.");
    } catch (error) {
      console.warn("Postbox notification unsubscribe failed", error);
      setState("unavailable", "Notifications are unavailable right now.");
    } finally {
      busy = false;
    }
  }

  onMount(() => {
    void refreshNotificationState();
  });
</script>

{#if notificationState === "subscribed"}
  <!-- Once notifications are configured, collapse the box to a slim confirmation row. -->
  <div class="flex items-center justify-between gap-2 px-1 py-1" aria-label="Notification settings">
    <p class="flex min-w-0 items-center gap-2 text-xs text-postbox-subtle" role="status" aria-live="polite">
      <span class="h-2 w-2 shrink-0 rounded-full bg-success" aria-hidden="true"></span>
      Notifications on
    </p>
    <button
      type="button"
      class="shrink-0 text-[10px] font-medium text-postbox-muted transition hover:text-attention-foreground disabled:cursor-wait disabled:opacity-60"
      title="Notifications are subscribed for this device. Turn them off."
      disabled={busy}
      onclick={disableNotifications}
    >
      Turn off
    </button>
  </div>
{:else}
<section class="px-1 py-1" aria-label="Notification settings">
  <div class="flex items-start justify-between gap-3">
    <div class="min-w-0">
      <p class="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-attention-foreground">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-3.5 w-3.5 shrink-0" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
        Notifications
      </p>
      <p class="mt-1 text-xs leading-5 text-postbox-subtle" role="status" aria-live="polite">{message}</p>
    </div>
    <span
      class="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full {notificationState === 'permission-denied' || notificationState === 'unavailable' || notificationState === 'unsupported'
        ? 'bg-warning'
        : 'bg-postbox-border-strong'}"
      aria-hidden="true"
    ></span>
  </div>

  {#if notificationState === "unsubscribed"}
    <button
      type="button"
      class="mt-2 w-full rounded-md border border-attention-border bg-attention/10 px-2 py-1.5 text-left text-xs font-medium text-attention-foreground transition hover:bg-attention/15 disabled:cursor-wait disabled:opacity-60"
      disabled={busy}
      onclick={enableNotifications}
    >
      Enable notifications
    </button>
  {:else if notificationState === "permission-denied"}
    <p class="mt-2 text-xs font-medium text-attention-foreground">Permission denied</p>
  {:else if notificationState === "unsupported"}
    <p class="mt-2 text-xs font-medium text-postbox-muted">Unsupported browser</p>
  {:else if notificationState === "unavailable"}
    <p class="mt-2 text-xs font-medium text-postbox-muted">Unavailable</p>
  {/if}
</section>
{/if}
