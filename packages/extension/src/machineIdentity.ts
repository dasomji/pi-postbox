import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { readExtensionConfig, writeExtensionConfig, type ExtensionConfig } from "./config.js";

export interface MachineIdentity {
  machineId: string;
  hostname: string;
}

export async function getMachineIdentity(env: NodeJS.ProcessEnv = process.env): Promise<MachineIdentity> {
  const config = await readExtensionConfig(env);
  const machineId = config.machineId ?? `machine_${randomUUID()}`;

  if (!config.machineId) {
    await writeExtensionConfig({ ...config, machineId } satisfies ExtensionConfig, env);
  }

  return { machineId, hostname: hostname() };
}
