import type { FastifyInstance } from "fastify";
import type { StateBroadcaster } from "../services/broadcaster.js";

export async function registerSseRoutes(app: FastifyInstance, broadcaster: StateBroadcaster): Promise<void> {
  app.get("/api/state/events", async (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Connection: "keep-alive"
    });

    const sendState = (snapshot: unknown) => {
      if (reply.raw.destroyed || reply.raw.writableEnded) return;
      reply.raw.write(`event: state\ndata: ${JSON.stringify(snapshot)}\n\n`);
    };

    const unsubscribe = broadcaster.subscribe(sendState);
    const keepAlive = setInterval(() => {
      if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.write(": keepalive\n\n");
    }, 15_000);
    keepAlive.unref?.();

    const cleanup = () => {
      clearInterval(keepAlive);
      unsubscribe();
    };

    request.raw.once("close", cleanup);
  });
}
