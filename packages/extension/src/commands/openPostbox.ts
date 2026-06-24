import { spawn } from "node:child_process";
import type { PostboxStatusSnapshot } from "../status.js";
import type { CommandContext, CommandPiApi } from "./localFallback.js";

export interface OpenPostboxCommandOptions {
  ensureReady: () => Promise<void>;
  getStatusSnapshot: () => PostboxStatusSnapshot | Promise<PostboxStatusSnapshot>;
  openUrl?: (url: string) => Promise<void>;
}

const DEFAULT_SYSTEM_OPENER_TIMEOUT_MS = 2_000;

export function registerOpenPostboxCommand(pi: CommandPiApi, options: OpenPostboxCommandOptions): void {
  pi.registerCommand?.("postbox", {
    description: "Open the Pi Postbox dashboard in your browser.",
    handler: async (_args, ctx) => {
      await options.ensureReady();
      const snapshot = await options.getStatusSnapshot();
      const dashboardUrl = snapshot.connection.activeUrl ?? snapshot.connection.localUrl ?? snapshot.connection.tailnetUrl;

      if (!dashboardUrl) {
        notify(
          ctx,
          `Pi Postbox is unavailable; cannot open the dashboard. Diagnostics: ${formatDiagnostics(snapshot)}`,
          "warn"
        );
        return;
      }

      try {
        await (options.openUrl ?? openUrlWithSystemOpener)(dashboardUrl);
      } catch (error) {
        notify(
          ctx,
          `Unable to open Pi Postbox dashboard automatically. Open ${dashboardUrl} manually. ${messageFrom(error)}`,
          "warn"
        );
      }
    }
  });
}

export async function openUrlWithSystemOpener(url: string, timeoutMs = DEFAULT_SYSTEM_OPENER_TIMEOUT_MS): Promise<void> {
  const command = systemOpenerCommand(url);
  const child = spawn(command.executable, command.args, {
    detached: true,
    stdio: "ignore"
  });

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    };

    timeout = setTimeout(() => {
      child.kill?.();
      settle(new Error(`system opener did not finish launching within ${timeoutMs}ms`));
    }, timeoutMs);
    timeout.unref?.();

    child.once("error", (error) => settle(error instanceof Error ? error : new Error(String(error))));
    child.once("exit", (code, signal) => settle(openerProcessFailure("exit", code, signal)));
    child.once("close", (code, signal) => settle(openerProcessFailure("close", code, signal)));
    child.unref?.();
  });
}

function systemOpenerCommand(url: string): { executable: string; args: string[] } {
  if (process.platform === "darwin") return { executable: "open", args: [url] };
  if (process.platform === "win32") return { executable: "cmd", args: ["/c", "start", "", url] };
  return { executable: "xdg-open", args: [url] };
}

function openerProcessFailure(eventName: "exit" | "close", code: number | null, signal: NodeJS.Signals | null): Error | undefined {
  const action = eventName === "exit" ? "exited" : "closed";
  if (code !== null && code !== 0) return new Error(`system opener ${action} with code ${code}`);
  if (signal) return new Error(`system opener ${action} after signal ${signal}`);
  return undefined;
}

function formatDiagnostics(snapshot: PostboxStatusSnapshot): string {
  if (snapshot.diagnostics.length > 0) return snapshot.diagnostics.join(", ");
  return `connection ${snapshot.connection.state}`;
}

function notify(ctx: CommandContext, message: string, level: string): void {
  ctx.ui?.notify?.(message, level);
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
