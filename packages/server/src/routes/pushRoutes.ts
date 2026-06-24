import {
  PushConfigResponseSchema,
  PushSubscriptionDeletePayloadSchema,
  PushSubscriptionPayloadSchema
} from "@pi-postbox/protocol";
import type { FastifyInstance } from "fastify";
import type { PushStore } from "../services/pushStore.js";

export async function registerPushRoutes(app: FastifyInstance, pushStore: PushStore): Promise<void> {
  app.get("/api/push/config", async () => {
    return PushConfigResponseSchema.parse(pushStore.getConfig());
  });

  app.post("/api/push/subscriptions", async (request, reply) => {
    const body = PushSubscriptionPayloadSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_push_subscription", message: body.error.message });

    pushStore.upsertSubscription(body.data);
    return reply.code(204).send();
  });

  app.delete("/api/push/subscriptions", async (request, reply) => {
    const body = PushSubscriptionDeletePayloadSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_push_subscription", message: body.error.message });

    pushStore.deleteSubscription(body.data.endpoint);
    return reply.code(204).send();
  });
}
