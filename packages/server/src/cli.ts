#!/usr/bin/env node
import {
  HealthResponseSchema,
  PROTOCOL_VERSION,
  SERVICE_NAME,
  parseServerProfileMetadataRecord,
  type ServerInstanceIdentity,
  type ServerProfileIdentity,
  type ServerProfileMetadataRecord
} from "@pi-postbox/protocol";
import type { FastifyInstance } from "fastify";
import { existsSync, realpathSync } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPostboxApp, type ServerInstanceAwareApp } from "./app.js";
import {
  cleanupProfileTarget,
  createProfileInstanceId,
  publishProfileTarget,
  refreshProfileTarget,
  type ProfileTargetOwner
} from "./profileTarget.js";
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
  databasePath: string;
  profile: ServerProfileIdentity;
  profileStateDir: string;
  metadataPath: string;
  buildId: string;
  sessionHideOfflineAfterMs?: number;
  sessionRetentionMs?: number;
  fcmServiceAccountPath?: string;
}

export function defaultCliDatabasePath(stateDir = join(homedir(), ".pi-postbox")): string {
  return join(stateDir, "postbox.sqlite");
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
  const statusJson = command === "status" && argv.includes("--json");

  const getFlagValue = (name: string): string | undefined => {
    const index = argv.indexOf(name);
    if (index >= 0) return argv[index + 1];

    const prefix = `${name}=`;
    const equalsArg = argv.find((arg) => arg.startsWith(prefix));
    return equalsArg?.slice(prefix.length);
  };

  const profile = parseServerProfileIdentity(getFlagValue("--profile") ?? env.PI_POSTBOX_PROFILE ?? "production");
  const profileStateDir = getFlagValue("--profile-state-dir")
    ?? env.PI_POSTBOX_PROFILE_STATE_DIR
    ?? env.PI_POSTBOX_CONFIG_DIR
    ?? (env.PI_POSTBOX_CONFIG_PATH ? dirname(env.PI_POSTBOX_CONFIG_PATH) : undefined)
    ?? defaultProfileStateDir(profile, env);
  const metadataPath = join(profileStateDir, "active-local", "server.json");
  const tailscaleEnv = (env.PI_POSTBOX_TAILSCALE ?? "").toLowerCase();
  const tailscaleRequested = argv.includes("--tailscale") || ["on", "1", "true", "yes"].includes(tailscaleEnv);
  const tailscaleDisabled = argv.includes("--no-tailscale") || ["off", "0", "false", "no"].includes(tailscaleEnv);
  const tailscaleEnabled = !tailscaleDisabled && (profile.kind === "production" || tailscaleRequested);

  const host = getFlagValue("--host") ?? env.PI_POSTBOX_HOST ?? "127.0.0.1";
  const portText = getFlagValue("--port") ?? env.PI_POSTBOX_PORT ?? String(profile.kind === "production" ? DEFAULT_POSTBOX_PORT : 0);
  const port = Number.parseInt(portText, 10);

  if (!Number.isInteger(port) || port < 0 || port > 65_535 || (profile.kind === "production" && port === 0)) {
    throw new Error(`Invalid port: ${portText}`);
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
    databasePath: getFlagValue("--database") ?? env.PI_POSTBOX_DATABASE ?? defaultCliDatabasePath(profileStateDir),
    profile,
    profileStateDir,
    metadataPath,
    buildId: getFlagValue("--build-id") ?? env.PI_POSTBOX_BUILD_ID ?? PROTOCOL_VERSION,
    sessionHideOfflineAfterMs,
    sessionRetentionMs,
    fcmServiceAccountPath:
      getFlagValue("--fcm-service-account") ?? env.PI_POSTBOX_FCM_SERVICE_ACCOUNT ?? defaultFcmServiceAccountPath(profileStateDir)
  };
}

function parseServerProfileIdentity(value: string): ServerProfileIdentity {
  if (value === "production") return { kind: "production", id: "production" };
  if (/^development:[a-f0-9]{16}$/.test(value)) return { kind: "development", id: value };
  throw new Error(`Invalid server profile: ${value}`);
}

function defaultProfileStateDir(profile: ServerProfileIdentity, env: NodeJS.ProcessEnv): string {
  if (profile.kind === "production") return join(homedir(), ".pi-postbox");
  const stateHome = env.XDG_STATE_HOME ?? join(homedir(), ".local", "state");
  return join(stateHome, "pi-postbox", "dev", profile.id.slice("development:".length));
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

function profilePublicationUrl(listenAddress: string, requestedHost: string): string {
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
  profile: ServerProfileIdentity;
  metadataPath: string;
  buildId: string;
  warn?: (message: string) => void;
  instanceId?: string;
  heartbeatIntervalMs?: number;
}

export async function listenWithPortFallback(app: FastifyInstance, options: ListenWithPortFallbackOptions): Promise<string> {
  let owner: ProfileTargetOwner | undefined;
  let heartbeatTimer: NodeJS.Timeout | undefined;

  app.addHook("onClose", async () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (owner) await cleanupProfileTarget(owner);
  });

  let address: string;
  try {
    address = await app.listen({ host: options.host, port: options.port });
  } catch (error) {
    if (!isAddressInUseError(error)) throw error;
    address = await app.listen({ host: options.host, port: 0 });
  }

  {
    const candidateOwner: ProfileTargetOwner = {
      profile: options.profile,
      metadataPath: options.metadataPath,
      url: profilePublicationUrl(address, options.host),
      instanceId: options.instanceId ?? createProfileInstanceId(),
      protocolVersion: PROTOCOL_VERSION,
      buildId: options.buildId,
      warn: options.warn
    };
    const publication = await publishProfileTarget(candidateOwner);
    if (publication.ok) {
      owner = candidateOwner;
      (app as ServerInstanceAwareApp).setServerInstance?.(toServerInstanceIdentity(publication.record));

      const heartbeatIntervalMs = options.heartbeatIntervalMs ?? 30_000;
      if (heartbeatIntervalMs > 0) {
        heartbeatTimer = setInterval(async () => {
          if (!owner) return;
          const refreshed = await refreshProfileTarget(owner);
          if (refreshed.ok) {
            (app as ServerInstanceAwareApp).setServerInstance?.(toServerInstanceIdentity(refreshed.record));
          } else if (refreshed.reason === "not-owner") {
            owner = undefined;
            (app as ServerInstanceAwareApp).setServerInstance?.(undefined);
          }
        }, heartbeatIntervalMs);
        heartbeatTimer.unref?.();
      }
    } else {
      (app as ServerInstanceAwareApp).setServerInstance?.(undefined);
    }
  }

  return address;
}

function toServerInstanceIdentity(record: ServerProfileMetadataRecord): ServerInstanceIdentity {
  const { profile, instanceId, url, protocolVersion, buildId } = record;
  return { profile, instanceId, url, protocolVersion, buildId };
}

export interface PostboxServerStatusReport {
  localUrl?: string;
  tailnetUrl?: string;
  profile: ServerProfileIdentity;
  availability: "running" | "unavailable";
  health: "ok" | "unreachable" | "unknown";
  tailscale: Pick<PostboxTailscaleStatus, "state" | "diagnostic" | "remediation" | "httpsPort">;
  remoteConfig?: string;
  diagnostics: string[];
}

const PROFILE_STATUS_TTL_MS = 60_000;
const PROFILE_STATUS_HEALTH_TIMEOUT_MS = 1_500;

export interface CollectPostboxServerStatusOptions {
  fetch?: typeof fetch;
  nowMs?: number;
  healthTimeoutMs?: number;
  inspectTailscale?: (options: PostboxTailscaleOptions) => Promise<PostboxTailscaleStatus>;
  profile?: ServerProfileIdentity;
  metadataPath?: string;
}

export async function collectPostboxServerStatus(
  env: NodeJS.ProcessEnv = process.env,
  options: CollectPostboxServerStatusOptions = {}
): Promise<PostboxServerStatusReport> {
  const profile = options.profile ?? { kind: "production", id: "production" };
  const stateDir = env.PI_POSTBOX_PROFILE_STATE_DIR ?? env.PI_POSTBOX_CONFIG_DIR ?? defaultProfileStateDir(profile, env);
  const metadataPath = options.metadataPath ?? join(stateDir, "active-local", "server.json");
  const diagnostics: string[] = [];
  const record = await readStatusMetadataRecord(metadataPath, profile, diagnostics, options.nowMs);
  let target: ServerInstanceIdentity | undefined;
  let health: "ok" | "unreachable" | "unknown" = "unknown";
  if (record) {
    const updatedAtMs = Date.parse(record.updatedAt);
    if ((options.nowMs ?? Date.now()) - updatedAtMs > PROFILE_STATUS_TTL_MS) {
      diagnostics.push(`${profile.id}: stale`);
    } else {
      const candidate = toServerInstanceIdentity(record);
      const probe = await probePostboxHealth(record.url, candidate, options);
      if (probe.ok) {
        target = candidate;
        health = "ok";
      } else {
        health = "unreachable";
        diagnostics.push(`${profile.id}: ${probe.code}`);
      }
    }
  }

  const inspectTailscale = options.inspectTailscale ?? inspectPostboxTailscaleStatus;
  const tailscale: PostboxTailscaleStatus = target && profile.kind === "production"
    ? await inspectTailscale({ localUrl: target.url, profile })
    : {
        state: "unavailable",
        localUrl: "",
        profile,
        diagnostic: profile.kind === "development"
          ? "Development profiles do not mutate Tailscale Serve automatically."
          : "No healthy Postbox target is published for this profile."
      };

  const tailnetUrl = tailscale.tailnetUrl;
  return {
    localUrl: target?.url,
    tailnetUrl,
    profile,
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

function formatStatusText(report: PostboxServerStatusReport): string {
  const lines = ["Pi Postbox status"];
  lines.push(`Local URL: ${report.localUrl ?? "unavailable"}`);
  lines.push(`Profile: ${report.profile.id} (${report.profile.kind})`);
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

async function readStatusMetadataRecord(
  path: string,
  profile: ServerProfileIdentity,
  diagnostics: string[],
  nowMs?: number
): Promise<ServerProfileMetadataRecord | undefined> {
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) {
      diagnostics.push(`${profile.id}: unsafe metadata symlink`);
      return undefined;
    }
    const parsed = parseServerProfileMetadataRecord(await readFile(path, "utf8"), {
      expectedProfile: profile,
      source: path,
      nowMs
    });
    if (parsed.ok) return parsed.record;
    diagnostics.push(...parsed.diagnostics.map((diagnostic) => `${profile.id}: ${diagnostic.code}`));
  } catch (error) {
    if (!isNodeError(error, "ENOENT")) diagnostics.push(`${profile.id}: unable to read metadata`);
  }
  return undefined;
}

// Autostarted servers inherit an arbitrary parent environment, so FCM must also be configurable by
// dropping the service-account file into the config directory rather than only via flag/env.
function defaultFcmServiceAccountPath(stateDir: string): string | undefined {
  const candidate = join(stateDir, "fcm-service-account.json");
  return existsSync(candidate) ? candidate : undefined;
}

async function probePostboxHealth(
  localUrl: string,
  expectedInstance: ServerInstanceIdentity,
  options: Pick<CollectPostboxServerStatusOptions, "fetch" | "healthTimeoutMs"> = {}
): Promise<{ ok: true } | { ok: false; code: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.healthTimeoutMs ?? PROFILE_STATUS_HEALTH_TIMEOUT_MS);
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

    const actual = parsed.data.instance;
    if (
      !actual ||
      actual.profile.kind !== expectedInstance.profile.kind ||
      actual.profile.id !== expectedInstance.profile.id ||
      actual.instanceId !== expectedInstance.instanceId ||
      actual.url !== expectedInstance.url ||
      actual.protocolVersion !== expectedInstance.protocolVersion ||
      actual.buildId !== expectedInstance.buildId
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
    const report = await collectPostboxServerStatus(env, { profile: options.profile, metadataPath: options.metadataPath });
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
    profile: options.profile,
    buildId: options.buildId,
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
    profile: options.profile,
    metadataPath: options.metadataPath,
    buildId: options.buildId,
    warn: (message) => console.warn(message)
  });
  console.log(`pi-postbox-server listening on ${address}`);
  console.log(`Profile: ${options.profile.id} (${options.profile.kind})`);
  const portNotice = describePostboxPortSelection(options.port, address);
  if (portNotice) console.warn(portNotice);

  if (options.tailscaleEnabled) {
    const tailscale = await exposePostboxWithTailscale({
      localUrl: `${address}/`,
      profile: options.profile
    });
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
