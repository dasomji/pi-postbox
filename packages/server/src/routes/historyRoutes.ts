import { HistoryPruneResponseSchema, HistoryResponseSchema } from "@pi-postbox/protocol";
import type { FastifyInstance } from "fastify";
import type { StateBroadcaster } from "../services/broadcaster.js";
import { HistoryService } from "../services/historyService.js";

export async function registerHistoryRoutes(
  app: FastifyInstance,
  historyService: HistoryService,
  broadcaster: StateBroadcaster,
  pruneHistory: () => number = () => historyService.prune()
): Promise<void> {
  app.get("/api/history", async () => {
    const pruned = pruneHistory();
    if (pruned > 0) broadcaster.broadcast();
    return HistoryResponseSchema.parse({
      history: historyService.list(),
      retention: historyService.retentionConfig(),
      timestamp: new Date().toISOString()
    });
  });

  app.post("/api/history/prune", async () => {
    const pruned = pruneHistory();
    if (pruned > 0) broadcaster.broadcast();
    return HistoryPruneResponseSchema.parse({
      pruned,
      retention: historyService.retentionConfig(),
      timestamp: new Date().toISOString()
    });
  });
}
