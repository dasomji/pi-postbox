import type { StateSnapshot } from "../protocol.js";
import type { FastifyInstance } from "fastify";

export async function registerStateRoutes(app: FastifyInstance, getSnapshot: () => StateSnapshot): Promise<void> {
  app.get("/api/state", async () => getSnapshot());
}
