import { afterEach, describe, expect, it, vi } from "vitest";
import type { PushConfigResponse, PushSubscriptionPayload } from "@pi-postbox/protocol";
import * as postboxApi from "./postboxApi";

type ExpectedPushApi = {
  fetchPushConfig: () => Promise<PushConfigResponse>;
  savePushSubscription: (subscription: PushSubscriptionPayload) => Promise<void>;
  deletePushSubscription: (endpoint: string) => Promise<void>;
};

const apiExports = postboxApi as Record<string, unknown>;

function requiredApiFunction<Name extends keyof ExpectedPushApi>(name: Name): ExpectedPushApi[Name] {
  const value = apiExports[name];
  expect(typeof value, `postboxApi should export ${name} for the client notification UI`).toBe("function");
  return value as ExpectedPushApi[Name];
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function validBrowserSubscription(): PushSubscriptionPayload {
  return {
    endpoint: "https://fcm.googleapis.com/fcm/send/client-ui-test-token",
    expirationTime: null,
    keys: {
      p256dh: "BOrxZmjQ9JZ-8zsgVfZ0CHi2uGgZl6vPPx3uD-EXAMPLEp256dhKey",
      auth: "BTBZMqHH6r4Tts7J_aSIgg"
    }
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("client push API helpers", () => {
  it("exports focused helpers for browser push config, subscription save, and subscription delete", () => {
    expect({
      fetchPushConfig: typeof apiExports.fetchPushConfig,
      savePushSubscription: typeof apiExports.savePushSubscription,
      deletePushSubscription: typeof apiExports.deletePushSubscription
    }).toEqual({
      fetchPushConfig: "function",
      savePushSubscription: "function",
      deletePushSubscription: "function"
    });
  });

  it("fetches /api/push/config and returns the parsed browser push config", async () => {
    const fetchPushConfig = requiredApiFunction("fetchPushConfig");
    const config: PushConfigResponse = {
      available: true,
      publicKey: "BClientUiVapidPublicKey",
      source: "generated"
    };
    const fetchMock = vi.fn(async () => jsonResponse(config));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchPushConfig()).resolves.toEqual(config);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/push/config");
  });

  it("POSTs the browser PushSubscription JSON to /api/push/subscriptions", async () => {
    const savePushSubscription = requiredApiFunction("savePushSubscription");
    const subscription = validBrowserSubscription();
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(savePushSubscription(subscription)).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/api/push/subscriptions");
    expect(init).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subscription)
    });
  });

  it("DELETEs the subscription endpoint from /api/push/subscriptions", async () => {
    const deletePushSubscription = requiredApiFunction("deletePushSubscription");
    const endpoint = validBrowserSubscription().endpoint;
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(deletePushSubscription(endpoint)).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/api/push/subscriptions");
    expect(init).toMatchObject({
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint })
    });
  });
});
