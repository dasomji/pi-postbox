import type { ActiveLocalRole } from "@pi-postbox/protocol";
import { spawn } from "node:child_process";
import { once } from "node:events";

export type TailscaleServeState = "served" | "idempotent" | "conflict" | "unavailable";

export interface TailscaleExecResult {
  stdout: string;
  stderr: string;
}

export type TailscaleExec = (command: string, args: string[]) => Promise<TailscaleExecResult>;

export interface PostboxTailscaleOptions {
  localUrl: string;
  role: ActiveLocalRole;
  exec?: TailscaleExec;
}

export interface PostboxTailscaleStatus {
  state: TailscaleServeState;
  localUrl: string;
  role: ActiveLocalRole;
  httpsPort?: number;
  tailnetUrl?: string;
  diagnostic?: string;
  remediation?: string;
}

interface TailscaleStatusJson {
  Self?: {
    DNSName?: string;
    TailscaleIPs?: string[];
  };
}

interface TailscaleServeStatusJson {
  Web?: Record<string, unknown>;
}

export async function exposePostboxWithTailscale(options: PostboxTailscaleOptions): Promise<PostboxTailscaleStatus> {
  const exec = options.exec ?? execTailscaleCommand;
  const target = localServeTarget(options.localUrl);
  if (!target) {
    return unavailable(options, "Tailscale Serve skipped because the local Postbox URL is not a port-based HTTP URL.");
  }

  const serveStatus = await readServeStatus(exec);
  if (!serveStatus.ok) {
    return unavailable(options, classifyTailscaleFailure(serveStatus.error), target.port);
  }

  const host = await readTailnetHost(exec).catch(() => undefined);
  const tailnetUrl = host ? formatTailnetUrl(host, target.port) : undefined;
  const existingProxy = proxyForHttpsPort(serveStatus.status, target.port);
  if (existingProxy) {
    if (isSameProxyTarget(existingProxy, target.urlTarget, target.port)) {
      return {
        state: "idempotent",
        localUrl: options.localUrl,
        role: options.role,
        httpsPort: target.port,
        tailnetUrl,
        diagnostic: "Tailscale Serve already points at this Postbox instance."
      };
    }

    return {
      state: "conflict",
      localUrl: options.localUrl,
      role: options.role,
      httpsPort: target.port,
      tailnetUrl,
      diagnostic: `Tailscale Serve conflict: HTTPS port ${target.port} already proxies to another target.`,
      remediation: "Run `tailscale serve status` to inspect the existing mapping before changing it. Postbox did not overwrite it."
    };
  }

  const primaryArgs = ["serve", "--bg", "--https", String(target.port), target.urlTarget];
  try {
    await exec("tailscale", primaryArgs);
  } catch (firstError) {
    if (isTailscaleServePermissionError(firstError)) {
      return permissionDenied(options, target, firstError);
    }
    if (!isLoopbackUrlTargetRejection(firstError, target)) {
      return unavailable(options, classifyTailscaleFailure(firstError), target.port, manualServeRemediation(target));
    }

    try {
      await exec("tailscale", ["serve", "--bg", "--https", String(target.port), String(target.port)]);
    } catch (fallbackError) {
      if (isTailscaleServePermissionError(fallbackError)) {
        return permissionDenied(options, target, fallbackError);
      }

      return unavailable(options, classifyTailscaleFailure(fallbackError), target.port, manualServeRemediation(target));
    }
  }

  const postServeHost = host ?? (await readTailnetHost(exec).catch(() => undefined));
  return {
    state: "served",
    localUrl: options.localUrl,
    role: options.role,
    httpsPort: target.port,
    tailnetUrl: postServeHost ? formatTailnetUrl(postServeHost, target.port) : undefined,
    diagnostic: "Tailscale Serve is exposing Postbox to Tailnet devices."
  };
}

export async function inspectPostboxTailscaleStatus(options: PostboxTailscaleOptions): Promise<PostboxTailscaleStatus> {
  const exec = options.exec ?? execTailscaleCommand;
  const target = localServeTarget(options.localUrl);
  if (!target) {
    return unavailable(options, "Tailscale Serve status unavailable because the local Postbox URL has no usable port.");
  }

  const serveStatus = await readServeStatus(exec);
  if (!serveStatus.ok) {
    return unavailable(options, classifyTailscaleFailure(serveStatus.error), target.port);
  }

  const host = await readTailnetHost(exec).catch(() => undefined);
  const tailnetUrl = host ? formatTailnetUrl(host, target.port) : undefined;
  const existingProxy = proxyForHttpsPort(serveStatus.status, target.port);
  if (!existingProxy) {
    return {
      state: "unavailable",
      localUrl: options.localUrl,
      role: options.role,
      httpsPort: target.port,
      tailnetUrl,
      diagnostic: `Tailscale Serve has no mapping for HTTPS port ${target.port}.`,
      remediation: manualServeRemediation(target)
    };
  }

  if (isSameProxyTarget(existingProxy, target.urlTarget, target.port)) {
    return {
      state: "served",
      localUrl: options.localUrl,
      role: options.role,
      httpsPort: target.port,
      tailnetUrl,
      diagnostic: "Tailscale Serve points at this Postbox instance."
    };
  }

  return {
    state: "conflict",
    localUrl: options.localUrl,
    role: options.role,
    httpsPort: target.port,
    tailnetUrl,
    diagnostic: `Tailscale Serve conflict: HTTPS port ${target.port} already proxies to another target.`,
    remediation: "Run `tailscale serve status` to inspect the existing mapping before changing it."
  };
}

async function execTailscaleCommand(command: string, args: string[]): Promise<TailscaleExecResult> {
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
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
    throw new Error(`${command} ${args.join(" ")} failed with ${reason}\n${stderr || stdout}`.trim());
  }

  return { stdout, stderr };
}

async function readServeStatus(exec: TailscaleExec): Promise<{ ok: true; status: TailscaleServeStatusJson } | { ok: false; error: unknown }> {
  try {
    const { stdout } = await exec("tailscale", ["serve", "status", "--json"]);
    return { ok: true, status: JSON.parse(stdout || "{}") as TailscaleServeStatusJson };
  } catch (error) {
    return { ok: false, error };
  }
}

async function readTailnetHost(exec: TailscaleExec): Promise<string | undefined> {
  const { stdout } = await exec("tailscale", ["status", "--json"]);
  const status = JSON.parse(stdout || "{}") as TailscaleStatusJson;
  const dnsName = status.Self?.DNSName?.replace(/\.$/, "");
  if (dnsName) return dnsName;
  return status.Self?.TailscaleIPs?.find((value) => /^\d+\.\d+\.\d+\.\d+$/.test(value));
}

function localServeTarget(localUrl: string): { port: number; urlTarget: string } | undefined {
  let parsed: URL;
  try {
    parsed = new URL(localUrl);
  } catch {
    return undefined;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
  const port = Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80));
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) return undefined;
  return { port, urlTarget: `http://127.0.0.1:${port}` };
}

function proxyForHttpsPort(status: TailscaleServeStatusJson, port: number): string | undefined {
  if (!status.Web) return undefined;
  for (const [key, value] of Object.entries(status.Web)) {
    if (!keyMatchesPort(key, port)) continue;
    const proxy = firstProxy(value);
    if (proxy) return proxy;
  }
  return undefined;
}

function keyMatchesPort(key: string, port: number): boolean {
  return key.endsWith(`:${port}`) || (port === 443 && !/:\d+$/.test(key));
}

function firstProxy(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const directProxy = typeof record.Proxy === "string" ? record.Proxy : undefined;
  if (directProxy) return directProxy;
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
  const normalized = normalizeProxyTarget(proxy, expectedPort);
  return normalized === expectedTarget;
}

function normalizeProxyTarget(proxy: string, fallbackPort: number): string {
  const trimmed = proxy.replace(/\/$/, "");
  if (/^\d+$/.test(trimmed)) return `http://127.0.0.1:${trimmed}`;
  try {
    const parsed = new URL(trimmed);
    const port = parsed.port || String(fallbackPort);
    const host = parsed.hostname === "localhost" ? "127.0.0.1" : parsed.hostname;
    return `${parsed.protocol}//${host}:${port}`;
  } catch {
    return trimmed;
  }
}

function formatTailnetUrl(host: string, port: number): string {
  return `https://${host}:${port}`;
}

function unavailable(
  options: PostboxTailscaleOptions,
  diagnostic: string,
  httpsPort?: number,
  remediation?: string
): PostboxTailscaleStatus {
  return {
    state: "unavailable",
    localUrl: options.localUrl,
    role: options.role,
    httpsPort,
    diagnostic,
    remediation
  };
}

function permissionDenied(options: PostboxTailscaleOptions, target: { port: number; urlTarget: string }, error: unknown): PostboxTailscaleStatus {
  return unavailable(options, `Tailscale Serve permission denied: ${safeErrorMessage(error)}`, target.port, permissionRemediation(target));
}

function isTailscaleServePermissionError(error: unknown): boolean {
  const message = safeErrorMessage(error).toLowerCase();
  return message.includes("permission") || message.includes("access denied") || message.includes("operator") || message.includes("sudo tailscale serve");
}

function isLoopbackUrlTargetRejection(error: unknown, target: { urlTarget: string }): boolean {
  const message = safeErrorMessage(error).toLowerCase();
  if (/\b(daemon|connect|connection|refused|timeout|timed out|unavailable)\b/.test(message)) return false;

  const rejected = /\b(invalid|unsupported|unknown|unrecognized|rejected?|not supported|must|expected)\b/.test(message);
  if (!rejected) return false;

  const mentionsLoopbackUrl = message.includes(target.urlTarget.toLowerCase()) || /http:\/\/(127\.0\.0\.1|localhost)\b/.test(message);
  const mentionsTargetForm =
    message.includes("url form") ||
    message.includes("url target") ||
    message.includes("target url") ||
    message.includes("target form") ||
    /expected\s+(a\s+)?(bare\s+)?port/.test(message) ||
    /only\s+.*port/.test(message) ||
    /unsupported\s+.*http/.test(message);

  return mentionsTargetForm || (mentionsLoopbackUrl && (message.includes("target") || message.includes("url")));
}

function classifyTailscaleFailure(error: unknown): string {
  const message = safeErrorMessage(error);
  const lower = message.toLowerCase();
  if (lower.includes("enoent") || lower.includes("not found") || lower.includes("no such file")) {
    return "Tailscale CLI is not installed or is unavailable.";
  }
  if (lower.includes("not logged in") || lower.includes("logged out") || lower.includes("unauth")) {
    return "Tailscale is unavailable because this machine is not logged in. Local Postbox startup can continue.";
  }
  return `Tailscale Serve unavailable: ${message}`;
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function manualServeRemediation(target: { port: number; urlTarget: string }): string {
  return `Manual Tailnet-private Serve command: tailscale serve --bg --https ${target.port} ${target.urlTarget}`;
}

function permissionRemediation(target: { port: number; urlTarget: string }): string {
  return [
    "Run this once to let your user manage Tailscale Serve:",
    "sudo tailscale set --operator=$USER",
    "Or run the manual Tailnet-private Serve command with appropriate privileges:",
    `sudo tailscale serve --bg --https ${target.port} ${target.urlTarget}`
  ].join("\n");
}
