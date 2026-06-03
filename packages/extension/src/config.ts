import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";

const ExtensionConfigSchema = z.object({
  serverUrl: z.string().url().optional(),
  machineId: z.string().min(1).optional()
});

export type ExtensionConfig = z.infer<typeof ExtensionConfigSchema>;

export function defaultConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.PI_POSTBOX_CONFIG_PATH ?? join(env.PI_POSTBOX_CONFIG_DIR ?? join(homedir(), ".pi-postbox"), "config.json");
}

export async function readExtensionConfig(env: NodeJS.ProcessEnv = process.env): Promise<ExtensionConfig> {
  const fileConfig: ExtensionConfig = await readFile(defaultConfigPath(env), "utf8")
    .then((text) => ExtensionConfigSchema.parse(JSON.parse(text)))
    .catch(() => ({}));

  return {
    ...fileConfig,
    serverUrl: env.PI_POSTBOX_URL ?? fileConfig.serverUrl
  };
}

export async function writeExtensionConfig(config: ExtensionConfig, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const configPath = defaultConfigPath(env);
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(ExtensionConfigSchema.parse(config), null, 2)}\n`);
}
