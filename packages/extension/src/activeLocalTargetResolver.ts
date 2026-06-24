import {
  HealthResponseSchema,
  type ActiveLocalDiagnostic,
  type ActiveLocalMetadataRecord,
  type ActiveLocalRole,
  type ActiveLocalTargetIdentity
} from "@pi-postbox/protocol";
import { lstat, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { readExtensionConfig } from "./config.js";

export type ActiveLocalTargetSource = "explicit-remote" | "active-local" | "configured-loopback";

export interface ResolvedActiveLocalTarget {
  source: ActiveLocalTargetSource;
  url: string;
  role?: ActiveLocalRole;
  instanceId?: string;
  activeLocalPollingEnabled: boolean;
}

export type ResolveActiveLocalTargetResult =
  | { status: "selected"; target: ResolvedActiveLocalTarget; diagnostics: ActiveLocalDiagnostic[] }
  | { status: "unavailable"; target?: undefined; diagnostics: ActiveLocalDiagnostic[] };

export interface ResolveActiveLocalTargetOptions {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  nowMs?: number;
  ttlMs?: number;
  maxMetadataBytes?: number;
  healthTimeoutMs?: number;
  skipConfiguredRemote?: boolean;
}

const ACTIVE_LOCAL_METADATA_VERSION = 1;
const ACTIVE_LOCAL_METADATA_DIRECTORY = "active-local";
const ACTIVE_LOCAL_METADATA_FILENAMES = {
  dev: "dev.json",
  production: "production.json"
} as const;
const DEFAULT_METADATA_TTL_MS = 6 * 60 * 60 * 1_000;
const DEFAULT_MAX_METADATA_BYTES = 4_096;
const DEFAULT_HEALTH_TIMEOUT_MS = 1_000;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLE_ORDER: ActiveLocalRole[] = ["dev", "production"];

export async function resolveActiveLocalTarget(
  options: ResolveActiveLocalTargetOptions = {}
): Promise<ResolveActiveLocalTargetResult> {
  const env = options.env ?? process.env;
  const diagnostics: ActiveLocalDiagnostic[] = [];
  const config = await readExtensionConfig(env);
  const configuredUrl = config.serverUrl;
  const configuredLoopback = configuredUrl ? normalizeConfiguredLoopbackUrl(configuredUrl) : undefined;

  if (!options.skipConfiguredRemote && configuredUrl && !configuredLoopback) {
    const verified = await verifyHealth(configuredUrl, { fetch: options.fetch, timeoutMs: options.healthTimeoutMs });
    if (verified.ok) {
      return {
        status: "selected",
        target: {
          source: "explicit-remote",
          url: configuredUrl,
          activeLocalPollingEnabled: false
        },
        diagnostics
      };
    }
    diagnostics.push({ code: verified.code, source: "explicit-remote" });
  }

  const records = await readActiveLocalMetadata(env, options, diagnostics);
  for (const role of ROLE_ORDER) {
    const record = records.find((candidate) => candidate.role === role);
    if (!record) continue;

    const updatedAtMs = Date.parse(record.updatedAt);
    const nowMs = options.nowMs ?? Date.now();
    if (!Number.isFinite(updatedAtMs) || updatedAtMs > nowMs || nowMs - updatedAtMs > (options.ttlMs ?? DEFAULT_METADATA_TTL_MS)) {
      diagnostics.push({ code: "stale", role, source: ACTIVE_LOCAL_METADATA_FILENAMES[role] });
      continue;
    }

    const verified = await verifyHealth(record.url, {
      fetch: options.fetch,
      timeoutMs: options.healthTimeoutMs,
      expectedLocalTarget: record
    });
    if (!verified.ok) {
      diagnostics.push({ code: verified.code, role, source: ACTIVE_LOCAL_METADATA_FILENAMES[role] });
      continue;
    }

    return {
      status: "selected",
      target: {
        source: "active-local",
        role: record.role,
        instanceId: record.instanceId,
        url: record.url,
        activeLocalPollingEnabled: true
      },
      diagnostics
    };
  }

  if (configuredLoopback) {
    const verified = await verifyHealth(configuredLoopback, { fetch: options.fetch, timeoutMs: options.healthTimeoutMs });
    if (verified.ok) {
      return {
        status: "selected",
        target: {
          source: "configured-loopback",
          url: configuredLoopback,
          activeLocalPollingEnabled: true
        },
        diagnostics
      };
    }
    diagnostics.push({ code: verified.code, source: "configured-loopback" });
  }

  return { status: "unavailable", diagnostics };
}

async function readActiveLocalMetadata(
  env: NodeJS.ProcessEnv,
  options: ResolveActiveLocalTargetOptions,
  diagnostics: ActiveLocalDiagnostic[]
): Promise<ActiveLocalMetadataRecord[]> {
  const baseDir = activeLocalConfigBaseDir(env);
  const records: ActiveLocalMetadataRecord[] = [];

  for (const role of ROLE_ORDER) {
    const source = ACTIVE_LOCAL_METADATA_FILENAMES[role];
    const path = join(baseDir, ACTIVE_LOCAL_METADATA_DIRECTORY, source);
    const stat = await lstat(path).catch((error: unknown) => {
      if (isNodeError(error, "ENOENT")) return undefined;
      diagnostics.push({ code: "read-error", role, source });
      return undefined;
    });
    if (!stat) {
      diagnostics.push({ code: "missing", role, source });
      continue;
    }
    if (stat.isSymbolicLink()) {
      diagnostics.push({ code: "symlink", role, source });
      continue;
    }
    if (!stat.isFile()) {
      diagnostics.push({ code: "not-file", role, source });
      continue;
    }

    const maxBytes = options.maxMetadataBytes ?? DEFAULT_MAX_METADATA_BYTES;
    if (stat.size > maxBytes) {
      diagnostics.push({ code: "too-large", role, source });
      continue;
    }

    const text = await readFile(path, "utf8").catch(() => undefined);
    if (text === undefined) {
      diagnostics.push({ code: "read-error", role, source });
      continue;
    }

    const parsed = parseActiveLocalMetadataRecord(text, {
      expectedRole: role,
      nowMs: options.nowMs,
      ttlMs: options.ttlMs,
      maxBytes,
      source
    });
    if (parsed.ok) {
      records.push(parsed.record);
    } else {
      diagnostics.push(...parsed.diagnostics.map((diagnostic) => ({ ...diagnostic, source })));
    }
  }

  return records;
}

function parseActiveLocalMetadataRecord(
  input: string,
  options: {
    expectedRole: ActiveLocalRole | string;
    nowMs?: number;
    ttlMs?: number;
    maxBytes?: number;
    source?: string;
  }
): { ok: true; record: ActiveLocalMetadataRecord } | { ok: false; diagnostics: ActiveLocalDiagnostic[] } {
  const context = { role: options.expectedRole, source: options.source };
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_METADATA_BYTES;
  if (Buffer.byteLength(input, "utf8") > maxBytes) {
    return { ok: false, diagnostics: [{ ...context, code: "too-large" }] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return { ok: false, diagnostics: [{ ...context, code: "malformed-json" }] };
  }

  if (!isPlainRecord(parsed)) {
    return { ok: false, diagnostics: [{ ...context, code: "invalid-record" }] };
  }
  if (parsed.version !== ACTIVE_LOCAL_METADATA_VERSION) {
    return { ok: false, diagnostics: [{ ...context, code: "invalid-version", field: "version" }] };
  }
  if (parsed.role !== "dev" && parsed.role !== "production") {
    return { ok: false, diagnostics: [{ ...context, code: "invalid-role", field: "role" }] };
  }
  if (parsed.role !== options.expectedRole) {
    return { ok: false, diagnostics: [{ ...context, code: "role-mismatch", role: parsed.role, field: "role" }] };
  }
  if (typeof parsed.instanceId !== "string" || !UUID_V4_PATTERN.test(parsed.instanceId)) {
    return { ok: false, diagnostics: [{ ...context, code: "invalid-instance-id", field: "instanceId" }] };
  }
  if (typeof parsed.url !== "string") {
    return { ok: false, diagnostics: [{ ...context, code: "invalid-url", field: "url" }] };
  }
  const normalizedUrl = normalizeStrictLoopbackUrl(parsed.url);
  if (!normalizedUrl) {
    return { ok: false, diagnostics: [{ ...context, code: "unsafe-url", field: "url" }] };
  }
  if (typeof parsed.updatedAt !== "string") {
    return { ok: false, diagnostics: [{ ...context, code: "invalid-timestamp", field: "updatedAt" }] };
  }
  const updatedAtMs = Date.parse(parsed.updatedAt);
  if (!Number.isFinite(updatedAtMs) || new Date(updatedAtMs).toISOString() !== parsed.updatedAt) {
    return { ok: false, diagnostics: [{ ...context, code: "invalid-timestamp", field: "updatedAt" }] };
  }
  const nowMs = options.nowMs ?? Date.now();
  if (updatedAtMs > nowMs) {
    return { ok: false, diagnostics: [{ ...context, code: "future-timestamp", field: "updatedAt" }] };
  }

  return {
    ok: true,
    record: {
      version: ACTIVE_LOCAL_METADATA_VERSION,
      role: parsed.role,
      url: normalizedUrl,
      instanceId: parsed.instanceId,
      updatedAt: parsed.updatedAt
    }
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function activeLocalConfigBaseDir(env: NodeJS.ProcessEnv): string {
  if (env.PI_POSTBOX_CONFIG_DIR) return env.PI_POSTBOX_CONFIG_DIR;
  if (env.PI_POSTBOX_CONFIG_PATH) return dirname(env.PI_POSTBOX_CONFIG_PATH);
  return join(homedir(), ".pi-postbox");
}

function normalizeConfiguredLoopbackUrl(input: string): string | undefined {
  const activeLocalSafe = normalizeStrictLoopbackUrl(input);
  if (activeLocalSafe) return activeLocalSafe;

  try {
    const url = new URL(input);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return undefined;
    if (url.search || url.hash) return undefined;
    if (url.port === "") return undefined;

    const authority = input.match(/^[a-zA-Z][a-zA-Z\d+.-]*:\/\/([^/?#]*)/)?.[1];
    const loopbackHost = authority ? normalizeConfiguredLoopbackAuthority(authority, { allowLocalhost: true }) : undefined;
    if (!loopbackHost) return undefined;

    const hostForUrl = loopbackHost === "::1" ? "[::1]" : loopbackHost;
    return `${url.protocol}//${hostForUrl}:${url.port}/`;
  } catch {
    return undefined;
  }
}

function normalizeStrictLoopbackUrl(input: string): string | undefined {
  if (typeof input !== "string" || input.length === 0 || input !== input.trim()) return undefined;

  const authorityMatch = input.match(/^([a-zA-Z][a-zA-Z\d+.-]*):\/\/([^/?#]*)/);
  if (!authorityMatch) return undefined;

  const scheme = authorityMatch[1].toLowerCase();
  const authority = authorityMatch[2];
  if ((scheme !== "http" && scheme !== "https") || authority.length === 0 || authority.includes("@")) return undefined;

  const parsedAuthority = normalizeConfiguredLoopbackAuthority(authority, { allowLocalhost: false });
  if (!parsedAuthority) return undefined;

  try {
    const url = new URL(input);
    if (
      url.protocol !== `${scheme}:` ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.port === ""
    ) {
      return undefined;
    }

    const hostForUrl = parsedAuthority === "::1" ? "[::1]" : parsedAuthority;
    return `${scheme}://${hostForUrl}:${url.port}/`;
  } catch {
    return undefined;
  }
}

function normalizeConfiguredLoopbackAuthority(authority: string, options: { allowLocalhost?: boolean } = {}): string | undefined {
  const ipv6Match = authority.match(/^\[::1\]:(\d+)$/i);
  if (ipv6Match) return isValidPort(ipv6Match[1]) ? "::1" : undefined;

  const match = authority.match(/^([^:]+):(\d+)$/);
  if (!match || !isValidPort(match[2])) return undefined;

  const host = match[1].toLowerCase();
  if (options.allowLocalhost && host === "localhost") return "127.0.0.1";
  if (isStrictIpv4LoopbackLiteral(host)) return host;
  return undefined;
}

function isValidPort(rawPort: string): boolean {
  if (!/^[1-9]\d{0,4}$/.test(rawPort)) return false;
  const port = Number(rawPort);
  return Number.isInteger(port) && port >= 1 && port <= 65_535;
}

function isStrictIpv4LoopbackLiteral(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;

  const octets = parts.map((part) => {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return undefined;
    const value = Number(part);
    return value >= 0 && value <= 255 ? value : undefined;
  });

  return octets.every((value) => value !== undefined) && octets[0] === 127;
}

async function verifyHealth(
  baseUrl: string,
  options: {
    fetch?: typeof fetch;
    timeoutMs?: number;
    expectedLocalTarget?: ActiveLocalTargetIdentity;
  }
): Promise<{ ok: true } | { ok: false; code: string }> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (!fetchImpl) return { ok: false, code: "health-unavailable" };

  let response: Response;
  try {
    response = await fetchImpl(new URL("healthz", baseUrl), {
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS)
    });
  } catch {
    return { ok: false, code: "health-unreachable" };
  }

  if (response.status !== 200) return { ok: false, code: "health-status" };

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, code: "health-invalid" };
  }

  const parsed = HealthResponseSchema.safeParse(body);
  if (!parsed.success) return { ok: false, code: "health-invalid" };

  if (options.expectedLocalTarget) {
    const actual = parsed.data.localTarget;
    if (!actual) return { ok: false, code: "health-identity-mismatch" };
    const actualUrl = normalizeStrictLoopbackUrl(actual.url);
    if (
      actual.role !== options.expectedLocalTarget.role ||
      actual.instanceId !== options.expectedLocalTarget.instanceId ||
      actualUrl !== options.expectedLocalTarget.url
    ) {
      return { ok: false, code: "health-identity-mismatch" };
    }
  }

  return { ok: true };
}

function isNodeError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}
