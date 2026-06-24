import { afterEach, describe, expect, it, vi } from "vitest";
import type { PushSubscriptionPayload } from "@pi-postbox/protocol";
import {
  browserPushIsSupported,
  describePushSubscriptionError,
  getCurrentPushSubscription,
  savePushSubscriptionWithBrowserRollback,
  subscribeToBrowserPush,
  toPushSubscriptionPayload,
  unsubscribeFromBrowserPush
} from "./pushNotifications";

const payload: PushSubscriptionPayload = {
  endpoint: "https://push.example/subscription/1",
  expirationTime: null,
  keys: {
    p256dh: "p256dh-key",
    auth: "auth-key"
  }
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function browserSubscription(subscriptionPayload: PushSubscriptionPayload, unsubscribe = vi.fn(async () => true)): PushSubscription {
  return {
    endpoint: subscriptionPayload.endpoint,
    expirationTime: subscriptionPayload.expirationTime,
    options: { userVisibleOnly: true },
    getKey: vi.fn(),
    toJSON: () => subscriptionPayload,
    unsubscribe
  } as unknown as PushSubscription;
}

function stubServiceWorkerReady(pushManager: Partial<PushManager>): void {
  vi.stubGlobal("navigator", {
    serviceWorker: {
      ready: Promise.resolve({ pushManager })
    }
  });
}

describe("push notification browser capability helpers", () => {
  it("reports browser push support only when Notification, PushManager, and service workers are available", () => {
    expect(browserPushIsSupported()).toBe(false);

    vi.stubGlobal("window", { Notification: vi.fn(), PushManager: vi.fn() });
    vi.stubGlobal("navigator", { serviceWorker: {} });
    expect(browserPushIsSupported()).toBe(true);

    vi.stubGlobal("window", { Notification: vi.fn() });
    expect(browserPushIsSupported()).toBe(false);
  });

  it("reads the current browser push subscription from the ready service worker registration", async () => {
    const subscription = browserSubscription(payload);
    const getSubscription = vi.fn(async () => subscription);
    stubServiceWorkerReady({ getSubscription } as Partial<PushManager>);

    await expect(getCurrentPushSubscription()).resolves.toBe(subscription);

    expect(getSubscription).toHaveBeenCalledOnce();
  });

  it("subscribes through PushManager with user-visible notifications and the decoded VAPID public key", async () => {
    const subscription = browserSubscription(payload);
    const subscribe = vi.fn<(options: PushSubscriptionOptionsInit) => Promise<PushSubscription>>(async () => subscription);
    stubServiceWorkerReady({ subscribe } as Partial<PushManager>);

    await expect(subscribeToBrowserPush("AQIDBA")).resolves.toEqual(payload);

    expect(subscribe).toHaveBeenCalledOnce();
    const options = subscribe.mock.calls[0]?.[0] as PushSubscriptionOptionsInit;
    expect(options.userVisibleOnly).toBe(true);
    expect(options.applicationServerKey).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("unsubscribes the current browser subscription and returns the endpoint for server deletion", async () => {
    const unsubscribe = vi.fn(async () => true);
    const subscription = browserSubscription(payload, unsubscribe);
    const getSubscription = vi.fn(async () => subscription);
    stubServiceWorkerReady({ getSubscription } as Partial<PushManager>);

    await expect(unsubscribeFromBrowserPush()).resolves.toBe(payload.endpoint);

    expect(getSubscription).toHaveBeenCalledOnce();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("returns null when disabling notifications and the browser has no current subscription", async () => {
    const getSubscription = vi.fn(async () => null);
    stubServiceWorkerReady({ getSubscription } as Partial<PushManager>);

    await expect(unsubscribeFromBrowserPush()).resolves.toBeNull();
  });

  it("rejects browser subscription objects that omit endpoint or Web Push keys", () => {
    expect(() =>
      toPushSubscriptionPayload(
        browserSubscription({
          endpoint: "",
          expirationTime: null,
          keys: { p256dh: "", auth: "" }
        })
      )
    ).toThrow("Browser push subscription is unavailable or unsupported.");
  });
});

describe("push subscription error messages", () => {
  it("explains blocked permissions separately from generic unavailability", () => {
    expect(describePushSubscriptionError(new DOMException("Registration failed - permission denied", "NotAllowedError"))).toBe(
      "Browser blocked the push subscription. Check notification permission and try again."
    );
  });

  it("explains service worker readiness errors", () => {
    expect(describePushSubscriptionError(new Error("Service worker registration is not ready"))).toBe(
      "Service worker is not ready yet. Close and reopen the installed app, then try again."
    );
  });

  it("falls back to a generic unavailable message for unknown errors", () => {
    expect(describePushSubscriptionError(new Error("network exploded"))).toBe("Notifications are unavailable right now.");
  });
});

describe("push notification subscription save rollback", () => {
  it("unsubscribes the browser subscription when the server save fails", async () => {
    const saveError = new Error("server unavailable");
    const saveSubscription = vi.fn<() => Promise<void>>().mockRejectedValue(saveError);
    const rollbackSubscription = vi.fn<() => Promise<string | null>>().mockResolvedValue(payload.endpoint);

    await expect(savePushSubscriptionWithBrowserRollback(payload, saveSubscription, rollbackSubscription)).rejects.toThrow(saveError);

    expect(saveSubscription).toHaveBeenCalledWith(payload);
    expect(rollbackSubscription).toHaveBeenCalledOnce();
  });

  it("does not rollback when the server save succeeds", async () => {
    const saveSubscription = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const rollbackSubscription = vi.fn<() => Promise<string | null>>().mockResolvedValue(payload.endpoint);

    await savePushSubscriptionWithBrowserRollback(payload, saveSubscription, rollbackSubscription);

    expect(rollbackSubscription).not.toHaveBeenCalled();
  });
});
