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

<section class="rounded-lg border border-postbox-border bg-white/[0.03] px-3 py-2" aria-label="Notification settings">
  <div class="flex items-start justify-between gap-3">
    <div class="min-w-0">
      <p class="text-xs font-semibold uppercase tracking-wide text-postbox-muted">Notifications</p>
      <p class="mt-1 text-xs leading-5 text-postbox-subtle" role="status" aria-live="polite">{message}</p>
    </div>
    <span
      class="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full {notificationState === 'subscribed'
        ? 'bg-success'
        : notificationState === 'permission-denied' || notificationState === 'unavailable' || notificationState === 'unsupported'
          ? 'bg-warning'
          : 'bg-postbox-border-strong'}"
      aria-hidden="true"
    ></span>
  </div>

  {#if notificationState === "subscribed"}
    <button
      type="button"
      class="mt-2 w-full rounded-md border border-postbox-border px-2 py-1.5 text-left text-xs font-medium text-postbox-subtle transition hover:border-attention-border hover:text-postbox-text disabled:cursor-wait disabled:opacity-60"
      disabled={busy}
      onclick={disableNotifications}
    >
      Turn off notifications
    </button>
  {:else if notificationState === "unsubscribed"}
    <button
      type="button"
      class="mt-2 w-full rounded-md border border-attention-border bg-attention/10 px-2 py-1.5 text-left text-xs font-medium text-attention-foreground transition hover:bg-attention/15 disabled:cursor-wait disabled:opacity-60"
      disabled={busy}
      onclick={enableNotifications}
    >
      Enable notifications
    </button>
  {:else if notificationState === "permission-denied"}
    <p class="mt-2 text-xs font-medium text-warning-foreground">Permission denied</p>
  {:else if notificationState === "unsupported"}
    <p class="mt-2 text-xs font-medium text-postbox-muted">Unsupported browser</p>
  {:else if notificationState === "unavailable"}
    <p class="mt-2 text-xs font-medium text-postbox-muted">Unavailable</p>
  {/if}
</section>
