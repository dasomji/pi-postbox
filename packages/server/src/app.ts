import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import { createHealthResponse, HealthResponseSchema, StateSnapshotSchema } from "@pi-postbox/protocol";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openPostboxDatabase } from "./db/database.js";
import { registerHistoryRoutes } from "./routes/historyRoutes.js";
import { registerMetadataRoutes } from "./routes/metadataRoutes.js";
import { registerRequestRoutes } from "./routes/requestRoutes.js";
import { registerSseRoutes } from "./routes/sseRoutes.js";
import { registerStateRoutes } from "./routes/stateRoutes.js";
import { StateBroadcaster } from "./services/broadcaster.js";
import { HistoryService } from "./services/historyService.js";
import { RequestStore } from "./services/requestStore.js";
import { SessionStore } from "./services/sessionStore.js";
import { registerExtensionSocket } from "./ws/extensionSocket.js";

export interface CreatePostboxAppOptions {
  logger?: FastifyServerOptions["logger"];
  startedAtMs?: number;
  now?: () => number;
  version?: string;
  uiDistDir?: string;
  databasePath?: string;
  staleAfterMs?: number;
  offlineAfterMs?: number;
  askTimeoutMs?: number;
  expirySweepMs?: number;
  historyRetentionMaxAgeMs?: number;
  historyRetentionMaxRecords?: number;
  bodyLimitBytes?: number;
  websocketMaxPayloadBytes?: number;
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
  const startedAtMs = options.startedAtMs ?? Date.now();
  const now = options.now ?? (() => Date.now());
  const db = openPostboxDatabase(options.databasePath ?? defaultDatabasePath());
  const sessionStore = new SessionStore(db, now, {
    staleAfterMs: options.staleAfterMs ?? 30_000,
    offlineAfterMs: options.offlineAfterMs ?? 120_000
  });
  const requestStore = new RequestStore(db, now, { askTimeoutMs: options.askTimeoutMs });
  const historyService = new HistoryService(db, requestStore, now, {
    maxAgeMs: options.historyRetentionMaxAgeMs,
    maxRecords: options.historyRetentionMaxRecords
  });
  let broadcaster: StateBroadcaster;
  const pruneHistory = () => {
    requestStore.expireDue();
    return historyService.prune();
  };
  const expireDueAndBroadcast = () => {
    const expired = requestStore.expireDue();
    if (expired.length > 0) broadcaster.broadcast();
    return expired;
  };
  const getSnapshot = () => {
    requestStore.expireDue();
    pruneHistory();
    return StateSnapshotSchema.parse({
      ...sessionStore.snapshot(),
      requests: requestStore.list()
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
    sessionStore.close();
    db.close();
  });

  app.addHook("onRequest", async (request, reply) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return;
    const origin = request.headers.origin;
    if (!origin) return;

    try {
      const originUrl = new URL(origin);
      const host = request.headers.host;
      if (host && originUrl.host === host) return;
    } catch {
      // Fall through to rejection below.
    }

    return reply.code(403).send({ error: "forbidden_origin", message: "Cross-origin state-changing requests are not allowed." });
  });

  await app.register(websocket, { options: { maxPayload: options.websocketMaxPayloadBytes ?? 2 * 1024 * 1024 } });
  await registerStateRoutes(app, getSnapshot);
  await registerSseRoutes(app, broadcaster);
  await registerMetadataRoutes(app, sessionStore, broadcaster);
  await registerHistoryRoutes(app, historyService, broadcaster, pruneHistory);
  await registerRequestRoutes(app, requestStore, broadcaster, expireDueAndBroadcast);
  await registerExtensionSocket(app, sessionStore, requestStore, broadcaster, expireDueAndBroadcast);

  app.get("/healthz", async () => {
    const response = createHealthResponse({
      startedAtMs,
      nowMs: now(),
      version: options.version
    });

    return HealthResponseSchema.parse(response);
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
