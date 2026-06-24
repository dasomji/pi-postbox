import type { ActiveLocalDiagnostic, ActiveLocalRole } from "../../protocol/src/index.js";
import { spawn } from "node:child_process";
import { once } from "node:events";
import type { ResolveActiveLocalTargetResult } from "./activeLocalTargetResolver.js";
import { resolveActiveLocalTarget } from "./activeLocalTargetResolver.js";
import { getPostboxAutostartStatus, type PostboxAutostartStatusSnapshot } from "./autostart.js";

export type PostboxConnectionState = "connected" | "disconnected" | "unavailable";

export interface PostboxConnectionStatus {
  state: PostboxConnectionState;
  activeUrl?: string;
  localUrl?: string;
  tailnetUrl?: string;
}

export interface PostboxStatusSnapshot {
  connection: PostboxConnectionStatus;
  remoteConfig?: string;
  openQuestionCount: number;
  autostart: PostboxAutostartStatusSnapshot;
  diagnostics: string[];
  tailscale?: {
    state: string;
    diagnostic?: string;
    remediation?: string;
    httpsPort?: number;
  };
}

export interface PostboxStatusTailscaleOptions {
  localUrl: string;
  role?: ActiveLocalRole;
}

export interface PostboxStatusTailscaleSnapshot {
  state: string;
  diagnostic?: string;
  remediation?: string;
  httpsPort?: number;
  tailnetUrl?: string;
}

export type PostboxStatusTailscaleInspector = (options: PostboxStatusTailscaleOptions) => Promise<PostboxStatusTailscaleSnapshot>;

export interface PostboxStatusClient {
  listPendingAsks(): unknown[];
  getStatusSnapshot?: (autostart?: PostboxAutostartStatusSnapshot) => PostboxStatusSnapshot | Promise<PostboxStatusSnapshot | undefined> | undefined;
}

export interface CollectPostboxStatusOptions {
  client?: PostboxStatusClient;
  env?: NodeJS.ProcessEnv;
  unavailableRationale?: string;
  resolveTarget?: (options: { env: NodeJS.ProcessEnv }) => Promise<ResolveActiveLocalTargetResult>;
}

export async function collectPostboxStatusSnapshot(options: CollectPostboxStatusOptions = {}): Promise<PostboxStatusSnapshot> {
  const env = options.env ?? process.env;
  const autostart = getPostboxAutostartStatus(env);
  const client = options.client;

  if (client) {
    const clientSnapshot = await client.getStatusSnapshot?.(autostart);
    if (clientSnapshot) return normalizeStatusSnapshot(clientSnapshot, client, autostart);

    return createUrlStatusSnapshot({
      state: "connected",
      activeUrl: undefined,
      openQuestionCount: safePendingCount(client),
      autostart,
      diagnostics: []
    });
  }

  const resolveTarget = options.resolveTarget ?? ((input: { env: NodeJS.ProcessEnv }) => resolveActiveLocalTarget(input));
  const result = await resolveTarget({ env });
  const diagnostics = [
    ...(options.unavailableRationale ? [options.unavailableRationale] : []),
    ...result.diagnostics.map(formatActiveLocalDiagnostic)
  ].filter(Boolean);

  if (result.status === "selected") {
    return createUrlStatusSnapshot({
      state: "disconnected",
      activeUrl: result.target.url,
      openQuestionCount: 0,
      autostart,
      diagnostics,
      source: result.target.source
    });
  }

  return {
    connection: { state: "unavailable" },
    openQuestionCount: 0,
    autostart,
    diagnostics: diagnostics.length > 0 ? diagnostics : ["Pi Postbox is unavailable."],
    tailscale: {
      state: "unavailable",
      diagnostic: "No healthy Postbox target is available."
    }
  };
}

export function createUrlStatusSnapshot(options: {
  state: PostboxConnectionState;
  activeUrl?: string;
  openQuestionCount: number;
  autostart: PostboxAutostartStatusSnapshot;
  diagnostics?: string[];
  source?: string;
}): PostboxStatusSnapshot {
  const classified = classifyStatusUrl(options.activeUrl, options.source);
  return {
    connection: {
      state: options.state,
      activeUrl: options.activeUrl,
      localUrl: classified.localUrl,
      tailnetUrl: classified.tailnetUrl
    },
    remoteConfig: classified.tailnetUrl ? `export PI_POSTBOX_URL=${classified.tailnetUrl}` : undefined,
    openQuestionCount: options.openQuestionCount,
    autostart: options.autostart,
    diagnostics: options.diagnostics ?? []
  };
}

export async function enrichStatusSnapshotFromLocalServer(
  snapshot: PostboxStatusSnapshot,
  options: { role?: ActiveLocalRole; inspectTailscale?: PostboxStatusTailscaleInspector } = {}
): Promise<PostboxStatusSnapshot> {
  const localUrl = snapshot.connection.localUrl;
  if (!localUrl) return snapshot;

  const inspectTailscale = options.inspectTailscale ?? inspectPostboxTailscaleStatus;
  const tailscale = await inspectTailscale({ localUrl, role: options.role });
  const tailnetUrl = snapshot.connection.tailnetUrl ?? tailscale.tailnetUrl;
  const diagnostics = [...snapshot.diagnostics];
  if (tailscale.diagnostic) diagnostics.push(`tailscale:${tailscale.state}:${tailscale.diagnostic}`);

  return {
    ...snapshot,
    connection: {
      ...snapshot.connection,
      tailnetUrl
    },
    remoteConfig: snapshot.remoteConfig ?? (tailnetUrl ? `export PI_POSTBOX_URL=${tailnetUrl}` : undefined),
    diagnostics: uniqueDiagnostics(diagnostics),
    tailscale: {
      state: tailscale.state,
      diagnostic: tailscale.diagnostic,
      remediation: tailscale.remediation,
      httpsPort: tailscale.httpsPort
    }
  };
}

export function formatPostboxStatusSnapshot(snapshot: PostboxStatusSnapshot): string {
  const lines = ["Pi Postbox status"];
  lines.push(`Connection: ${snapshot.connection.state}`);
  if (snapshot.connection.activeUrl) lines.push(`Active URL: ${snapshot.connection.activeUrl}`);
  if (snapshot.connection.localUrl) lines.push(`Local URL: ${snapshot.connection.localUrl}`);
  if (snapshot.connection.tailnetUrl) lines.push(`Tailnet URL: ${snapshot.connection.tailnetUrl}`);
  if (snapshot.remoteConfig) {
    lines.push("Remote config:");
    lines.push(snapshot.remoteConfig);
  }
  lines.push(`Open questions: ${snapshot.openQuestionCount}`);
  lines.push(`Autostart: ${snapshot.autostart.enabled ? "enabled" : "disabled"}${snapshot.autostart.startedByThisSession ? " (started by this session)" : ""}`);
  if (snapshot.tailscale) {
    lines.push(`Tailscale: ${snapshot.tailscale.state}${snapshot.tailscale.diagnostic ? ` - ${snapshot.tailscale.diagnostic}` : ""}`);
  }
  if (snapshot.diagnostics.length > 0) lines.push(`Diagnostics: ${snapshot.diagnostics.join(", ")}`);
  else lines.push("Diagnostics: none");
  return lines.join("\n");
}

function normalizeStatusSnapshot(
  snapshot: PostboxStatusSnapshot,
  client: PostboxStatusClient,
  autostart: PostboxAutostartStatusSnapshot
): PostboxStatusSnapshot {
  const tailnetUrl = snapshot.connection.tailnetUrl;
  return {
    ...snapshot,
    connection: { ...snapshot.connection },
    openQuestionCount: Number.isInteger(snapshot.openQuestionCount) ? snapshot.openQuestionCount : safePendingCount(client),
    autostart: snapshot.autostart ?? autostart,
    remoteConfig: snapshot.remoteConfig ?? (tailnetUrl ? `export PI_POSTBOX_URL=${tailnetUrl}` : undefined),
    diagnostics: Array.isArray(snapshot.diagnostics) ? snapshot.diagnostics : []
  };
}

function safePendingCount(client: PostboxStatusClient): number {
  try {
    return client.listPendingAsks().length;
  } catch {
    return 0;
  }
}

function classifyStatusUrl(url: string | undefined, source?: string): { localUrl?: string; tailnetUrl?: string } {
  if (!url) return {};
  if (source === "active-local" || source === "configured-loopback" || isLoopbackUrl(url)) return { localUrl: url };
  return { tailnetUrl: url };
}

async function inspectPostboxTailscaleStatus(options: PostboxStatusTailscaleOptions): Promise<PostboxStatusTailscaleSnapshot> {
  const target = localServeTarget(options.localUrl);
  if (!target) {
    return { state: "unavailable", diagnostic: "Tailscale Serve status unavailable because the local Postbox URL has no usable port." };
  }

  const serveStatus = await readTailscaleJson(["serve", "status", "--json"]);
  if (!serveStatus.ok) {
    return { state: "unavailable", httpsPort: target.port, diagnostic: classifyTailscaleFailure(serveStatus.error) };
  }

  const host = await readTailnetHost().catch(() => undefined);
  const tailnetUrl = host ? `https://${host}:${target.port}` : undefined;
  const existingProxy = proxyForHttpsPort(serveStatus.value, target.port);
  if (!existingProxy) {
    return {
      state: "unavailable",
      httpsPort: target.port,
      tailnetUrl,
      diagnostic: `Tailscale Serve has no mapping for HTTPS port ${target.port}.`,
      remediation: `Run \`tailscale serve --bg --https ${target.port} ${target.urlTarget}\` to expose this local Postbox to your Tailnet.`
    };
  }

  if (isSameProxyTarget(existingProxy, target.urlTarget, target.port)) {
    return {
      state: "served",
      httpsPort: target.port,
      tailnetUrl,
      diagnostic: "Tailscale Serve points at this Postbox instance."
    };
  }

  return {
    state: "conflict",
    httpsPort: target.port,
    tailnetUrl,
    diagnostic: `Tailscale Serve conflict: HTTPS port ${target.port} already proxies to another target.`,
    remediation: "Run `tailscale serve status` to inspect the existing mapping before changing it."
  };
}

function isLoopbackUrl(input: string): boolean {
  try {
    const url = new URL(input);
    const host = url.hostname.toLowerCase();
    return host === "localhost" || host === "::1" || host.startsWith("127.");
  } catch {
    return false;
  }
}

function formatActiveLocalDiagnostic(diagnostic: ActiveLocalDiagnostic): string {
  const parts = [diagnostic.source, diagnostic.role, diagnostic.code, diagnostic.field].filter(Boolean);
  return parts.join(":");
}

function uniqueDiagnostics(diagnostics: string[]): string[] {
  return [...new Set(diagnostics.filter(Boolean))];
}

function localServeTarget(localUrl: string): { port: number; urlTarget: string } | undefined {
  try {
    const parsed = new URL(localUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    const port = Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80));
    if (!Number.isInteger(port) || port <= 0 || port > 65_535) return undefined;
    return { port, urlTarget: `http://127.0.0.1:${port}` };
  } catch {
    return undefined;
  }
}

async function readTailscaleJson(args: string[]): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; error: unknown }> {
  try {
    const { stdout } = await execTailscaleCommand(args);
    return { ok: true, value: JSON.parse(stdout || "{}") as Record<string, unknown> };
  } catch (error) {
    return { ok: false, error };
  }
}

async function readTailnetHost(): Promise<string | undefined> {
  const { stdout } = await execTailscaleCommand(["status", "--json"]);
  const status = JSON.parse(stdout || "{}") as { Self?: { DNSName?: string; TailscaleIPs?: string[] } };
  return status.Self?.DNSName?.replace(/\.$/, "") ?? status.Self?.TailscaleIPs?.find((value) => /^\d+\.\d+\.\d+\.\d+$/.test(value));
}

async function execTailscaleCommand(args: string[]): Promise<{ stdout: string; stderr: string }> {
  const child = spawn("tailscale", args, { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const [code, signal] = (await Promise.race([
    once(child, "exit") as Promise<[number | null, NodeJS.Signals | null]>,
    once(child, "error").then(([error]) => {
      throw error;
    }) as Promise<[number | null, NodeJS.Signals | null]>
  ])) as [number | null, NodeJS.Signals | null];

  if (code !== 0) {
    const reason = signal ? `signal ${signal}` : `exit code ${code}`;
    throw new Error(`tailscale ${args.join(" ")} failed with ${reason}\n${stderr || stdout}`.trim());
  }

  return { stdout, stderr };
}

function proxyForHttpsPort(status: Record<string, unknown>, port: number): string | undefined {
  const web = status.Web;
  if (!web || typeof web !== "object") return undefined;
  for (const [key, value] of Object.entries(web as Record<string, unknown>)) {
    if (!key.endsWith(`:${port}`) && !(port === 443 && !/:\d+$/.test(key))) continue;
    const proxy = firstProxy(value);
    if (proxy) return proxy;
  }
  return undefined;
}

function firstProxy(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.Proxy === "string") return record.Proxy;
  const handlers = record.Handlers;
  if (!handlers || typeof handlers !== "object") return undefined;
  for (const handler of Object.values(handlers as Record<string, unknown>)) {
    if (!handler || typeof handler !== "object") continue;
    const proxy = (handler as Record<string, unknown>).Proxy;
    if (typeof proxy === "string") return proxy;
  }
  return undefined;
}

function isSameProxyTarget(proxy: string, expectedTarget: string, expectedPort: number): boolean {
  const trimmed = proxy.replace(/\/$/, "");
  if (/^\d+$/.test(trimmed)) return `http://127.0.0.1:${trimmed}` === expectedTarget;
  try {
    const parsed = new URL(trimmed);
    const port = parsed.port || String(expectedPort);
    const host = parsed.hostname === "localhost" ? "127.0.0.1" : parsed.hostname;
    return `${parsed.protocol}//${host}:${port}` === expectedTarget;
  } catch {
    return trimmed === expectedTarget;
  }
}

function classifyTailscaleFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes("enoent") || lower.includes("not found") || lower.includes("no such file")) {
    return "Tailscale CLI is not installed or is unavailable.";
  }
  if (lower.includes("not running") || lower.includes("daemon") || lower.includes("connect") || lower.includes("refused")) {
    return "Tailscale daemon is unavailable.";
  }
  return `Tailscale Serve status unavailable: ${message}`;
}
