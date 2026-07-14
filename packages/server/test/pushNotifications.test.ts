import type { PushSubscriptionPayload, ExtensionClientMessage } from "@pi-postbox/protocol";
import type { FastifyInstance } from "fastify";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { createPostboxApp } from "../src/app.js";
import { openPostboxDatabase } from "../src/db/database.js";
import { PushStore } from "../src/services/pushStore.js";

const apps: Array<{ close: () => Promise<void> }> = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
  }
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.restoreAllMocks();
});

function listenerPort(app: FastifyInstance): number {
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP listener");
  return address.port;
}

function validBrowserSubscription(endpoint = "https://fcm.googleapis.com/fcm/send/active-endpoint-token"): PushSubscriptionPayload {
  return {
    endpoint,
    expirationTime: null,
    keys: {
      p256dh: "BOrxZmjQ9JZ-8zsgVfZ0CHi2uGgZl6vPPx3uD-EXAMPLEp256dhKey",
      auth: "BTBZMqHH6r4Tts7J_aSIgg"
    }
  };
}

function seedStoredSubscription(databasePath: string, subscription: PushSubscriptionPayload): void {
  const db = openPostboxDatabase(databasePath);
  const nowIso = new Date(1_000).toISOString();
  try {
    db.prepare(
      `INSERT INTO push_subscriptions (endpoint, expiration_time, p256dh, auth, subscription_json, created_at, updated_at)
       VALUES (@endpoint, @expirationTime, @p256dh, @auth, @subscriptionJson, @nowIso, @nowIso)`
    ).run({
      endpoint: subscription.endpoint,
      expirationTime: subscription.expirationTime ?? null,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      subscriptionJson: JSON.stringify(subscription),
      nowIso
    });
  } finally {
    db.close();
  }
}

function registrationMessage(): ExtensionClientMessage {
  return {
    type: "session.register",
    requestId: "register-1",
    payload: {
      machine: { machineId: "machine-1", hostname: "workstation" },
      project: { projectId: "project-1", name: "pi-postbox", cwd: "/repo", branch: "main" },
      session: { sessionId: "session-1", title: "Answer loop", cwd: "/repo", branch: "main", semanticState: "working" }
    }
  };
}

function askCreateMessage(requestId: string, prompt: string): ExtensionClientMessage {
  return {
    type: "ask.create",
    requestId: `wire-${requestId}`,
    payload: {
      requestId,
      sessionId: "session-1",
      mode: "single",
      question: { prompt },
      options: [
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" }
      ]
    }
  };
}

async function createAppWithPushSender(pushSender: { sendNotification: ReturnType<typeof vi.fn> }): Promise<FastifyInstance> {
  const options = {
    databasePath: ":memory:",
    now: () => 1_000,
    vapidPublicKey: "BTestConfiguredVapidPublicKey",
    vapidPrivateKey: "test-configured-private-key",
    pushSender
  } as Parameters<typeof createPostboxApp>[0] & { pushSender: typeof pushSender };
  const app = await createPostboxApp(options);
  apps.push(app);
  return app;
}

async function connectAndRegister(app: FastifyInstance): Promise<WebSocket> {
  await app.listen({ host: "127.0.0.1", port: 0 });
  const socket = new WebSocket(`ws://127.0.0.1:${listenerPort(app)}/api/extension/ws`);
  sockets.push(socket);

  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });

  const registered = nextMessage(socket);
  socket.send(JSON.stringify(registrationMessage()));
  await expect(registered).resolves.toMatchObject({ type: "registered" });

  return socket;
}

async function saveSubscription(app: FastifyInstance, subscription: PushSubscriptionPayload): Promise<void> {
  const response = await app.inject({ method: "POST", url: "/api/push/subscriptions", payload: subscription });
  expect(response.statusCode).toBe(204);
}

async function createAsk(socket: WebSocket, requestId: string, prompt: string): Promise<void> {
  const created = nextMessage(socket);
  socket.send(JSON.stringify(askCreateMessage(requestId, prompt)));
  await expect(created).resolves.toMatchObject({ type: "ask.created", payload: { requestId, status: "pending" } });
}

function nextMessage(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    socket.once("message", (raw) => resolve(JSON.parse(raw.toString())));
    socket.once("error", reject);
  });
}

async function waitForExpect(assertion: () => void, timeoutMs = 500): Promise<void> {
  const start = Date.now();
  let lastError: unknown;

  while (Date.now() - start < timeoutMs) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  if (lastError) throw lastError;
  assertion();
}

function parseNotificationPayload(sendNotification: ReturnType<typeof vi.fn>, callIndex = 0): unknown {
  const payload = sendNotification.mock.calls[callIndex]?.[1];
  expect(typeof payload).toBe("string");
  return JSON.parse(payload as string) as unknown;
}

describe("new pending ask push notifications", () => {
  it("fans out a new pending ask notification to subscriptions with project/session context and without prompt text", async () => {
    const sendNotification = vi.fn(async () => undefined);
    const app = await createAppWithPushSender({ sendNotification });
    const subscription = validBrowserSubscription();
    await saveSubscription(app, subscription);
    const socket = await connectAndRegister(app);
    const secretPrompt = "SECRET prompt text should never be sent to push services";

    await createAsk(socket, "ask-notify-1", secretPrompt);

    await waitForExpect(() => expect(sendNotification).toHaveBeenCalledTimes(1));
    expect(sendNotification.mock.calls[0]?.[0]).toMatchObject({ endpoint: subscription.endpoint, keys: subscription.keys });
    expect(sendNotification.mock.calls[0]?.[2]).toEqual({
      vapidDetails: {
        subject: "mailto:pi-postbox@example.invalid",
        publicKey: "BTestConfiguredVapidPublicKey",
        privateKey: "test-configured-private-key"
      }
    });

    const payload = parseNotificationPayload(sendNotification);
    const serializedPayload = JSON.stringify(payload);
    expect(payload).toMatchObject({
      title: expect.any(String),
      body: expect.any(String),
      data: expect.objectContaining({ requestId: "ask-notify-1", sessionId: "session-1" })
    });
    expect(serializedPayload).toContain("pi-postbox");
    expect(serializedPayload).toContain("Answer loop");
    expect(serializedPayload).not.toContain(secretPrompt);
    expect(serializedPayload).not.toContain("SECRET");
  });

  it("sends generated persisted VAPID details when no configured keys are supplied", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-postbox-push-db-"));
    const databasePath = join(dir, "postbox.sqlite");

    try {
      const sendNotification = vi.fn(async () => undefined);
      const app = await createPostboxApp({ databasePath, now: () => 1_000, pushSender: { sendNotification } });
      apps.push(app);
      const configResponse = await app.inject({ method: "GET", url: "/api/push/config" });
      const config = configResponse.json() as { publicKey: string; source: string };
      await saveSubscription(app, validBrowserSubscription());
      const socket = await connectAndRegister(app);

      await createAsk(socket, "ask-generated-vapid", "Generated VAPID details should be used for fanout.");

      await waitForExpect(() => expect(sendNotification).toHaveBeenCalledTimes(1));
      expect(configResponse.statusCode).toBe(200);
      expect(config.source).toBe("generated");
      expect(sendNotification.mock.calls[0]?.[2]).toEqual({
        vapidDetails: {
          subject: "mailto:pi-postbox@example.invalid",
          publicKey: config.publicKey,
          privateKey: expect.any(String)
        }
      });
      expect((sendNotification.mock.calls[0]?.[2] as { vapidDetails?: { privateKey?: string } } | undefined)?.vapidDetails?.privateKey).not.toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not send a second notification for an idempotent duplicate requestId", async () => {
    const sendNotification = vi.fn(async () => undefined);
    const app = await createAppWithPushSender({ sendNotification });
    await saveSubscription(app, validBrowserSubscription());
    const socket = await connectAndRegister(app);
    const prompt = "Only the first create for this requestId should notify.";

    await createAsk(socket, "ask-duplicate", prompt);
    await waitForExpect(() => expect(sendNotification).toHaveBeenCalledTimes(1));

    await createAsk(socket, "ask-duplicate", prompt);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it("skips previously persisted subscriptions with non-Web-Push endpoints before notification fanout", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-postbox-push-db-"));
    const databasePath = join(dir, "postbox.sqlite");

    try {
      const invalidLocalSubscription = validBrowserSubscription("https://127.0.0.1/push");
      const activeSubscription = validBrowserSubscription("https://fcm.googleapis.com/fcm/send/active-endpoint-token");
      seedStoredSubscription(databasePath, invalidLocalSubscription);

      const sendNotification = vi.fn(async () => undefined);
      const app = await createPostboxApp({
        databasePath,
        now: () => 1_000,
        vapidPublicKey: "BTestConfiguredVapidPublicKey",
        vapidPrivateKey: "test-configured-private-key",
        pushSender: { sendNotification }
      });
      apps.push(app);
      await saveSubscription(app, activeSubscription);
      const socket = await connectAndRegister(app);

      await createAsk(socket, "ask-skip-invalid-endpoint", "Invalid stored push endpoints must not receive fanout.");

      await waitForExpect(() => expect(sendNotification).toHaveBeenCalledTimes(1));
      expect(sendNotification.mock.calls[0]?.[0]).toMatchObject({ endpoint: activeSubscription.endpoint });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not fan out to a subscription deleted through the API and omits it from the store list", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-postbox-push-db-"));
    const databasePath = join(dir, "postbox.sqlite");

    try {
      const activeSubscription = validBrowserSubscription("https://fcm.googleapis.com/fcm/send/active-endpoint-token");
      const deletedSubscription = validBrowserSubscription("https://fcm.googleapis.com/fcm/send/deleted-endpoint-token");
      const sendNotification = vi.fn(async () => undefined);
      const app = await createPostboxApp({
        databasePath,
        now: () => 1_000,
        vapidPublicKey: "BTestConfiguredVapidPublicKey",
        vapidPrivateKey: "test-configured-private-key",
        pushSender: { sendNotification }
      });
      apps.push(app);
      await saveSubscription(app, activeSubscription);
      await saveSubscription(app, deletedSubscription);

      const deleted = await app.inject({
        method: "DELETE",
        url: "/api/push/subscriptions",
        payload: { endpoint: deletedSubscription.endpoint }
      });

      expect(deleted.statusCode).toBe(204);
      const db = openPostboxDatabase(databasePath);
      try {
        expect(new PushStore(db, () => 1_000).listSubscriptions().map((subscription) => subscription.endpoint)).toEqual([
          activeSubscription.endpoint
        ]);
      } finally {
        db.close();
      }

      const socket = await connectAndRegister(app);
      await createAsk(socket, "ask-after-delete", "Deleted subscriptions should not receive future fanout.");

      await waitForExpect(() => expect(sendNotification).toHaveBeenCalledTimes(1));
      expect(sendNotification.mock.calls[0]?.[0]).toMatchObject({ endpoint: activeSubscription.endpoint });
      expect(sendNotification.mock.calls.map(([subscription]) => (subscription as PushSubscriptionPayload).endpoint)).not.toContain(
        deletedSubscription.endpoint
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("sends a data-only ask.resolved dismissal payload when a pending ask is answered", async () => {
    const sendNotification = vi.fn(async () => undefined);
    const app = await createAppWithPushSender({ sendNotification });
    await saveSubscription(app, validBrowserSubscription());
    const socket = await connectAndRegister(app);

    await createAsk(socket, "ask-resolve-1", "Answering this ask should dismiss its notification.");
    await waitForExpect(() => expect(sendNotification).toHaveBeenCalledTimes(1));

    const answered = await app.inject({
      method: "POST",
      url: "/api/requests/ask-resolve-1/answer",
      payload: { selectedValues: ["yes"] }
    });
    expect(answered.statusCode).toBe(200);

    await waitForExpect(() => expect(sendNotification).toHaveBeenCalledTimes(2));
    expect(parseNotificationPayload(sendNotification, 1)).toEqual({
      data: { type: "ask.resolved", requestId: "ask-resolve-1" }
    });
  });

  it("prunes subscriptions that return 404/410 push-service failures before later notification fanout", async () => {
    const activeSubscription = validBrowserSubscription("https://fcm.googleapis.com/fcm/send/active-endpoint-token");
    const goneSubscription = validBrowserSubscription("https://fcm.googleapis.com/fcm/send/gone-endpoint-token");
    const sendNotification = vi.fn(async (subscription: PushSubscriptionPayload) => {
      if (subscription.endpoint === goneSubscription.endpoint) {
        const error = new Error("push subscription is gone") as Error & { statusCode: number };
        error.statusCode = 410;
        throw error;
      }
    });
    const app = await createAppWithPushSender({ sendNotification });
    await saveSubscription(app, activeSubscription);
    await saveSubscription(app, goneSubscription);
    const socket = await connectAndRegister(app);

    await createAsk(socket, "ask-prune-1", "First ask should attempt both subscriptions.");
    await waitForExpect(() => expect(sendNotification).toHaveBeenCalledTimes(2));
    expect(sendNotification.mock.calls.map(([subscription]) => (subscription as PushSubscriptionPayload).endpoint).sort()).toEqual(
      [activeSubscription.endpoint, goneSubscription.endpoint].sort()
    );

    await createAsk(socket, "ask-prune-2", "Second ask should skip the expired subscription.");
    await waitForExpect(() => expect(sendNotification).toHaveBeenCalledTimes(3));

    const endpoints = sendNotification.mock.calls.map(([subscription]) => (subscription as PushSubscriptionPayload).endpoint);
    expect(endpoints.filter((endpoint) => endpoint === activeSubscription.endpoint)).toHaveLength(2);
    expect(endpoints.filter((endpoint) => endpoint === goneSubscription.endpoint)).toHaveLength(1);
  });
});
