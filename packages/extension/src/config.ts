import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { parseAutoWakeBoolean } from "./answerAutoWake.js";
import { resolveServerProfile, type ResolvedServerProfile } from "./serverProfile.js";

const ExtensionConfigSchema = z.object({
  serverUrl: z.string().url().optional(),
  machineId: z.string().min(1).optional(),
  autoWake: z.boolean().optional()
});

const ConfigFieldSchemas = {
  serverUrl: z.string().url(),
  machineId: z.string().min(1)
} as const;

export type ExtensionConfig = z.infer<typeof ExtensionConfigSchema>;

export function defaultConfigPath(
  env: NodeJS.ProcessEnv = process.env,
  profile: ResolvedServerProfile = resolveServerProfile({ env })
): string {
  return env.PI_POSTBOX_CONFIG_PATH ?? join(env.PI_POSTBOX_CONFIG_DIR ?? profile.stateDir, "config.json");
}

export async function readExtensionConfig(
  env: NodeJS.ProcessEnv = process.env,
  profile: ResolvedServerProfile = resolveServerProfile({ env }),
  warn: (message: string) => void = console.warn
): Promise<ExtensionConfig> {
  const configPath = defaultConfigPath(env, profile);
  let text: string;
  try {
    text = await readFile(configPath, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) return env.PI_POSTBOX_URL ? { serverUrl: env.PI_POSTBOX_URL } : {};
    warn(`Unable to read Pi Postbox extension config ${configPath}: ${errorMessage(error)}`);
    return env.PI_POSTBOX_URL ? { serverUrl: env.PI_POSTBOX_URL } : {};
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    warn(`Unable to parse Pi Postbox extension config ${configPath}: ${errorMessage(error)}`);
    return env.PI_POSTBOX_URL ? { serverUrl: env.PI_POSTBOX_URL } : {};
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    warn(`Invalid Pi Postbox extension config ${configPath}: expected a JSON object.`);
    return env.PI_POSTBOX_URL ? { serverUrl: env.PI_POSTBOX_URL } : {};
  }

  const record = raw as Record<string, unknown>;
  const fileConfig: ExtensionConfig = {};
  for (const field of ["serverUrl", "machineId"] as const) {
    if (record[field] === undefined) continue;
    const parsed = ConfigFieldSchemas[field].safeParse(record[field]);
    if (parsed.success) fileConfig[field] = parsed.data;
    else warn(`Invalid Pi Postbox extension config field "${field}" in ${configPath}: ${parsed.error.issues[0]?.message ?? "invalid value"}.`);
  }
  if (record.autoWake !== undefined) {
    const autoWake = parseAutoWakeBoolean(record.autoWake);
    if (autoWake === undefined) {
      warn(`Invalid Pi Postbox extension config field "autoWake" in ${configPath}: expected a boolean or accepted boolean-ish string.`);
    } else {
      fileConfig.autoWake = autoWake;
    }
  }

  return {
    ...fileConfig,
    ...(env.PI_POSTBOX_URL ? { serverUrl: env.PI_POSTBOX_URL } : {})
  };
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
