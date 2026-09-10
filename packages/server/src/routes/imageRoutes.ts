import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { IMAGE_LIMITS, PROTOCOL_VERSION } from "../protocol.js";
import { ImageError, type ImageStore } from "../services/imageStore.js";
import type { SessionStore } from "../services/sessionStore.js";

export function registerImageRoutes(app: FastifyInstance, store: ImageStore, sessions: SessionStore): (sessionId: string, connectionId: string) => string {
  const tokens = new Map<string, { token: string; connectionId: string }>();
  let activeUploads = 0;
  const admitted = new WeakSet<object>();
  app.addContentTypeParser(["image/png", "image/jpeg", "image/webp"], { parseAs: "buffer", bodyLimit: IMAGE_LIMITS.sourceBytes }, (_request, body, done) => done(null, body));
  app.post("/api/images/stage", {
    bodyLimit: IMAGE_LIMITS.sourceBytes,
    onRequest: async (request, reply) => {
      if (activeUploads >= 2) return reply.code(429).send({ error: "image_busy", retryable: true });
      activeUploads++; admitted.add(request);
    },
    onResponse: async (request) => { if (admitted.delete(request)) activeUploads--; },
    onRequestAbort: async (request) => { if (admitted.delete(request)) activeUploads--; }
  }, async (request, reply) => {
    const sessionId = request.headers["x-postbox-session"];
    const token = typeof sessionId === "string" ? tokens.get(sessionId) : undefined;
    if (!token || token.token !== request.headers["x-postbox-upload-token"] || !sessions.isCurrentConnection(sessionId as string, token.connectionId)) return reply.code(403).send({ error: "image_wrong_session" });
    if (request.headers["x-postbox-media-instance"] !== store.instanceId || request.headers["x-postbox-protocol-version"] !== PROTOCOL_VERSION) return reply.code(409).send({ error: "image_target_changed", retryable: true });
    try {
      if (!Buffer.isBuffer(request.body)) return reply.code(415).send({ error: "image_format" });
      return await store.stage(request.body, request.headers["content-type"] ?? "", sessionId as string);
    } catch (error) {
      if (!(error instanceof ImageError)) throw error;
      return reply.code(error.retryable ? 409 : 422).send({ error: error.code, message: error.message, retryable: error.retryable });
    }
  });
  app.get<{ Params: { imageId: string } }>("/media/images/:imageId", { config: { compress: false } }, async (request, reply) => {
    if (!/^[0-9a-f-]{36}$/.test(request.params.imageId)) return reply.code(404).send({ error: "image_not_found" });
    try {
      const image = store.read(request.params.imageId);
      if (!image) return reply.code(404).send({ error: "image_not_found" });
      reply.header("Content-Type", image.mediaType).header("X-Content-Type-Options", "nosniff").header("Content-Disposition", "inline")
        .header("Cache-Control", "private, max-age=31536000, immutable").header("ETag", image.etag);
      if (request.headers["if-none-match"]?.split(/\s*,\s*/).some(tag => tag === "*" || tag.replace(/^W\//, "") === image.etag)) return reply.code(304).send();
      return reply.header("Content-Length", image.bytes.length).send(image.bytes);
    } catch {
      app.log.warn({ imageId: request.params.imageId, code: "image_storage_unavailable" }, "Question media is missing or corrupt");
      return reply.header("Cache-Control", "no-store").code(503).send({ error: "image_storage_unavailable" });
    }
  });
  return (sessionId, connectionId) => {
    for (const [id, value] of tokens) if (!sessions.isCurrentConnection(id, value.connectionId)) tokens.delete(id);
    const token = randomUUID();
    tokens.set(sessionId, { token, connectionId });
    return token;
  };
}
