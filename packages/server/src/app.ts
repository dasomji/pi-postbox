import fastifyCompress from "@fastify/compress";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import {
  createHealthResponse,
  HealthResponseSchema,
  IncompatibleProtocolResponseSchema,
  POSTBOX_CLIENT_PROTOCOL_VERSION_HEADER,
  POSTBOX_PROTOCOL_VERSION_HEADER,
  PROTOCOL_VERSION,
  QuestionChatUnavailableResponseSchema,
  StateSnapshotSchema,
  type ServerInstanceIdentity,
  type ServerProfileIdentity
} from "./protocol.js";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openPostboxDatabase } from "./db/database.js";
import { registerAdminRoutes } from "./routes/adminRoutes.js";
import { registerHistoryRoutes } from "./routes/historyRoutes.js";
import { registerMetadataRoutes } from "./routes/metadataRoutes.js";
import { registerPushRoutes } from "./routes/pushRoutes.js";
import { registerRequestRoutes } from "./routes/requestRoutes.js";
import { registerSseRoutes } from "./routes/sseRoutes.js";
import { registerStateRoutes } from "./routes/stateRoutes.js";
import { StateBroadcaster } from "./services/broadcaster.js";
import { createFcmSenderFromServiceAccountPath, type FcmSender } from "./services/fcmSender.js";
import { HistoryService } from "./services/historyService.js";
import { PushNotifier, type PushSender } from "./services/pushNotifier.js";
import { PushStore } from "./services/pushStore.js";
import { QuestionChatRelay } from "./services/questionChatRelay.js";
import { RequestStore } from "./services/requestStore.js";
import { SessionStore } from "./services/sessionStore.js";
import { registerExtensionSocket } from "./ws/extensionSocket.js";

import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { ImageStore } from "./services/imageStore.js";
import { registerImageRoutes } from "./routes/imageRoutes.js";

export interface CreatePostboxAppOptions {
  logger?: FastifyServerOptions["logger"];
  startedAtMs?: number;
  now?: () => number;
  version?: string;
  buildId?: string;
  profile?: ServerProfileIdentity;
  uiDistDir?: string;
  databasePath?: string;
  staleAfterMs?: number;
  offlineAfterMs?: number;
  sessionHideOfflineAfterMs?: number;
  sessionRetentionMs?: number;
  expirySweepMs?: number;
  bodyLimitBytes?: number;
  websocketMaxPayloadBytes?: number;
  compressionThresholdBytes?: number;
  chatCommandTimeoutMs?: number;
  chatCommandRateLimitMax?: number;
  chatCommandRateLimitWindowMs?: number;
  chatCommandDedupeTtlMs?: number;
  chatCommandDedupeCapacity?: number;
  vapidPublicKey?: string;
  vapidPrivateKey?: string;
  pushSender?: PushSender;
  fcmSender?: FcmSender;
  fcmServiceAccountPath?: string;
  serverInstance?: () => ServerInstanceIdentity | undefined;
  // Supplied by the CLI so POST /admin/shutdown (loopback-only) can stop the process.
  onShutdownRequest?: () => void;
}

export interface ServerInstanceAwareApp extends FastifyInstance {
  setServerInstance?: (identity: ServerInstanceIdentity | undefined) => void;
}

const embeddedShell = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Pi Postbox</title>
  </head>
  <body>
    <main id="root">
      <h1>Pi Postbox</h1>
      <p>UI assets have not been built yet. Run <code>npm run build -w apps/web</code> to serve the React shell.</p>
    </main>
  </body>
</html>`;

function defaultUiDistDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "public");
}

function defaultDatabasePath(): string {
  return resolve(process.cwd(), "data/pi-postbox.sqlite");
}

export async function createPostboxApp(options: CreatePostboxAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: options.bodyLimitBytes ?? 2 * 1024 * 1024
  });
  await app.register(fastifyCompress, {
    threshold: options.compressionThresholdBytes ?? 1024,
    encodings: ["br", "gzip"],
    globalDecompression: false
  });

  const startedAtMs = options.startedAtMs ?? Date.now();
  const now = options.now ?? (() => Date.now());
  const profile = options.profile ?? { kind: "production", id: "production" };
  let mutableServerInstance: ServerInstanceIdentity | undefined;
  const getServerInstance = options.serverInstance ?? (() => mutableServerInstance);
  (app as ServerInstanceAwareApp).setServerInstance = (identity) => {
    mutableServerInstance = identity;
  };
  const db = openPostboxDatabase(options.databasePath ?? defaultDatabasePath());
  let sessionStore: SessionStore;
  try {
    sessionStore = new SessionStore(db, now, {
      staleAfterMs: options.staleAfterMs ?? 30_000,
      offlineAfterMs: options.offlineAfterMs ?? 120_000,
      hideOfflineAfterMs: options.sessionHideOfflineAfterMs,
      retentionMs: options.sessionRetentionMs
    });
  } catch (error) {
    db.close();
    throw error;
  }
  const temporaryMedia = options.databasePath === ":memory:" ? mkdtempSync(join(tmpdir(), "postbox-images-")) : undefined;
  const imageStore = new ImageStore(db, temporaryMedia ?? `${options.databasePath ?? defaultDatabasePath()}.images`, now, randomUUID());
  const requestStore = new RequestStore(db, now, {
    imageStore,
    recordTelemetry: (event) => app.log.info({ questionTelemetry: event }, "question telemetry")
  });
  const questionChatRelay = new QuestionChatRelay({
    commandTimeoutMs: options.chatCommandTimeoutMs,
    commandRateLimitMax: options.chatCommandRateLimitMax,
    commandRateLimitWindowMs: options.chatCommandRateLimitWindowMs,
    commandDedupeTtlMs: options.chatCommandDedupeTtlMs,
    commandDedupeCapacity: options.chatCommandDedupeCapacity,
    now,
    authorize: (requestId, ownerSessionId) => {
      const request = requestStore.get(requestId);
      if (!request) return { code: "request_missing", message: "This Postbox Question no longer exists." };
      if (request.sessionId !== ownerSessionId) {
        return { code: "wrong_owner", message: "Question Chat is not owned by this Pi Session." };
      }
      if (request.status !== "pending") {
        return { code: "request_not_pending", message: "Chat is available only while the Postbox Question is pending." };
      }
      return undefined;
    }
  });
  const pushStore = new PushStore(db, now, {
    publicKey: options.vapidPublicKey,
    privateKey: options.vapidPrivateKey
  });
  const fcmSender =
    options.fcmSender ??
    createFcmSenderFromServiceAccountPath(options.fcmServiceAccountPath ?? process.env.PI_POSTBOX_FCM_SERVICE_ACCOUNT);
  const pushNotifier = new PushNotifier(pushStore, sessionStore, options.pushSender, fcmSender);
  requestStore.onAnyResolved((result) => {
    void pushNotifier.notifyAskResolved(result).catch((error: unknown) => {
      app.log.warn({ error, requestId: result.requestId }, "failed to send ask resolved push dismissal");
    });
    const terminalRequest = requestStore.get(result.requestId);
    if (terminalRequest && result.status !== "unavailable") {
      questionChatRelay.cleanup(result.requestId, terminalRequest.sessionId, result.status);
    }
  });
  const historyService = new HistoryService(db, requestStore, now);
  let broadcaster: StateBroadcaster;
  const expireDueAndBroadcast = () => {
    try { imageStore.prune(); } catch { app.log.warn({ code: "image_cleanup_failed" }, "Image cleanup will retry on the next sweep"); }
    const expired = requestStore.expireDue();
    if (expired.length > 0) broadcaster.broadcast();
    return expired;
  };
  const getSnapshot = () => {
    requestStore.expireDue();
    // History pruning first: it deletes old terminal requests, which is what
    // frees their sessions for the retention purge below.
    requestStore.expireDue();
    sessionStore.pruneOfflineSessions();
    return StateSnapshotSchema.parse({
      ...sessionStore.snapshot(),
      requests: requestStore.list({ status: "pending" })
    });
  };
  broadcaster = new StateBroadcaster(getSnapshot);
  const expirySweepMs = options.expirySweepMs ?? 60_000;
  const expiryTimer = expirySweepMs > 0 ? setInterval(expireDueAndBroadcast, expirySweepMs) : undefined;
  expiryTimer?.unref?.();

  app.addHook("onClose", async () => {
    if (expiryTimer) clearInterval(expiryTimer);
    broadcaster.close();
    requestStore.close();
    questionChatRelay.close();
    sessionStore.close();
    db.close();
    if (temporaryMedia) rmSync(temporaryMedia, { recursive: true, force: true });
  });

  app.addHook("preSerialization", async (request, reply, payload) => {
    if (!isProtocolHttpSurface(request.url) || reply.statusCode === 204) return payload;
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return payload;
    return { ...payload, protocolVersion: PROTOCOL_VERSION };
  });

  app.addHook("onRequest", async (request, reply) => {
    if (request.url.startsWith("/api/")) reply.header("Cache-Control", "no-store");
    if (isProtocolHttpSurface(request.url)) {
      reply.header(POSTBOX_PROTOCOL_VERSION_HEADER, PROTOCOL_VERSION);
      const received = request.headers[POSTBOX_CLIENT_PROTOCOL_VERSION_HEADER.toLowerCase()];
      if (typeof received === "string" && received !== PROTOCOL_VERSION) {
        return reply.code(426).send(IncompatibleProtocolResponseSchema.parse({
          protocolVersion: PROTOCOL_VERSION,
          error: "incompatible_protocol",
          supportedProtocolVersion: PROTOCOL_VERSION,
          receivedProtocolVersion: privacySafeProtocolVersion(received)
        }));
      }
    }

    const isQuestionChatControl = /^\/api\/requests\/[^/?]+\/chat(?:[/?]|$)/.test(request.url);
    if (!isQuestionChatControl && !["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return;
    const origin = request.headers.origin;
    if (!origin) return;

    if (isAllowedBrowserOrigin(origin, request.headers.host)) return;

    if (isQuestionChatControl) {
      return reply.code(403).send(QuestionChatUnavailableResponseSchema.parse({
        status: "unavailable",
        error: { code: "forbidden_origin", message: "Question Chat requests must come from this Postbox origin." }
      }));
    }

    return reply.code(403).send({ error: "forbidden_origin", message: "Cross-origin state-changing requests are not allowed." });
  });

  await app.register(websocket, { options: { maxPayload: options.websocketMaxPayloadBytes ?? 2 * 1024 * 1024 } });
  await registerStateRoutes(app, getSnapshot);
  await registerSseRoutes(app, broadcaster);
  await registerMetadataRoutes(app, sessionStore, broadcaster);
  await registerHistoryRoutes(app, historyService, expireDueAndBroadcast);
  await registerPushRoutes(app, pushStore);
  await registerRequestRoutes(app, requestStore, broadcaster, expireDueAndBroadcast, {
    relay: questionChatRelay,
    sessionStore
  });
  await registerAdminRoutes(app, { onShutdownRequest: options.onShutdownRequest });
  await registerExtensionSocket(
    app,
    sessionStore,
    requestStore,
    broadcaster,
    expireDueAndBroadcast,
    pushNotifier,
    questionChatRelay,
    registerImageRoutes(app, imageStore, sessionStore)
  );

  app.get("/healthz", async () => {
    const response = createHealthResponse({
      startedAtMs,
      nowMs: now(),
      version: options.version,
      buildId: options.buildId,
      profile,
      instance: getServerInstance()
    });

    return HealthResponseSchema.parse({ ...response, mediaInstanceId: imageStore.instanceId });
  });

  const uiDistDir = resolve(options.uiDistDir ?? defaultUiDistDir());
  const uiIndexPath = join(uiDistDir, "index.html");

  if (existsSync(uiIndexPath)) {
    await app.register(fastifyStatic, {
      root: uiDistDir,
      prefix: "/",
      index: "index.html"
    });

    app.setNotFoundHandler((request, reply) => {
      if (request.method === "GET" && request.headers.accept?.includes("text/html")) {
        return reply.sendFile("index.html");
      }

      return reply.code(404).send({ error: "not_found" });
    });
  } else {
    app.get("/", async (_request, reply) => {
      return reply.type("text/html; charset=utf-8").send(embeddedShell);
    });
  }

  return app;
}

function isAllowedBrowserOrigin(origin: string, host: string | undefined): boolean {
  if (!host || origin.includes(",")) return false;
  try {
    const parsed = new URL(origin);
    return (parsed.protocol === "http:" || parsed.protocol === "https:")
      && parsed.origin === origin
      && parsed.host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

function isProtocolHttpSurface(url: string): boolean {
  const path = url.split("?", 1)[0];
  return path === "/healthz" || path === "/api" || path.startsWith("/api/");
}

function privacySafeProtocolVersion(value: string): string {
  return /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.test(value) ? value : "<invalid>";
}
