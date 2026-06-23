import { z } from "zod";

export const ACTIVE_LOCAL_METADATA_VERSION = 1;
export const ACTIVE_LOCAL_METADATA_DIRECTORY = "active-local";
export const ACTIVE_LOCAL_METADATA_FILENAMES = {
  dev: "dev.json",
  production: "production.json"
} as const;

const DEFAULT_MAX_METADATA_BYTES = 4_096;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const ActiveLocalRoleSchema = z.enum(["dev", "production"]);
export type ActiveLocalRole = z.infer<typeof ActiveLocalRoleSchema>;

export const ActiveLocalInstanceIdSchema = z.string().regex(UUID_V4_PATTERN);

export const ActiveLocalTargetIdentitySchema = z.object({
  role: ActiveLocalRoleSchema,
  instanceId: ActiveLocalInstanceIdSchema,
  url: z.string().refine((value) => normalizeActiveLocalMetadataUrl(value).ok, {
    message: "Expected a safe numeric loopback HTTP(S) URL"
  })
});
export type ActiveLocalTargetIdentity = z.infer<typeof ActiveLocalTargetIdentitySchema>;

export const ActiveLocalMetadataRecordSchema = ActiveLocalTargetIdentitySchema.extend({
  version: z.literal(ACTIVE_LOCAL_METADATA_VERSION),
  updatedAt: z.string().datetime()
});
export type ActiveLocalMetadataRecord = z.infer<typeof ActiveLocalMetadataRecordSchema>;

export interface ActiveLocalDiagnostic {
  code: string;
  role?: ActiveLocalRole | string;
  source?: string;
  field?: string;
}

export type NormalizeActiveLocalMetadataUrlResult =
  | { ok: true; url: string; host: string; port: number }
  | { ok: false; diagnostics: ActiveLocalDiagnostic[] };

export interface ParseActiveLocalMetadataRecordOptions {
  expectedRole: ActiveLocalRole | string;
  nowMs?: number;
  ttlMs?: number;
  maxBytes?: number;
  source?: string;
}

export type ParseActiveLocalMetadataRecordResult =
  | { ok: true; record: ActiveLocalMetadataRecord }
  | { ok: false; diagnostics: ActiveLocalDiagnostic[] };

export interface SelectActiveLocalTargetOptions {
  nowMs?: number;
  ttlMs: number;
}

export interface SelectActiveLocalTargetResult {
  target?: ActiveLocalTargetIdentity;
  diagnostics: ActiveLocalDiagnostic[];
}

export function normalizeActiveLocalMetadataUrl(input: string): NormalizeActiveLocalMetadataUrlResult {
  if (typeof input !== "string" || input.length === 0 || input !== input.trim()) {
    return urlRejection("invalid-url");
  }

  const authorityMatch = input.match(/^([a-zA-Z][a-zA-Z\d+.-]*):\/\/([^/?#]*)/);
  if (!authorityMatch) {
    return urlRejection("invalid-url");
  }

  const scheme = authorityMatch[1].toLowerCase();
  const authority = authorityMatch[2];
  if ((scheme !== "http" && scheme !== "https") || authority.length === 0 || authority.includes("@")) {
    return urlRejection("unsafe-url");
  }

  const parsedAuthority = parseLoopbackAuthority(authority);
  if (!parsedAuthority.ok) {
    return urlRejection(parsedAuthority.code);
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(input);
  } catch {
    return urlRejection("invalid-url");
  }

  if (
    parsedUrl.protocol !== `${scheme}:` ||
    parsedUrl.username !== "" ||
    parsedUrl.password !== "" ||
    parsedUrl.pathname !== "/" ||
    parsedUrl.search !== "" ||
    parsedUrl.hash !== ""
  ) {
    return urlRejection("unsafe-url");
  }

  const hostForUrl = parsedAuthority.host === "::1" ? "[::1]" : parsedAuthority.host;

  return {
    ok: true,
    url: `${scheme}://${hostForUrl}:${parsedAuthority.port}/`,
    host: parsedAuthority.host,
    port: parsedAuthority.port
  };
}

export function parseActiveLocalMetadataRecord(
  input: string,
  options: ParseActiveLocalMetadataRecordOptions
): ParseActiveLocalMetadataRecordResult {
  const context = diagnosticContext(options);
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_METADATA_BYTES;

  if (byteLength(input) > maxBytes) {
    return rejected({ ...context, code: "too-large" });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return rejected({ ...context, code: "malformed-json" });
  }

  if (!isPlainRecord(parsed)) {
    return rejected({ ...context, code: "invalid-record" });
  }

  if (parsed.version !== ACTIVE_LOCAL_METADATA_VERSION) {
    return rejected({ ...context, code: "invalid-version", field: "version" });
  }

  if (parsed.role !== "dev" && parsed.role !== "production") {
    return rejected({ ...context, code: "invalid-role", field: "role" });
  }

  if (parsed.role !== options.expectedRole) {
    return rejected({ ...context, code: "role-mismatch", role: parsed.role, field: "role" });
  }

  if (typeof parsed.instanceId !== "string" || !UUID_V4_PATTERN.test(parsed.instanceId)) {
    return rejected({ ...context, code: "invalid-instance-id", field: "instanceId" });
  }

  if (typeof parsed.url !== "string") {
    return rejected({ ...context, code: "invalid-url", field: "url" });
  }

  const normalizedUrl = normalizeActiveLocalMetadataUrl(parsed.url);
  if (!normalizedUrl.ok) {
    return rejected({ ...context, code: "unsafe-url", field: "url" });
  }

  if (typeof parsed.updatedAt !== "string") {
    return rejected({ ...context, code: "invalid-timestamp", field: "updatedAt" });
  }

  const updatedAtMs = Date.parse(parsed.updatedAt);
  if (!Number.isFinite(updatedAtMs)) {
    return rejected({ ...context, code: "invalid-timestamp", field: "updatedAt" });
  }

  const updatedAt = new Date(updatedAtMs).toISOString();
  if (updatedAt !== parsed.updatedAt) {
    return rejected({ ...context, code: "invalid-timestamp", field: "updatedAt" });
  }

  const nowMs = options.nowMs ?? Date.now();
  if (updatedAtMs > nowMs) {
    return rejected({ ...context, code: "future-timestamp", field: "updatedAt" });
  }

  return {
    ok: true,
    record: {
      version: ACTIVE_LOCAL_METADATA_VERSION,
      role: parsed.role,
      url: normalizedUrl.url,
      instanceId: parsed.instanceId,
      updatedAt
    }
  };
}

export function selectActiveLocalTarget(
  records: unknown[],
  options: SelectActiveLocalTargetOptions
): SelectActiveLocalTargetResult {
  const nowMs = options.nowMs ?? Date.now();
  const diagnostics: ActiveLocalDiagnostic[] = [];

  for (const role of ["dev", "production"] as const) {
    const record = records.find((candidate): candidate is ActiveLocalMetadataRecord => {
      return isActiveLocalMetadataRecord(candidate) && candidate.role === role;
    });

    if (!record) {
      continue;
    }

    const updatedAtMs = Date.parse(record.updatedAt);
    if (!Number.isFinite(updatedAtMs) || updatedAtMs > nowMs || nowMs - updatedAtMs > options.ttlMs) {
      diagnostics.push({ code: "stale", role });
      continue;
    }

    return {
      target: {
        role: record.role,
        url: record.url,
        instanceId: record.instanceId
      },
      diagnostics
    };
  }

  return { target: undefined, diagnostics };
}

function parseLoopbackAuthority(authority: string):
  | { ok: true; host: string; port: number }
  | { ok: false; code: string } {
  if (authority.startsWith("[")) {
    const match = authority.match(/^\[::1\]:(\d+)$/i);
    if (!match) {
      return { ok: false, code: "unsafe-host" };
    }

    const port = parsePort(match[1]);
    return port === undefined ? { ok: false, code: "invalid-port" } : { ok: true, host: "::1", port };
  }

  const match = authority.match(/^([0-9.]+):(\d+)$/);
  if (!match) {
    return { ok: false, code: "unsafe-host" };
  }

  const host = match[1];
  if (!isSafeIpv4Loopback(host)) {
    return { ok: false, code: "unsafe-host" };
  }

  const port = parsePort(match[2]);
  return port === undefined ? { ok: false, code: "invalid-port" } : { ok: true, host, port };
}

function parsePort(rawPort: string): number | undefined {
  if (!/^[1-9]\d{0,4}$/.test(rawPort)) {
    return undefined;
  }

  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    return undefined;
  }

  return port;
}

function isSafeIpv4Loopback(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) {
    return false;
  }

  const numbers = parts.map((part) => {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) {
      return undefined;
    }

    const value = Number(part);
    return value >= 0 && value <= 255 ? value : undefined;
  });

  return numbers.every((value) => value !== undefined) && numbers[0] === 127;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isActiveLocalMetadataRecord(value: unknown): value is ActiveLocalMetadataRecord {
  return ActiveLocalMetadataRecordSchema.safeParse(value).success;
}

function diagnosticContext(options: ParseActiveLocalMetadataRecordOptions): Omit<ActiveLocalDiagnostic, "code" | "field"> {
  return {
    role: options.expectedRole,
    source: sanitizeSource(options.source)
  };
}

function sanitizeSource(source: string | undefined): string | undefined {
  if (!source) {
    return undefined;
  }

  const sourceParts = source.split(/[\\/]/);
  return sourceParts[sourceParts.length - 1] || undefined;
}

function byteLength(input: string): number {
  return new TextEncoder().encode(input).length;
}

function rejected(diagnostic: ActiveLocalDiagnostic): { ok: false; diagnostics: ActiveLocalDiagnostic[] } {
  return { ok: false, diagnostics: [diagnostic] };
}

function urlRejection(code: string): { ok: false; diagnostics: ActiveLocalDiagnostic[] } {
  return { ok: false, diagnostics: [{ code }] };
}
