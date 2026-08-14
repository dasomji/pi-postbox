import { z } from "zod";

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const ServerInstanceIdSchema = z.string().regex(UUID_V4_PATTERN);

export type NormalizeLoopbackUrlResult =
  | { ok: true; url: string; host: string; port: number }
  | { ok: false; diagnostics: Array<{ code: string }> };

export function normalizeLoopbackUrl(input: string): NormalizeLoopbackUrlResult {
  if (typeof input !== "string" || input.length === 0 || input !== input.trim()) return rejected("invalid-url");
  const authorityMatch = input.match(/^([a-zA-Z][a-zA-Z\d+.-]*):\/\/([^/?#]*)/);
  if (!authorityMatch) return rejected("invalid-url");
  const scheme = authorityMatch[1].toLowerCase();
  const authority = authorityMatch[2];
  if ((scheme !== "http" && scheme !== "https") || !authority || authority.includes("@")) return rejected("unsafe-url");

  const parsedAuthority = parseAuthority(authority);
  if (!parsedAuthority.ok) return rejected(parsedAuthority.code);
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(input);
  } catch {
    return rejected("invalid-url");
  }
  if (parsedUrl.pathname !== "/" || parsedUrl.search || parsedUrl.hash || parsedUrl.username || parsedUrl.password) {
    return rejected("unsafe-url");
  }
  const hostForUrl = parsedAuthority.host === "::1" ? "[::1]" : parsedAuthority.host;
  return {
    ok: true,
    url: `${scheme}://${hostForUrl}:${parsedAuthority.port}/`,
    host: parsedAuthority.host,
    port: parsedAuthority.port
  };
}

function parseAuthority(authority: string): { ok: true; host: string; port: number } | { ok: false; code: string } {
  if (authority.startsWith("[")) {
    const match = authority.match(/^\[::1\]:(\d+)$/i);
    if (!match) return { ok: false, code: "unsafe-host" };
    const port = parsePort(match[1]);
    return port ? { ok: true, host: "::1", port } : { ok: false, code: "invalid-port" };
  }
  const match = authority.match(/^([0-9.]+):(\d+)$/);
  if (!match || !isIpv4Loopback(match[1])) return { ok: false, code: "unsafe-host" };
  const port = parsePort(match[2]);
  return port ? { ok: true, host: match[1], port } : { ok: false, code: "invalid-port" };
}

function parsePort(raw: string): number | undefined {
  if (!/^[1-9]\d{0,4}$/.test(raw)) return undefined;
  const port = Number(raw);
  return Number.isInteger(port) && port <= 65_535 ? port : undefined;
}

function isIpv4Loopback(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4 || parts[0] !== "127") return false;
  return parts.every((part) => /^(0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255);
}

function rejected(code: string): NormalizeLoopbackUrlResult {
  return { ok: false, diagnostics: [{ code }] };
}
