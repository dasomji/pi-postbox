import type { PushSubscriptionPayload } from "@pi-postbox/protocol";

export type PushNotificationState = "unsupported" | "unavailable" | "permission-denied" | "subscribed" | "unsubscribed";

export function describePushSubscriptionError(error: unknown): string {
  const name = error instanceof DOMException || error instanceof Error ? error.name : "";
  const message = error instanceof DOMException || error instanceof Error ? error.message : "";
  const detail = `${name} ${message}`.toLowerCase();

  if (detail.includes("notallowed") || detail.includes("permission") || detail.includes("denied")) {
    return "Browser blocked the push subscription. Check notification permission and try again.";
  }

  if (detail.includes("abort")) {
    return "Browser push subscription was interrupted. Try again in a moment.";
  }

  if (detail.includes("service worker") || detail.includes("registration")) {
    return "Service worker is not ready yet. Close and reopen the installed app, then try again.";
  }

  if (detail.includes("push") || detail.includes("subscription") || detail.includes("unsupported")) {
    return "This browser could not create a push subscription for Postbox.";
  }

  return "Notifications are unavailable right now.";
}

export function browserPushIsSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "Notification" in window &&
    "PushManager" in window &&
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator
  );
}

export async function getCurrentPushSubscription(): Promise<PushSubscription | null> {
  const registration: ServiceWorkerRegistration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

export async function subscribeToBrowserPush(publicKey: string): Promise<PushSubscriptionPayload> {
  const registration: ServiceWorkerRegistration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey)
  });

  return toPushSubscriptionPayload(subscription);
}

export async function savePushSubscriptionWithBrowserRollback(
  subscription: PushSubscriptionPayload,
  saveSubscription: (subscription: PushSubscriptionPayload) => Promise<void>,
  rollbackSubscription: () => Promise<string | null> = unsubscribeFromBrowserPush
): Promise<void> {
  try {
    await saveSubscription(subscription);
  } catch (error) {
    try {
      await rollbackSubscription();
    } catch (rollbackError) {
      console.warn("Postbox push subscription rollback failed", rollbackError);
    }
    throw error;
  }
}

export async function unsubscribeFromBrowserPush(): Promise<string | null> {
  const registration: ServiceWorkerRegistration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return null;

  const { endpoint } = subscription;
  await subscription.unsubscribe();
  return endpoint;
}

export function toPushSubscriptionPayload(subscription: PushSubscription): PushSubscriptionPayload {
  const json = subscription.toJSON() as PushSubscriptionJSON & {
    keys?: {
      p256dh?: string;
      auth?: string;
    };
  };
  const endpoint = json.endpoint ?? subscription.endpoint;
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;

  if (!endpoint || !p256dh || !auth) {
    throw new Error("Browser push subscription is unavailable or unsupported.");
  }

  return {
    endpoint,
    expirationTime: json.expirationTime ?? subscription.expirationTime ?? null,
    keys: { p256dh, auth }
  };
}

export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = `${base64String}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const output = new Uint8Array(new ArrayBuffer(rawData.length));

  for (let index = 0; index < rawData.length; index += 1) {
    output[index] = rawData.charCodeAt(index);
  }

  return output;
}
