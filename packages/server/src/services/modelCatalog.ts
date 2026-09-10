import { ModelRuntime, getAgentDir } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import type { AvailableChatModels } from "../protocol.js";

/** Read the same Pi configuration used by fresh chats, without running a session. */
export async function loadAvailableChatModels(): Promise<AvailableChatModels> {
  const agentDir = getAgentDir();
  const runtime = await ModelRuntime.create({
    authPath: join(agentDir, "auth.json"),
    modelsPath: join(agentDir, "models.json"),
    allowModelNetwork: false
  });
  const models = await runtime.getAvailable();
  if (runtime.getError()) throw new Error("Pi model configuration could not be loaded.");
  return { models: models.map(model => ({ id: `${model.provider}/${model.id}`, name: model.name }))
    .sort((a, b) => a.id.localeCompare(b.id)) };
}
