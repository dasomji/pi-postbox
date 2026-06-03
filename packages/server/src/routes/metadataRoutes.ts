import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { StateBroadcaster } from "../services/broadcaster.js";
import { SessionStoreError, type SessionStore } from "../services/sessionStore.js";

const RenamePayloadSchema = z.object({ displayName: z.string().trim().min(1).max(120) });

function errorPayload(error: unknown): { code: string; message: string } {
  if (error instanceof SessionStoreError) return { code: error.code, message: error.message };
  return { code: "metadata_update_failed", message: error instanceof Error ? error.message : String(error) };
}

export async function registerMetadataRoutes(
  app: FastifyInstance,
  sessionStore: SessionStore,
  broadcaster: StateBroadcaster
): Promise<void> {
  app.post<{ Params: { machineId: string }; Body: unknown }>("/api/machines/:machineId/rename", async (request, reply) => {
    const parsed = RenamePayloadSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "invalid_rename", message: parsed.error.message });
    }

    try {
      sessionStore.renameMachine(request.params.machineId, parsed.data.displayName);
      broadcaster.broadcast();
      return { machineId: request.params.machineId, displayName: parsed.data.displayName };
    } catch (error) {
      const payload = errorPayload(error);
      return reply.code(payload.code === "machine_not_found" ? 404 : 500).send(payload);
    }
  });

  app.post<{ Params: { projectId: string }; Body: unknown }>("/api/projects/:projectId/rename", async (request, reply) => {
    const parsed = RenamePayloadSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "invalid_rename", message: parsed.error.message });
    }

    try {
      sessionStore.renameProject(request.params.projectId, parsed.data.displayName);
      broadcaster.broadcast();
      return { projectId: request.params.projectId, displayName: parsed.data.displayName };
    } catch (error) {
      const payload = errorPayload(error);
      return reply.code(payload.code === "project_not_found" ? 404 : 500).send(payload);
    }
  });
}
