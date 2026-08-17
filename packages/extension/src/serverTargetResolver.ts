import {
  HealthResponseSchema,
  PROTOCOL_VERSION,
  SERVICE_NAME,
  parseServerProfileMetadataRecord,
  type ServerInstanceIdentity,
  type ServerProfileIdentity,
  type ServerProfileMetadataDiagnostic
} from "@pi-postbox/protocol";
import { lstat, readFile } from "node:fs/promises";
import { basename } from "node:path";
import { readExtensionConfig } from "./config.js";
import {
  resolveServerProfile,
  type ResolveServerProfileOptions,
  type ResolvedServerProfile
} from "./serverProfile.js";

export type ServerTargetSource = "explicit-override" | "profile-config" | "profile-metadata";

export interface ResolvedServerTarget {
  source: ServerTargetSource;
  url: string;
  profile: ServerProfileIdentity;
  version: string;
  protocolVersion: string;
  instanceId?: string;
  buildId: string;
  profilePollingEnabled: boolean;
}

export type ResolveServerTargetResult =
  | {
      status: "selected";
      profile: ResolvedServerProfile;
      target: ResolvedServerTarget;
      diagnostics: ServerProfileMetadataDiagnostic[];
    }
  | {
      status: "unavailable";
      profile: ResolvedServerProfile;
      diagnostics: ServerProfileMetadataDiagnostic[];
    };

export interface ResolveServerTargetOptions extends ResolveServerProfileOptions {
  fetch?: typeof fetch;
  nowMs?: number;
  ttlMs?: number;
  maxMetadataBytes?: number;
  healthTimeoutMs?: number;
  skipConfiguredUrl?: boolean;
  profile?: ResolvedServerProfile;
}

const DEFAULT_METADATA_TTL_MS = 6 * 60 * 60 * 1_000;
const DEFAULT_HEALTH_TIMEOUT_MS = 1_000;

export async function resolveServerTarget(options: ResolveServerTargetOptions = {}): Promise<ResolveServerTargetResult> {
  const env = options.env ?? process.env;
  const profile = options.profile ?? resolveServerProfile(options);
  const expectedProfile = profileIdentity(profile);
  const diagnostics: ServerProfileMetadataDiagnostic[] = [];
  const config = await readExtensionConfig(env, profile);

  if (!options.skipConfiguredUrl && config.serverUrl) {
    const verified = await verifyHealth(config.serverUrl, options);
    if (verified.ok) {
      return {
        status: "selected",
        profile,
        target: {
          source: env.PI_POSTBOX_URL ? "explicit-override" : "profile-config",
          url: config.serverUrl,
          profile: verified.health.profile,
          version: verified.health.version,
          protocolVersion: verified.health.protocolVersion,
          instanceId: verified.health.instance?.instanceId,
          buildId: verified.health.buildId,
          profilePollingEnabled: false
        },
        diagnostics
      };
    }
    diagnostics.push({ code: verified.code, source: env.PI_POSTBOX_URL ? "PI_POSTBOX_URL" : "config.json" });
  }

  const metadata = await readProfileMetadata(profile, expectedProfile, options, diagnostics);
  if (metadata) {
    const verified = await verifyHealth(metadata.url, options, metadata);
    if (verified.ok) {
      return {
        status: "selected",
        profile,
        target: {
          source: "profile-metadata",
          url: metadata.url,
          profile: metadata.profile,
          version: verified.health.version,
          protocolVersion: verified.health.protocolVersion,
          instanceId: metadata.instanceId,
          buildId: metadata.buildId,
          profilePollingEnabled: true
        },
        diagnostics
      };
    }
    diagnostics.push({ code: verified.code, source: basename(profile.metadataPath) });
  }

  return { status: "unavailable", profile, diagnostics };
}

async function readProfileMetadata(
  profile: ResolvedServerProfile,
  expectedProfile: ServerProfileIdentity,
  options: ResolveServerTargetOptions,
  diagnostics: ServerProfileMetadataDiagnostic[]
) {
  const source = basename(profile.metadataPath);
  let stat;
  try {
    stat = await lstat(profile.metadataPath);
  } catch (error) {
    diagnostics.push({ code: isNodeError(error, "ENOENT") ? "missing" : "read-error", source });
    return undefined;
  }
  if (stat.isSymbolicLink()) {
    diagnostics.push({ code: "symlink", source });
    return undefined;
  }
  if (!stat.isFile()) {
    diagnostics.push({ code: "not-file", source });
    return undefined;
  }

  const maxBytes = options.maxMetadataBytes ?? 4_096;
  if (stat.size > maxBytes) {
    diagnostics.push({ code: "too-large", source });
    return undefined;
  }

  const text = await readFile(profile.metadataPath, "utf8").catch(() => undefined);
  if (text === undefined) {
    diagnostics.push({ code: "read-error", source });
    return undefined;
  }
  const parsed = parseServerProfileMetadataRecord(text, {
    expectedProfile,
    nowMs: options.nowMs,
    maxBytes,
    source
  });
  if (!parsed.ok) {
    diagnostics.push(...parsed.diagnostics);
    return undefined;
  }

  const nowMs = options.nowMs ?? Date.now();
  if (nowMs - Date.parse(parsed.record.updatedAt) > (options.ttlMs ?? DEFAULT_METADATA_TTL_MS)) {
    diagnostics.push({ code: "stale", source });
    return undefined;
  }
  return parsed.record;
}

async function verifyHealth(
  baseUrl: string,
  options: Pick<ResolveServerTargetOptions, "fetch" | "healthTimeoutMs">,
  expectedInstance?: ServerInstanceIdentity
): Promise<{ ok: true; health: import("@pi-postbox/protocol").HealthResponse } | { ok: false; code: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS);
  try {
    const response = await (options.fetch ?? globalThis.fetch)(new URL("healthz", baseUrl), {
      signal: controller.signal,
      redirect: "manual"
    });
    if (!response.ok) return { ok: false, code: "health-status" };
    const body: unknown = await response.json();
    if (!isRecord(body) || body.service !== SERVICE_NAME) return { ok: false, code: "health-service-mismatch" };
    if (body.protocolVersion !== PROTOCOL_VERSION) return { ok: false, code: "incompatible-protocol" };
    const parsed = HealthResponseSchema.safeParse(body);
    if (!parsed.success) return { ok: false, code: "health-invalid" };

    if (expectedInstance) {
      const actual = parsed.data.instance;
      if (!actual || !sameInstance(actual, expectedInstance) || !sameProfile(parsed.data.profile, expectedInstance.profile)) {
        return { ok: false, code: "health-identity-mismatch" };
      }
    }
    return { ok: true, health: parsed.data };
  } catch {
    return { ok: false, code: "health-unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

function sameInstance(actual: ServerInstanceIdentity, expected: ServerInstanceIdentity): boolean {
  return sameProfile(actual.profile, expected.profile)
    && actual.instanceId === expected.instanceId
    && actual.url === expected.url
    && actual.protocolVersion === expected.protocolVersion
    && actual.buildId === expected.buildId;
}

function sameProfile(actual: ServerProfileIdentity, expected: ServerProfileIdentity): boolean {
  return actual.kind === expected.kind && actual.id === expected.id;
}

function profileIdentity(profile: ResolvedServerProfile): ServerProfileIdentity {
  return { kind: profile.kind, id: profile.id } as ServerProfileIdentity;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}
