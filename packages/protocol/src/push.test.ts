import { describe, expect, it } from "vitest";
import * as Protocol from "./index.js";

interface SchemaLike<T = unknown> {
  parse: (value: unknown) => T;
  safeParse: (value: unknown) => { success: boolean };
}

const protocol = Protocol as typeof Protocol & {
  PushConfigResponseSchema?: SchemaLike;
  PushSubscriptionPayloadSchema?: SchemaLike;
};

function validBrowserSubscription(endpoint = "https://fcm.googleapis.com/fcm/send/test-endpoint-token") {
  return {
    endpoint,
    expirationTime: null,
    keys: {
      p256dh: "BOrxZmjQ9JZ-8zsgVfZ0CHi2uGgZl6vPPx3uD-EXAMPLEp256dhKey",
      auth: "BTBZMqHH6r4Tts7J_aSIgg"
    }
  };
}

describe("Postbox push protocol", () => {
  it("validates the public push config response exposed to browsers", () => {
    expect(protocol.PushConfigResponseSchema, "PushConfigResponseSchema should be exported from @pi-postbox/protocol").toBeDefined();

    expect(
      protocol.PushConfigResponseSchema!.parse({
        available: true,
        publicKey: "BExampleStableVapidPublicKey",
        source: "generated"
      })
    ).toEqual({
      available: true,
      publicKey: "BExampleStableVapidPublicKey",
      source: "generated"
    });
  });

  it("validates browser push subscription payloads and rejects malformed subscriptions", () => {
    expect(
      protocol.PushSubscriptionPayloadSchema,
      "PushSubscriptionPayloadSchema should be exported from @pi-postbox/protocol"
    ).toBeDefined();

    expect(protocol.PushSubscriptionPayloadSchema!.parse(validBrowserSubscription())).toEqual(validBrowserSubscription());
    expect(
      protocol.PushSubscriptionPayloadSchema!.safeParse({
        endpoint: "https://fcm.googleapis.com/fcm/send/missing-auth",
        keys: { p256dh: "BOnlyP256dhIsNotEnough" }
      }).success
    ).toBe(false);
  });

  it("rejects non-Web-Push subscription endpoints", () => {
    expect(
      protocol.PushSubscriptionPayloadSchema,
      "PushSubscriptionPayloadSchema should be exported from @pi-postbox/protocol"
    ).toBeDefined();

    for (const endpoint of [
      "http://fcm.googleapis.com/fcm/send/plain-http",
      "https://localhost/push",
      "https://localhost./push",
      "https://foo.localhost./push",
      "https://127.0.0.1/push",
      "https://10.0.0.5/push",
      "https://172.16.0.5/push",
      "https://192.168.1.5/push",
      "https://169.254.1.5/push",
      "https://[::]/push",
      "https://[::1]/push",
      "https://[::192.168.1.5]/push",
      "https://[::ffff:192.168.1.5]/push",
      "https://[fe80::1]/push",
      "https://[fd00::1]/push"
    ]) {
      expect(protocol.PushSubscriptionPayloadSchema!.safeParse(validBrowserSubscription(endpoint)).success, endpoint).toBe(false);
    }
  });
});
