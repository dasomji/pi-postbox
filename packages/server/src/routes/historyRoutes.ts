import { HistoryResponseSchema } from "../protocol.js";
import type { FastifyInstance } from "fastify";
import { HistoryService } from "../services/historyService.js";

export async function registerHistoryRoutes(
  app: FastifyInstance,
  historyService: HistoryService,
  expireDue: () => unknown
): Promise<void> {
  app.get("/api/history", async () => {
    expireDue();
    return HistoryResponseSchema.parse({
      history: historyService.list(),
      timestamp: new Date().toISOString()
    });
  });

}
