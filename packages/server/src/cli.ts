#!/usr/bin/env node
import {
  ACTIVE_LOCAL_METADATA_DIRECTORY,
  ACTIVE_LOCAL_METADATA_FILENAMES,
  ActiveLocalRoleSchema,
  HealthResponseSchema,
  SERVICE_NAME,
  parseActiveLocalMetadataRecord,
  type ActiveLocalRole,
  type ActiveLocalMetadataRecord,
  type ActiveLocalTargetIdentity
} from "@pi-postbox/protocol";
import type { FastifyInstance } from "fastify";
import { existsSync, realpathSync } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPostboxApp, type ActiveLocalTargetAwareApp } from "./app.js";
import {
  cleanupActiveLocalTarget,
  createActiveLocalInstanceId,
  publishActiveLocalTarget,
  refreshActiveLocalTarget,
  toActiveLocalTargetIdentity,
  type ActiveLocalTargetOwner
} from "./activeLocalTarget.js";
import {
  exposePostboxWithTailscale,
  inspectPostboxTailscaleStatus,
  type PostboxTailscaleOptions,
  type PostboxTailscaleStatus
} from "./tailscaleServe.js";

export const DEFAULT_POSTBOX_PORT = 32_187;

export interface CliOptions {
  command: "serve" | "status";
  statusJson: boolean;
  tailscaleEnabled: boolean;
  host: string;
  port: number;
  uiDistDir?: string;
  databasePath?: string;
  activeLocalRole: ActiveLocalRole;
  askTimeoutMs?: number;
  historyRetentionMaxAgeMs?: number;
  historyRetentionMaxRecords?: number;
  sessionHideOfflineAfterMs?: number;
  sessionRetentionMs?: number;
  fcmServiceAccountPath?: string;
}

export function defaultCliDatabasePath(): string {
  return join(homedir(), ".pi-postbox", "postbox.sqlite");
}

function parsePositiveDurationMs(value: string, label: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`Invalid ${label}: ${value}`);
  const parsed = Number(value);
  const cutoffMs = Date.now() - parsed;
  if (
    !Number.isSafeInteger(parsed) ||
    parsed <= 0 ||
    !Number.isFinite(cutoffMs) ||
    Number.isNaN(new Date(cutoffMs).getTime())
  ) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return parsed;
}

export function parseCliOptions(argv: string[], env: NodeJS.ProcessEnv): CliOptions {
  const command: "serve" | "status" = argv[0] === "status" ? "status" : "serve";
  const tailscaleEnv = (env.PI_POSTBOX_TAILSCALE ?? "").toLowerCase();
  const tailscaleEnabled = !argv.includes("--no-tailscale") && !["off", "0", "false", "no"].includes(tailscaleEnv);
  const statusJson = command === "status" && argv.includes("--json");

  const getFlagValue = (name: string): string | undefined => {
    const index = argv.indexOf(name);
    if (index >= 0) return argv[index + 1];

    const prefix = `${name}=`;
    const equalsArg = argv.find((arg) => arg.startsWith(prefix));
    return equalsArg?.slice(prefix.length);
  };

  const host = getFlagValue("--host") ?? env.PI_POSTBOX_HOST ?? "127.0.0.1";
  const portText = getFlagValue("--port") ?? env.PI_POSTBOX_PORT ?? String(DEFAULT_POSTBOX_PORT);
  const port = Number.parseInt(portText, 10);

  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`Invalid port: ${portText}`);
  }

  const activeLocalRoleText = getFlagValue("--active-local-role") ?? env.PI_POSTBOX_ACTIVE_LOCAL_ROLE ?? "production";
  const activeLocalRole = ActiveLocalRoleSchema.safeParse(activeLocalRoleText);
  if (!activeLocalRole.success) {
    throw new Error(`Invalid active-local role: ${activeLocalRoleText}`);
  }

  const askTimeoutText = getFlagValue("--ask-timeout-ms") ?? env.PI_POSTBOX_ASK_TIMEOUT_MS;
  let askTimeoutMs: number | undefined;
  if (askTimeoutText !== undefined) {
    const parsedAskTimeoutMs = Number.parseInt(askTimeoutText, 10);
    if (!Number.isInteger(parsedAskTimeoutMs) || parsedAskTimeoutMs <= 0) {
      throw new Error(`Invalid ask timeout: ${askTimeoutText}`);
    }
    askTimeoutMs = parsedAskTimeoutMs;
  }

  const historyRetentionMaxAgeText = getFlagValue("--history-retention-max-age-ms") ?? env.PI_POSTBOX_HISTORY_RETENTION_MAX_AGE_MS;
  let historyRetentionMaxAgeMs: number | undefined;
  if (historyRetentionMaxAgeText !== undefined) {
    const parsed = Number.parseInt(historyRetentionMaxAgeText, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(`Invalid history retention max age: ${historyRetentionMaxAgeText}`);
    }
    historyRetentionMaxAgeMs = parsed;
  }

  const historyRetentionMaxRecordsText = getFlagValue("--history-retention-max-records") ?? env.PI_POSTBOX_HISTORY_RETENTION_MAX_RECORDS;
  let historyRetentionMaxRecords: number | undefined;
  if (historyRetentionMaxRecordsText !== undefined) {
    const parsed = Number.parseInt(historyRetentionMaxRecordsText, 10);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new Error(`Invalid history retention max records: ${historyRetentionMaxRecordsText}`);
    }
    historyRetentionMaxRecords = parsed;
  }

  const sessionHideOfflineAfterText =
    getFlagValue("--session-hide-offline-after-ms") ?? env.PI_POSTBOX_SESSION_HIDE_OFFLINE_AFTER_MS;
  const sessionHideOfflineAfterMs = sessionHideOfflineAfterText === undefined
    ? undefined
    : parsePositiveDurationMs(sessionHideOfflineAfterText, "session hide-offline-after");

  const sessionRetentionText = getFlagValue("--session-retention-ms") ?? env.PI_POSTBOX_SESSION_RETENTION_MS;
  const sessionRetentionMs = sessionRetentionText === undefined
    ? undefined
    : parsePositiveDurationMs(sessionRetentionText, "session retention");

  return {
    command,
    statusJson,
    tailscaleEnabled,
    host,
    port,
    uiDistDir: getFlagValue("--ui-dist-dir") ?? env.PI_POSTBOX_UI_DIST_DIR,
    databasePath: getFlagValue("--database") ?? env.PI_POSTBOX_DATABASE ?? defaultCliDatabasePath(),
    activeLocalRole: activeLocalRole.data,
    askTimeoutMs,
    historyRetentionMaxAgeMs,
    historyRetentionMaxRecords,
    sessionHideOfflineAfterMs,
    sessionRetentionMs,
    fcmServiceAccountPath:
      getFlagValue("--fcm-service-account") ?? env.PI_POSTBOX_FCM_SERVICE_ACCOUNT ?? defaultFcmServiceAccountPath(env)
  };
}

function isAddressInUseError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "EADDRINUSE";
}

function portFromListenAddress(listenAddress: string): number | undefined {
  try {
    const port = Number(new URL(listenAddress).port);
    return Number.isInteger(port) && port > 0 ? port : undefined;
  } catch {
    return undefined;
  }
}

export function describePostboxPortSelection(requestedPort: number, listenAddress: string): string | undefined {
  const actualPort = portFromListenAddress(listenAddress);
  if (!actualPort) return undefined;

  if (actualPort !== requestedPort) {
    return `Preferred Postbox port ${requestedPort} is in use; using fallback port ${actualPort}. This changes the local and Tailnet bookmark URLs. Free port ${requestedPort}, or set --port/PI_POSTBOX_PORT to a stable available port, to keep Postbox on a canonical URL.`;
  }

  if (actualPort !== DEFAULT_POSTBOX_PORT) {
    return `Postbox is using non-default port ${actualPort}; the canonical default is ${DEFAULT_POSTBOX_PORT}. Bookmark the printed URL for this configuration.`;
  }

  return undefined;
}

function activeLocalPublicationUrl(listenAddress: string, requestedHost: string): string {
  if (requestedHost !== "0.0.0.0" && requestedHost !== "::") {
    return listenAddress;
  }

  const url = new URL(listenAddress);
  const host = requestedHost === "::" ? "[::]" : requestedHost;
  return `${url.protocol}//${host}:${url.port}`;
}

export interface ListenWithPortFallbackOptions {
  host: string;
  port: number;
  activeLocalRole?: ActiveLocalRole;
  env?: NodeJS.ProcessEnv;
  warn?: (message: string) => void;
  instanceId?: string;
  heartbeatIntervalMs?: number;
}

export async function listenWithPortFallback(app: FastifyInstance, options: ListenWithPortFallbackOptions): Promise<string> {
  let owner: ActiveLocalTargetOwner | undefined;
  let heartbeatTimer: NodeJS.Timeout | undefined;

  if (options.activeLocalRole) {
    app.addHook("onClose", async () => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (owner) {
        await cleanupActiveLocalTarget(owner);
      }
    });
  }

  let address: string;
  try {
    address = await app.listen({ host: options.host, port: options.port });
  } catch (error) {
    if (!isAddressInUseError(error)) throw error;
    address = await app.listen({ host: options.host, port: 0 });
  }

  if (options.activeLocalRole) {
    const candidateOwner: ActiveLocalTargetOwner = {
      role: options.activeLocalRole,
      url: activeLocalPublicationUrl(address, options.host),
      instanceId: options.instanceId ?? createActiveLocalInstanceId(),
      env: options.env,
      warn: options.warn
    };
    const publication = await publishActiveLocalTarget(candidateOwner);
    if (publication.ok) {
      owner = candidateOwner;
      (app as ActiveLocalTargetAwareApp).setActiveLocalTarget?.(toActiveLocalTargetIdentity(publication.record));

      const heartbeatIntervalMs = options.heartbeatIntervalMs ?? 30_000;
      if (heartbeatIntervalMs > 0) {
        heartbeatTimer = setInterval(async () => {
          if (!owner) return;
          const refreshed = await refreshActiveLocalTarget(owner);
          if (refreshed.ok) {
            (app as ActiveLocalTargetAwareApp).setActiveLocalTarget?.(toActiveLocalTargetIdentity(refreshed.record));
          } else if (refreshed.reason === "not-owner") {
            owner = undefined;
            (app as ActiveLocalTargetAwareApp).setActiveLocalTarget?.(undefined);
          }
        }, heartbeatIntervalMs);
        heartbeatTimer.unref?.();
      }
    } else {
      (app as ActiveLocalTargetAwareApp).setActiveLocalTarget?.(undefined);
    }
  }

  return address;
}

export interface PostboxServerStatusReport {
  localUrl?: string;
  tailnetUrl?: string;
  role?: ActiveLocalRole;
  availability: "running" | "unavailable";
  health: "ok" | "unreachable" | "unknown";
  tailscale: Pick<PostboxTailscaleStatus, "state" | "diagnostic" | "remediation" | "httpsPort">;
  remoteConfig?: string;
  diagnostics: string[];
}

const ACTIVE_LOCAL_STATUS_TTL_MS = 60_000;
const ACTIVE_LOCAL_STATUS_HEALTH_TIMEOUT_MS = 1_500;
const ACTIVE_LOCAL_STATUS_ROLE_ORDER: ActiveLocalRole[] = ["dev", "production"];

export interface CollectPostboxServerStatusOptions {
  fetch?: typeof fetch;
  nowMs?: number;
  healthTimeoutMs?: number;
  inspectTailscale?: (options: PostboxTailscaleOptions) => Promise<PostboxTailscaleStatus>;
}

export async function collectPostboxServerStatus(
  env: NodeJS.ProcessEnv = process.env,
  options: CollectPostboxServerStatusOptions = {}
): Promise<PostboxServerStatusReport> {
  const diagnostics: string[] = [];
  const records = await readStatusMetadataRecords(env, diagnostics, options.nowMs);
  const selected = await selectHealthyStatusTarget(records, diagnostics, options);
  const target = selected.target;
  const health: "ok" | "unreachable" | "unknown" = target ? "ok" : selected.sawHealthFailure ? "unreachable" : "unknown";

  const inspectTailscale = options.inspectTailscale ?? inspectPostboxTailscaleStatus;
  const tailscale: PostboxTailscaleStatus = target
    ? await inspectTailscale({ localUrl: target.url, role: target.role })
    : {
        state: "unavailable",
        localUrl: "",
        role: "production",
        diagnostic: "No healthy active local Postbox target is published."
      };

  const tailnetUrl = tailscale.tailnetUrl;
  return {
    localUrl: target?.url,
    tailnetUrl,
    role: target?.role,
    availability: target ? "running" : "unavailable",
    health,
    tailscale: {
      state: tailscale.state,
      diagnostic: tailscale.diagnostic,
      remediation: tailscale.remediation,
      httpsPort: tailscale.httpsPort
    },
    remoteConfig: tailnetUrl ? `export PI_POSTBOX_URL=${tailnetUrl}` : undefined,
    diagnostics
  };
}

async function selectHealthyStatusTarget(
  records: ActiveLocalMetadataRecord[],
  diagnostics: string[],
  options: Pick<CollectPostboxServerStatusOptions, "fetch" | "healthTimeoutMs" | "nowMs">
): Promise<{ target?: ActiveLocalTargetIdentity; sawHealthFailure: boolean }> {
  const nowMs = options.nowMs ?? Date.now();
  let sawHealthFailure = false;

  for (const role of ACTIVE_LOCAL_STATUS_ROLE_ORDER) {
    const record = records.find((candidate) => candidate.role === role);
    if (!record) continue;

    const updatedAtMs = Date.parse(record.updatedAt);
    if (!Number.isFinite(updatedAtMs) || updatedAtMs > nowMs || nowMs - updatedAtMs > ACTIVE_LOCAL_STATUS_TTL_MS) {
      diagnostics.push(`${role}: stale`);
      continue;
    }

    const target = { role: record.role, instanceId: record.instanceId, url: record.url };
    const health = await probePostboxHealth(record.url, target, options);
    if (health.ok) {
      return { target, sawHealthFailure };
    }

    sawHealthFailure = true;
    diagnostics.push(`${role}: ${health.code}`);
  }

  return { sawHealthFailure };
}

function formatStatusText(report: PostboxServerStatusReport): string {
  const lines = ["Pi Postbox status"];
  lines.push(`Local URL: ${report.localUrl ?? "unavailable"}`);
  lines.push(`Role: ${report.role ?? "unknown"}`);
  lines.push(`Availability: ${report.availability} (health: ${report.health})`);
  lines.push(`Tailscale Serve: ${report.tailscale.state}${report.tailscale.diagnostic ? ` - ${report.tailscale.diagnostic}` : ""}`);
  if (report.tailnetUrl) lines.push(`Tailnet URL: ${report.tailnetUrl}`);
  if (report.remoteConfig) {
    lines.push("Remote Pi machines remain explicit. Copy this where needed:");
    lines.push(report.remoteConfig);
  }
  if (report.tailscale.remediation) lines.push(`Remediation: ${report.tailscale.remediation}`);
  if (report.diagnostics.length > 0) lines.push(`Diagnostics: ${report.diagnostics.join(", ")}`);
  return `${lines.join("\n")}\n`;
}

async function readStatusMetadataRecords(
  env: NodeJS.ProcessEnv,
  diagnostics: string[],
  nowMs?: number
): Promise<ActiveLocalMetadataRecord[]> {
  const records: ActiveLocalMetadataRecord[] = [];
  for (const role of ["dev", "production"] as const) {
    const path = join(configBaseDir(env), ACTIVE_LOCAL_METADATA_DIRECTORY, ACTIVE_LOCAL_METADATA_FILENAMES[role]);
    try {
      const stat = await lstat(path);
      if (stat.isSymbolicLink()) {
        diagnostics.push(`${role}: unsafe metadata symlink`);
        continue;
      }
      const parsed = parseActiveLocalMetadataRecord(await readFile(path, "utf8"), { expectedRole: role, source: path, nowMs });
      if (parsed.ok) records.push(parsed.record);
      else diagnostics.push(...parsed.diagnostics.map((diagnostic) => `${role}: ${diagnostic.code}`));
    } catch (error) {
      if (!isNodeError(error, "ENOENT")) diagnostics.push(`${role}: unable to read metadata`);
    }
  }
  return records;
}

// Autostarted servers inherit an arbitrary parent environment, so FCM must also be configurable by
// dropping the service-account file into the config directory rather than only via flag/env.
function defaultFcmServiceAccountPath(env: NodeJS.ProcessEnv): string | undefined {
  const candidate = join(configBaseDir(env), "fcm-service-account.json");
  return existsSync(candidate) ? candidate : undefined;
}

function configBaseDir(env: NodeJS.ProcessEnv): string {
  if (env.PI_POSTBOX_CONFIG_DIR) return env.PI_POSTBOX_CONFIG_DIR;
  if (env.PI_POSTBOX_CONFIG_PATH) return dirname(env.PI_POSTBOX_CONFIG_PATH);
  return join(homedir(), ".pi-postbox");
}

async function probePostboxHealth(
  localUrl: string,
  expectedLocalTarget: ActiveLocalTargetIdentity,
  options: Pick<CollectPostboxServerStatusOptions, "fetch" | "healthTimeoutMs"> = {}
): Promise<{ ok: true } | { ok: false; code: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.healthTimeoutMs ?? ACTIVE_LOCAL_STATUS_HEALTH_TIMEOUT_MS);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  try {
    const response = await fetchImpl(new URL("healthz", localUrl), { signal: controller.signal });
    if (!response.ok) return { ok: false, code: "health-status" };

    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || (body as { service?: unknown }).service !== SERVICE_NAME) {
      return { ok: false, code: "health-service-mismatch" };
    }

    const parsed = HealthResponseSchema.safeParse(body);
    if (!parsed.success) return { ok: false, code: "health-invalid" };

    const actual = parsed.data.localTarget;
    if (
      !actual ||
      actual.role !== expectedLocalTarget.role ||
      actual.instanceId !== expectedLocalTarget.instanceId ||
      actual.url !== expectedLocalTarget.url
    ) {
      return { ok: false, code: "health-identity-mismatch" };
    }

    return { ok: true };
  } catch {
    return { ok: false, code: "health-unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

function isNodeError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}

export async function main(argv = process.argv.slice(2), env = process.env): Promise<void> {
  const options = parseCliOptions(argv, env);

  if (options.command === "status") {
    const report = await collectPostboxServerStatus(env);
    console.log(options.statusJson ? JSON.stringify(report, null, 2) : formatStatusText(report));
    return;
  }

  let shuttingDown = false;
  async function requestShutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await app.close();
    } finally {
      process.exit(0);
    }
  }

  const app = await createPostboxApp({
    logger: true,
    uiDistDir: options.uiDistDir,
    databasePath: options.databasePath,
    askTimeoutMs: options.askTimeoutMs,
    historyRetentionMaxAgeMs: options.historyRetentionMaxAgeMs,
    historyRetentionMaxRecords: options.historyRetentionMaxRecords,
    sessionHideOfflineAfterMs: options.sessionHideOfflineAfterMs,
    sessionRetentionMs: options.sessionRetentionMs,
    fcmServiceAccountPath: options.fcmServiceAccountPath,
    onShutdownRequest: () => void requestShutdown()
  });

  process.once("SIGINT", () => void requestShutdown());
  process.once("SIGTERM", () => void requestShutdown());

  const address = await listenWithPortFallback(app, {
    host: options.host,
    port: options.port,
    activeLocalRole: options.activeLocalRole,
    env,
    warn: (message) => console.warn(message)
  });
  console.log(`pi-postbox-server listening on ${address}`);
  const portNotice = describePostboxPortSelection(options.port, address);
  if (portNotice) console.warn(portNotice);

  if (options.tailscaleEnabled) {
    const tailscale = await exposePostboxWithTailscale({ localUrl: `${address}/`, role: options.activeLocalRole });
    console.log(`Tailscale Serve: ${tailscale.state}${tailscale.diagnostic ? ` - ${tailscale.diagnostic}` : ""}`);
    if (tailscale.tailnetUrl) {
      console.log(`Tailnet URL: ${tailscale.tailnetUrl}`);
      console.log(`Remote Pi machines: export PI_POSTBOX_URL=${tailscale.tailnetUrl}`);
    }
    if (tailscale.remediation) console.log(tailscale.remediation);
  } else {
    console.log("Tailscale Serve: disabled by --no-tailscale or PI_POSTBOX_TAILSCALE=off");
  }
}

export function isCliEntrypoint(moduleUrl: string, argv1: string | undefined): boolean {
  if (!argv1) return false;

  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(argv1);
  } catch {
    return false;
  }
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
