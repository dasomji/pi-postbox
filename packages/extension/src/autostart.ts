import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface PostboxAutostartResult {
  status: "started" | "already-started" | "disabled" | "failed";
  diagnostic: string;
}

export interface PostboxAutostartStatusSnapshot {
  enabled: boolean;
  startedByThisSession: boolean;
}

export interface PostboxAutostartOptions {
  onFailure?: (diagnostic: string) => void;
}

interface AutostartedProcess {
  child: ChildProcess;
  diagnostic: string;
}

const DEFAULT_AUTOSTART_TIMEOUT_MS = 10_000;
const AUTOSTART_OFF_VALUES = new Set(["0", "false", "no", "off"]);
const autostartedByConfigBase = new Map<string, AutostartedProcess>();
const lastAutostartFailureByConfigBase = new Map<string, string>();

export function isPostboxAutostartDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.PI_POSTBOX_AUTOSTART?.trim().toLowerCase();
  return value ? AUTOSTART_OFF_VALUES.has(value) : false;
}

export function postboxAutostartTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const configured = env.PI_POSTBOX_AUTOSTART_TIMEOUT_MS;
  if (!configured) return DEFAULT_AUTOSTART_TIMEOUT_MS;

  const parsed = Number.parseInt(configured, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_AUTOSTART_TIMEOUT_MS;
}

export function getPostboxAutostartFailureDiagnostic(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return lastAutostartFailureByConfigBase.get(autostartKey(env));
}

export function getPostboxAutostartStatus(env: NodeJS.ProcessEnv = process.env): PostboxAutostartStatusSnapshot {
  const existing = autostartedByConfigBase.get(autostartKey(env));
  return {
    enabled: !isPostboxAutostartDisabled(env),
    startedByThisSession: !!existing && isSpawnedChildStillRunning(existing.child)
  };
}

export function ensurePostboxServerAutostarted(
  env: NodeJS.ProcessEnv = process.env,
  options: PostboxAutostartOptions = {}
): PostboxAutostartResult {
  if (isPostboxAutostartDisabled(env)) {
    return {
      status: "disabled",
      diagnostic: "Pi Postbox autostart disabled by PI_POSTBOX_AUTOSTART=off."
    };
  }

  const key = autostartKey(env);
  const existing = autostartedByConfigBase.get(key);
  if (existing && isSpawnedChildStillRunning(existing.child)) {
    return { status: "already-started", diagnostic: existing.diagnostic };
  }
  if (existing) autostartedByConfigBase.delete(key);

  const command = resolveAutostartCommand();
  try {
    const child = spawn(command.executable, command.args, {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        ...env
      }
    });
    child.once("error", (error) => {
      clearAutostartedChild(key, child);
      rememberAutostartFailure(
        key,
        `Pi Postbox autostart failed while spawning ${command.executable}: ${messageFrom(error)}`,
        options
      );
    });
    child.once("exit", (code, signal) => {
      clearAutostartedChild(key, child);
      rememberAutostartFailure(
        key,
        `Pi Postbox autostart process ${command.executable} exited before becoming available (code ${code ?? "null"}, signal ${signal ?? "null"}).`,
        options
      );
    });
    child.unref?.();
    lastAutostartFailureByConfigBase.delete(key);
    autostartedByConfigBase.set(key, { child, diagnostic: command.diagnostic });
    return { status: "started", diagnostic: command.diagnostic };
  } catch (error) {
    const diagnostic = `Pi Postbox autostart failed: ${messageFrom(error)}`;
    rememberAutostartFailure(key, diagnostic, options);
    return { status: "failed", diagnostic };
  }
}

function resolveAutostartCommand(): { executable: string; args: string[]; diagnostic: string } {
  const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
  const packageLocalCli = join(packageRoot, "packages", "server", "dist", "cli.js");
  const serverArgs = ["serve", "--active-local-role", "production"];

  if (existsSync(packageLocalCli)) {
    return {
      executable: process.execPath,
      args: [packageLocalCli, ...serverArgs],
      diagnostic: `Started package-local Pi Postbox server via ${packageLocalCli}.`
    };
  }

  return {
    executable: "pi-postbox-server",
    args: serverArgs,
    diagnostic: "Started Pi Postbox server from pi-postbox-server on PATH because the package-local CLI was not found."
  };
}

function isSpawnedChildStillRunning(child: ChildProcess): boolean {
  return !child.killed && child.exitCode === null && child.signalCode === null;
}

function clearAutostartedChild(key: string, child: ChildProcess): void {
  if (autostartedByConfigBase.get(key)?.child === child) {
    autostartedByConfigBase.delete(key);
  }
}

function rememberAutostartFailure(key: string, diagnostic: string, options?: PostboxAutostartOptions): void {
  lastAutostartFailureByConfigBase.set(key, diagnostic);
  options?.onFailure?.(diagnostic);
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function autostartKey(env: NodeJS.ProcessEnv): string {
  if (env.PI_POSTBOX_CONFIG_DIR) return env.PI_POSTBOX_CONFIG_DIR;
  if (env.PI_POSTBOX_CONFIG_PATH) return dirname(env.PI_POSTBOX_CONFIG_PATH);
  return join(homedir(), ".pi-postbox");
}
