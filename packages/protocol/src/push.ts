import { z } from "zod";

export const PushConfigSourceSchema = z.enum(["configured", "generated"]);

export const PushConfigResponseSchema = z.discriminatedUnion("available", [
  z.object({
    available: z.literal(true),
    publicKey: z.string().min(1),
    source: PushConfigSourceSchema,
    message: z.string().min(1).optional()
  }),
  z.object({
    available: z.literal(false),
    message: z.string().min(1).optional()
  })
]);

function isAllowedPushEndpoint(value: string): boolean {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    return false;
  }

  return endpoint.protocol === "https:" && isPublicPushHost(endpoint.hostname);
}

function isPublicPushHost(hostname: string): boolean {
  const normalizedHostname = normalizePushHostname(hostname);
  if (normalizedHostname === "localhost" || normalizedHostname.endsWith(".localhost")) return false;
  if (isPrivateOrLocalIpv4(normalizedHostname)) return false;
  if (isPrivateOrLocalIpv6(normalizedHostname)) return false;
  return true;
}

function normalizePushHostname(hostname: string): string {
  const normalizedHostname = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalizedHostname.includes(":")) return normalizedHostname;
  return normalizedHostname.endsWith(".") ? normalizedHostname.slice(0, -1) : normalizedHostname;
}

function isPrivateOrLocalIpv4(hostname: string): boolean {
  const octets = hostname.split(".");
  if (octets.length !== 4) return false;

  const parts = octets.map((octet) => Number(octet));
  if (parts.some((part, index) => !Number.isInteger(part) || part < 0 || part > 255 || String(part) !== octets[index])) return false;

  const [first, second] = parts;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function isPrivateOrLocalIpv6(hostname: string): boolean {
  const hextets = parseIpv6Hextets(hostname);
  if (hextets === null) return false;

  if (hextets.every((hextet) => hextet === 0)) return true;
  if (hextets.slice(0, 7).every((hextet) => hextet === 0) && hextets[7] === 1) return true;

  const firstHextet = hextets[0];
  if ((firstHextet >= 0xfc00 && firstHextet <= 0xfdff) || (firstHextet >= 0xfe80 && firstHextet <= 0xfebf)) return true;

  const mappedIpv4 = ipv4FromIpv6Hextets(hextets);
  return mappedIpv4 !== null && isPrivateOrLocalIpv4(mappedIpv4);
}

function parseIpv6Hextets(hostname: string): number[] | null {
  if (!hostname.includes(":")) return null;

  const compressionParts = hostname.split("::");
  if (compressionParts.length > 2) return null;

  const leftParts = splitIpv6HextetSide(compressionParts[0]);
  const rightParts = splitIpv6HextetSide(compressionParts[1] ?? "");
  if (leftParts === null || rightParts === null) return null;

  const missingPartCount = 8 - leftParts.length - rightParts.length;
  if (compressionParts.length === 1 && missingPartCount !== 0) return null;
  if (compressionParts.length === 2 && missingPartCount < 1) return null;

  return [...leftParts, ...Array<number>(missingPartCount).fill(0), ...rightParts];
}

function splitIpv6HextetSide(value: string): number[] | null {
  if (value.length === 0) return [];

  const hextets = value.split(":");
  if (hextets.some((hextet) => hextet.length === 0 || hextet.length > 4 || !/^[0-9a-f]+$/i.test(hextet))) return null;

  return hextets.map((hextet) => parseInt(hextet, 16));
}

function ipv4FromIpv6Hextets(hextets: number[]): string | null {
  const isMappedIpv4 = hextets.slice(0, 5).every((hextet) => hextet === 0) && hextets[5] === 0xffff;
  const isCompatibleIpv4 = hextets.slice(0, 6).every((hextet) => hextet === 0);
  if (!isMappedIpv4 && !isCompatibleIpv4) return null;

  const high = hextets[6];
  const low = hextets[7];
  return `${(high >> 8) & 255}.${high & 255}.${(low >> 8) & 255}.${low & 255}`;
}

const PushEndpointUrlSchema = z.string().url().min(1);
const PushSubscriptionEndpointSchema = PushEndpointUrlSchema.refine(
  isAllowedPushEndpoint,
  "Expected an https Web Push endpoint with a public host"
);

export const PushSubscriptionPayloadSchema = z.object({
  endpoint: PushSubscriptionEndpointSchema,
  expirationTime: z.number().int().nonnegative().nullable().optional(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1)
  })
});

export const PushSubscriptionDeletePayloadSchema = z.object({
  endpoint: PushEndpointUrlSchema
});

export type PushConfigSource = z.infer<typeof PushConfigSourceSchema>;
export type PushConfigResponse = z.infer<typeof PushConfigResponseSchema>;
export type PushSubscriptionPayload = z.infer<typeof PushSubscriptionPayloadSchema>;
export type PushSubscriptionDeletePayload = z.infer<typeof PushSubscriptionDeletePayloadSchema>;
