import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPostboxApp } from "../src/app.js";

const apps: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

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

describe("push configuration and subscription routes", () => {
  it("returns configured browser push public key metadata when VAPID keys are supplied", async () => {
    const vapidPublicKey = "BConfiguredStableVapidPublicKey";
    const app = await createPostboxApp({
      databasePath: ":memory:",
      now: () => 1_000,
      vapidPublicKey,
      vapidPrivateKey: "configured-private-key"
    });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/push/config" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      available: true,
      publicKey: vapidPublicKey,
      source: "configured"
    });
  });

  it("generates and persists a browser push public key across restarts using the same database", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-postbox-push-db-"));
    const databasePath = join(dir, "postbox.sqlite");

    try {
      let app = await createPostboxApp({ databasePath, now: () => 1_000 });
      apps.push(app);

      const firstResponse = await app.inject({ method: "GET", url: "/api/push/config" });

      expect(firstResponse.statusCode).toBe(200);
      expect(firstResponse.json()).toMatchObject({
        available: true,
        source: "generated",
        publicKey: expect.any(String)
      });
      const firstPublicKey = firstResponse.json().publicKey;
      expect(typeof firstPublicKey).toBe("string");
      expect(firstPublicKey.length).toBeGreaterThan(0);

      await app.close();
      apps.pop();

      app = await createPostboxApp({ databasePath, now: () => 2_000 });
      apps.push(app);

      const secondResponse = await app.inject({ method: "GET", url: "/api/push/config" });

      expect(secondResponse.statusCode).toBe(200);
      expect(secondResponse.json()).toMatchObject({
        available: true,
        source: "generated",
        publicKey: firstPublicKey
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("upserts and deletes a valid browser push subscription by endpoint", async () => {
    const app = await createPostboxApp({ databasePath: ":memory:", now: () => 1_000 });
    apps.push(app);
    const subscription = validBrowserSubscription();

    const firstSave = await app.inject({ method: "POST", url: "/api/push/subscriptions", payload: subscription });
    const secondSave = await app.inject({ method: "POST", url: "/api/push/subscriptions", payload: subscription });
    const deleted = await app.inject({
      method: "DELETE",
      url: "/api/push/subscriptions",
      payload: { endpoint: subscription.endpoint }
    });

    expect(firstSave.statusCode).toBe(204);
    expect(secondSave.statusCode).toBe(204);
    expect(deleted.statusCode).toBe(204);
  });

  it("rejects malformed browser push subscription payloads", async () => {
    const app = await createPostboxApp({ databasePath: ":memory:", now: () => 1_000 });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/push/subscriptions",
      payload: {
        endpoint: "https://fcm.googleapis.com/fcm/send/missing-auth",
        keys: { p256dh: "BOnlyP256dhIsNotEnough" }
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "invalid_push_subscription" });
  });

  it("rejects non-Web-Push subscription endpoints before persistence", async () => {
    const app = await createPostboxApp({ databasePath: ":memory:", now: () => 1_000 });
    apps.push(app);

    for (const endpoint of [
      "http://fcm.googleapis.com/fcm/send/plain-http",
      "https://localhost/push",
      "https://10.0.0.5/push",
      "https://169.254.1.5/push",
      "https://[::ffff:192.168.1.5]/push",
      "https://[fe80::1]/push"
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/push/subscriptions",
        payload: validBrowserSubscription(endpoint)
      });

      expect(response.statusCode, endpoint).toBe(400);
      expect(response.json()).toMatchObject({ error: "invalid_push_subscription" });
    }
  });
});
