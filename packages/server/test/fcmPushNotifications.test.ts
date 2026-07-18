import type { ExtensionClientMessage } from "@pi-postbox/protocol";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { createPostboxApp } from "../src/app.js";
import { FcmSendError, type FcmDataMessage } from "../src/services/fcmSender.js";

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
      ],
      context: {
        codebaseContext: "Fastify server with Android FCM notifications.",
        problemContext: "Notify the user about a pending remote decision."
      }
    }
  };
}

async function createAppWithFcmSender(send: ReturnType<typeof vi.fn>): Promise<FastifyInstance> {
  const app = await createPostboxApp({
    databasePath: ":memory:",
    now: () => 1_000,
    vapidPublicKey: "BTestConfiguredVapidPublicKey",
    vapidPrivateKey: "test-configured-private-key",
    pushSender: { sendNotification: vi.fn(async () => undefined) },
    fcmSender: { send }
  });
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

async function registerFcmToken(app: FastifyInstance, token: string): Promise<void> {
  const response = await app.inject({ method: "POST", url: "/api/push/fcm-tokens", payload: { token, platform: "android" } });
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

describe("FCM token routes", () => {
  it("registers and unregisters FCM tokens", async () => {
    const app = await createAppWithFcmSender(vi.fn(async () => undefined));

    const registered = await app.inject({
      method: "POST",
      url: "/api/push/fcm-tokens",
      payload: { token: "device-token-1", platform: "android" }
    });
    expect(registered.statusCode).toBe(204);

    const reRegistered = await app.inject({
      method: "POST",
      url: "/api/push/fcm-tokens",
      payload: { token: "device-token-1" }
    });
    expect(reRegistered.statusCode).toBe(204);

    const deleted = await app.inject({
      method: "DELETE",
      url: "/api/push/fcm-tokens",
      payload: { token: "device-token-1" }
    });
    expect(deleted.statusCode).toBe(204);
  });

  it("rejects invalid FCM token payloads", async () => {
    const app = await createAppWithFcmSender(vi.fn(async () => undefined));

    const missingToken = await app.inject({ method: "POST", url: "/api/push/fcm-tokens", payload: { platform: "android" } });
    expect(missingToken.statusCode).toBe(400);
    expect(missingToken.json()).toMatchObject({ error: "invalid_fcm_token" });

    const unsupportedPlatform = await app.inject({
      method: "POST",
      url: "/api/push/fcm-tokens",
      payload: { token: "device-token-1", platform: "ios" }
    });
    expect(unsupportedPlatform.statusCode).toBe(400);
  });
});

describe("new pending ask FCM notifications", () => {
  it("fans out a data-only FCM message to registered tokens without prompt text", async () => {
    const send = vi.fn(async () => undefined);
    const app = await createAppWithFcmSender(send);
    await registerFcmToken(app, "device-token-1");
    const socket = await connectAndRegister(app);
    const secretPrompt = "SECRET prompt text should never be sent to push services";

    await createAsk(socket, "ask-fcm-1", secretPrompt);

    await waitForExpect(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0]?.[0]).toBe("device-token-1");

    const message = send.mock.calls[0]?.[1] as FcmDataMessage;
    expect(message.data).toMatchObject({
      type: "ask.created",
      requestId: "ask-fcm-1",
      sessionId: "session-1",
      projectName: "pi-postbox",
      sessionTitle: "Answer loop",
      title: expect.any(String),
      body: expect.any(String)
    });
    expect(Object.values(message.data).every((value) => typeof value === "string")).toBe(true);
    expect(JSON.stringify(message.data)).not.toContain("SECRET");
  });

  it("prunes tokens that FCM reports as unregistered before later fanout", async () => {
    const send = vi.fn(async (token: string) => {
      if (token === "gone-token") {
        throw new FcmSendError("requested entity was not found", 404, "UNREGISTERED");
      }
    });
    const app = await createAppWithFcmSender(send);
    await registerFcmToken(app, "active-token");
    await registerFcmToken(app, "gone-token");
    const socket = await connectAndRegister(app);

    await createAsk(socket, "ask-fcm-prune-1", "First ask should attempt both tokens.");
    await waitForExpect(() => expect(send).toHaveBeenCalledTimes(2));

    await createAsk(socket, "ask-fcm-prune-2", "Second ask should skip the unregistered token.");
    await waitForExpect(() => expect(send).toHaveBeenCalledTimes(3));

    const attemptedTokens = send.mock.calls.map(([token]) => token);
    expect(attemptedTokens.filter((token) => token === "active-token")).toHaveLength(2);
    expect(attemptedTokens.filter((token) => token === "gone-token")).toHaveLength(1);
  });

  it("sends a data-only ask.resolved dismissal message when a pending ask is answered", async () => {
    const send = vi.fn(async () => undefined);
    const app = await createAppWithFcmSender(send);
    await registerFcmToken(app, "device-token-1");
    const socket = await connectAndRegister(app);

    await createAsk(socket, "ask-fcm-resolve-1", "Answering this ask should dismiss its notification.");
    await waitForExpect(() => expect(send).toHaveBeenCalledTimes(1));

    const answered = await app.inject({
      method: "POST",
      url: "/api/requests/ask-fcm-resolve-1/answer",
      payload: { selectedValues: ["yes"] }
    });
    expect(answered.statusCode).toBe(200);

    await waitForExpect(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls[1]?.[0]).toBe("device-token-1");
    const message = send.mock.calls[1]?.[1] as FcmDataMessage;
    expect(message.data).toEqual({ type: "ask.resolved", requestId: "ask-fcm-resolve-1" });
  });

  it("sends an ask.resolved dismissal message when a pending ask is cancelled by session shutdown", async () => {
    const send = vi.fn(async () => undefined);
    const app = await createAppWithFcmSender(send);
    await registerFcmToken(app, "device-token-1");
    const socket = await connectAndRegister(app);

    await createAsk(socket, "ask-fcm-shutdown-1", "Session shutdown should dismiss this ask's notification.");
    await waitForExpect(() => expect(send).toHaveBeenCalledTimes(1));

    const cancelled = nextMessage(socket);
    socket.send(
      JSON.stringify({
        type: "session.shutdown",
        requestId: "wire-shutdown-1",
        payload: { sessionId: "session-1", reason: "quit" }
      })
    );
    await expect(cancelled).resolves.toMatchObject({
      type: "ask.resolved",
      payload: { requestId: "ask-fcm-shutdown-1", status: "cancelled" }
    });

    await waitForExpect(() => expect(send).toHaveBeenCalledTimes(2));
    const message = send.mock.calls[1]?.[1] as FcmDataMessage;
    expect(message.data).toEqual({ type: "ask.resolved", requestId: "ask-fcm-shutdown-1" });
  });

  it("does not attempt FCM fanout when no FCM sender is configured", async () => {
    const app = await createPostboxApp({
      databasePath: ":memory:",
      now: () => 1_000,
      vapidPublicKey: "BTestConfiguredVapidPublicKey",
      vapidPrivateKey: "test-configured-private-key",
      pushSender: { sendNotification: vi.fn(async () => undefined) }
    });
    apps.push(app);
    await registerFcmToken(app, "device-token-1");
    const socket = await connectAndRegister(app);

    await createAsk(socket, "ask-no-fcm-sender", "No FCM sender means no FCM fanout and no crash.");
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
});
