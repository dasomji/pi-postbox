import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { resolveServerProfile, type ResolvedServerProfile } from "./serverProfile.js";

const ExtensionConfigSchema = z.object({
  serverUrl: z.string().url().optional(),
  machineId: z.string().min(1).optional()
});

export type ExtensionConfig = z.infer<typeof ExtensionConfigSchema>;

export function defaultConfigPath(
  env: NodeJS.ProcessEnv = process.env,
  profile: ResolvedServerProfile = resolveServerProfile({ env })
): string {
  return env.PI_POSTBOX_CONFIG_PATH ?? join(env.PI_POSTBOX_CONFIG_DIR ?? profile.stateDir, "config.json");
}

export async function readExtensionConfig(
  env: NodeJS.ProcessEnv = process.env,
  profile: ResolvedServerProfile = resolveServerProfile({ env })
): Promise<ExtensionConfig> {
  const fileConfig: ExtensionConfig = await readFile(defaultConfigPath(env, profile), "utf8")
    .then((text) => ExtensionConfigSchema.parse(JSON.parse(text)))
    .catch(() => ({}));

  return {
    ...fileConfig,
    serverUrl: env.PI_POSTBOX_URL ?? fileConfig.serverUrl
  };
}

export async function writeExtensionConfig(
  config: ExtensionConfig,
  env: NodeJS.ProcessEnv = process.env,
  profile: ResolvedServerProfile = resolveServerProfile({ env })
): Promise<void> {
  const configPath = defaultConfigPath(env, profile);
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(ExtensionConfigSchema.parse(config), null, 2)}\n`);
}
