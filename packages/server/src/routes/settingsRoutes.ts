import type { FastifyInstance } from "fastify";
import { AvailableChatModelsSchema, UpdatePostboxSettingsSchema } from "../protocol.js";
import { loadAvailableChatModels } from "../services/modelCatalog.js";
import type { SettingsStore } from "../services/settingsStore.js";

export async function registerSettingsRoutes(app: FastifyInstance, settings: SettingsStore, loadModels = loadAvailableChatModels): Promise<void> {
  app.get("/api/settings/models", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    try { return AvailableChatModelsSchema.parse(await loadModels()); }
    catch { return reply.code(503).send({ error: "models_unavailable", message: "Could not load available models from Pi. Try again." }); }
  });
  app.get("/api/settings", async () => settings.get());
  app.put("/api/settings", async (request, reply) => {
    const parsed = UpdatePostboxSettingsSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_settings", message: parsed.error.message });
    const saved = settings.update(parsed.data);
    if (!saved) return reply.code(409).send({ error: "settings_conflict", message: "Settings changed on another device. Reload before saving.", settings: settings.get() });
    return saved;
  });
}
