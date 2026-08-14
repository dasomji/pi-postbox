import { z } from "zod";
import { ServerInstanceIdSchema, normalizeLoopbackUrl } from "./loopback.js";

export const SERVER_PROFILE_METADATA_VERSION = 2;

const ProductionProfileIdentitySchema = z.object({
  kind: z.literal("production"),
  id: z.literal("production")
});

const DevelopmentProfileIdentitySchema = z.object({
  kind: z.literal("development"),
  id: z.string().regex(/^development:[a-f0-9]{16}$/)
});

export const ServerProfileIdentitySchema = z.discriminatedUnion("kind", [
  ProductionProfileIdentitySchema,
  DevelopmentProfileIdentitySchema
]);
export type ServerProfileIdentity = z.infer<typeof ServerProfileIdentitySchema>;

export const ServerInstanceIdentitySchema = z.object({
  profile: ServerProfileIdentitySchema,
  instanceId: ServerInstanceIdSchema,
  url: z.string().refine((value) => normalizeLoopbackUrl(value).ok, {
    message: "Expected a safe numeric loopback HTTP(S) URL"
  }),
  protocolVersion: z.string().min(1).max(64),
  buildId: z.string().min(1).max(128)
});
export type ServerInstanceIdentity = z.infer<typeof ServerInstanceIdentitySchema>;

export const ServerProfileMetadataRecordSchema = ServerInstanceIdentitySchema.extend({
  version: z.literal(SERVER_PROFILE_METADATA_VERSION),
  updatedAt: z.string().datetime()
});
export type ServerProfileMetadataRecord = z.infer<typeof ServerProfileMetadataRecordSchema>;

export interface ServerProfileMetadataDiagnostic {
  code: string;
  field?: string;
  source?: string;
}

export type ParseServerProfileMetadataRecordResult =
  | { ok: true; record: ServerProfileMetadataRecord }
  | { ok: false; diagnostics: ServerProfileMetadataDiagnostic[] };

export function parseServerProfileMetadataRecord(
  input: string,
  options: {
    expectedProfile: ServerProfileIdentity;
    nowMs?: number;
    maxBytes?: number;
    source?: string;
  }
): ParseServerProfileMetadataRecordResult {
  const reject = (code: string, field?: string): ParseServerProfileMetadataRecordResult => {
    const diagnostic: ServerProfileMetadataDiagnostic = { code };
    if (field) diagnostic.field = field;
    if (options.source) diagnostic.source = options.source;
    return { ok: false, diagnostics: [diagnostic] };
  };

  if (new TextEncoder().encode(input).length > (options.maxBytes ?? 4_096)) return reject("too-large");

  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch {
    return reject("malformed-json");
  }

  const parsed = ServerProfileMetadataRecordSchema.safeParse(value);
  if (!parsed.success) return reject("invalid-record");
  if (
    parsed.data.profile.kind !== options.expectedProfile.kind ||
    parsed.data.profile.id !== options.expectedProfile.id
  ) {
    return reject("profile-mismatch", "profile");
  }

  const updatedAtMs = Date.parse(parsed.data.updatedAt);
  if (!Number.isFinite(updatedAtMs) || updatedAtMs > (options.nowMs ?? Date.now())) {
    return reject("invalid-timestamp", "updatedAt");
  }

  const normalized = normalizeLoopbackUrl(parsed.data.url);
  if (!normalized.ok) return reject("unsafe-url", "url");

  return { ok: true, record: { ...parsed.data, url: normalized.url } };
}
