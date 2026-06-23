import { randomUUID } from "node:crypto";
import type { SessionRegisterPayload } from "@pi-postbox/protocol";
import { PostboxClient, type LocalFallbackStatus } from "./client/PostboxClient.js";
import { registerPostboxFallbackCommands } from "./commands/localFallback.js";
import {
  resolveActiveLocalTarget,
  type ResolveActiveLocalTargetOptions,
  type ResolveActiveLocalTargetResult,
  type ResolvedActiveLocalTarget
} from "./activeLocalTargetResolver.js";
import { createSemanticStateController, installSemanticStateHandlers, type SemanticStateController } from "./lifecycle.js";
import { getMachineIdentity } from "./machineIdentity.js";
import { collectProjectMetadata } from "./projectMetadata.js";
import { collectSessionMetadata } from "./sessionMetadata.js";
import { askPostboxParameters, executeAskPostbox, formatAskResult, type AskPostboxInput } from "./tools/askPostbox.js";

interface PiLikeApi {
  on(event: string, handler: (event: unknown, ctx: PiLikeContext) => unknown): void;
  getSessionName?: () => string | undefined;
  registerTool?: (definition: unknown) => void;
  registerCommand?: (name: string, options: { description?: string; handler: (args: string, ctx: PiLikeContext) => unknown }) => void;
  events?: { emit?: (eventName: string, data: unknown) => void };
}

interface PiLikeContext {
  cwd?: string;
  ui?: {
    notify?: (message: string, level?: string) => void;
    setStatus?: (key: string, value: string) => void;
    setWidget?: (key: string, value: string[]) => void;
  };
  sessionManager?: {
    getSessionFile?: () => string | undefined;
    getLeafId?: () => string | undefined;
  };
}

interface SessionUiScope {
  isActive(): boolean;
  deactivate(): void;
  notify(message: string, level?: string): void;
  setStatus(key: string, value: string): void;
  setWidget(key: string, value: string[]): void;
}

export interface StartRegistrationOptions {
  resolveOptions?: Omit<ResolveActiveLocalTargetOptions, "env">;
  supervisor?: {
    initialDelayMs?: number;
    maxDelayMs?: number;
  };
}

interface ActiveLocalSupervisor {
  stop(): void;
}

const DEFAULT_SUPERVISOR_INITIAL_DELAY_MS = 1_000;
const DEFAULT_SUPERVISOR_MAX_DELAY_MS = 30_000;

let client: PostboxClient | undefined;
let currentRegistration: SessionRegisterPayload | undefined;
let semanticStateController: SemanticStateController | undefined;
let activeUiScope: SessionUiScope | undefined;
let activeLocalSupervisor: ActiveLocalSupervisor | undefined;
let unavailableRationale = "Pi Postbox is not connected.";

export default function postboxExtension(pi: PiLikeApi): void {
  semanticStateController = createSemanticStateController(() => client, pi);
  installSemanticStateHandlers(pi, semanticStateController);
  registerPostboxFallbackCommands(pi, () => client);
  pi.registerTool?.({
    name: "ask_postbox",
    label: "Ask Postbox",
    description: "Send a structured decision question to Pi Postbox and wait for the remote answer.",
    promptSnippet: "Ask the user for a remote decision through Pi Postbox.",
    promptGuidelines: [
      "Use ask_postbox when you need a human decision and can provide concise options. The tool blocks until the Postbox card is answered or cancelled."
    ],
    parameters: askPostboxParameters,
    async execute(_toolCallId: string, params: AskPostboxInput, signal?: AbortSignal) {
      if (!client || !currentRegistration) {
        const result = {
          status: "unavailable" as const,
          requestId: params.requestId ?? "unavailable",
          rationale: unavailableRationale,
          resolvedAt: new Date().toISOString()
        };
        return { content: [{ type: "text", text: formatAskResult(result) }], details: result };
      }

      const result = await executeAskPostbox(params, client, currentRegistration.session.sessionId, signal, semanticStateController);
      return { content: [{ type: "text", text: formatAskResult(result) }], details: result };
    }
  });

  pi.on("session_start", (_event, ctx) => {
    activeUiScope?.deactivate();
    stopActiveLocalSupervisor();
    activeUiScope = createSessionUiScope(ctx);
    const fallbackSessionIdentity = randomUUID();
    void startRegistration(pi, ctx, process.env, activeUiScope, fallbackSessionIdentity);
  });

  pi.on("session_shutdown", () => {
    activeUiScope?.deactivate();
    stopActiveLocalSupervisor();
    activeUiScope = undefined;
    client?.stop();
    client = undefined;
    currentRegistration = undefined;
  });
}

export async function startRegistration(
  pi: PiLikeApi,
  ctx: PiLikeContext,
  env: NodeJS.ProcessEnv = process.env,
  uiScope: SessionUiScope = createSessionUiScope(ctx),
  fallbackSessionIdentity?: string,
  options: StartRegistrationOptions = {}
): Promise<void> {
  stopActiveLocalSupervisor();
  const targetResult = await resolveActiveLocalTarget({ ...options.resolveOptions, env });
  if (!uiScope.isActive()) return;
  if (targetResult.status === "unavailable") {
    unavailableRationale = formatUnavailableRationale(targetResult);
    uiScope.setStatus("postbox", "Postbox unavailable");
    startNoClientActiveLocalSupervisor(pi, ctx, env, uiScope, fallbackSessionIdentity, options);
    return;
  }

  await registerResolvedTarget(pi, ctx, env, uiScope, fallbackSessionIdentity, targetResult.target, options);
}

async function registerResolvedTarget(
  pi: PiLikeApi,
  ctx: PiLikeContext,
  env: NodeJS.ProcessEnv,
  uiScope: SessionUiScope,
  fallbackSessionIdentity: string | undefined,
  target: ResolvedActiveLocalTarget,
  options: StartRegistrationOptions
): Promise<void> {
  unavailableRationale = "Pi Postbox is not connected.";

  try {
    const registration = await collectRegistrationPayload(pi, ctx, env, fallbackSessionIdentity);
    if (!uiScope.isActive()) return;
    currentRegistration = registration;
    client?.stop();
    client = new PostboxClient({
      serverUrl: target.url,
      registration,
      ...(target.activeLocalPollingEnabled
        ? {
            resolveTarget: () => resolveActiveLocalTarget({ ...options.resolveOptions, env }),
            activeLocalPollingEnabled: true
          }
        : {}),
      onStatus: (status) => uiScope.setStatus("postbox", `Postbox ${status}`),
      onLocalFallbackStatus: (status) => renderLocalFallbackStatus(uiScope, status)
    });
    client.start();
  } catch (error) {
    if (!uiScope.isActive()) return;
    const message = error instanceof Error ? error.message : String(error);
    uiScope.notify(`Pi Postbox registration skipped: ${message}`, "warn");
    uiScope.setStatus("postbox", "Postbox registration skipped");
  }
}

function startNoClientActiveLocalSupervisor(
  pi: PiLikeApi,
  ctx: PiLikeContext,
  env: NodeJS.ProcessEnv,
  uiScope: SessionUiScope,
  fallbackSessionIdentity: string | undefined,
  options: StartRegistrationOptions
): void {
  if (activeLocalSupervisor || client) return;

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let nextDelayMs = options.supervisor?.initialDelayMs ?? DEFAULT_SUPERVISOR_INITIAL_DELAY_MS;
  const maxDelayMs = options.supervisor?.maxDelayMs ?? DEFAULT_SUPERVISOR_MAX_DELAY_MS;

  const stop = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (activeLocalSupervisor?.stop === stop) {
      activeLocalSupervisor = undefined;
    }
  };

  const schedule = (delayMs: number) => {
    timer = setTimeout(() => {
      void tick();
    }, delayMs);
    timer.unref?.();
  };

  const tick = async () => {
    if (stopped || !uiScope.isActive() || client) {
      stop();
      return;
    }

    const targetResult = await resolveActiveLocalTarget({ ...options.resolveOptions, env });
    if (stopped || !uiScope.isActive() || client) {
      stop();
      return;
    }

    if (targetResult.status === "unavailable") {
      unavailableRationale = formatUnavailableRationale(targetResult);
      uiScope.setStatus("postbox", "Postbox unavailable");
      const delayMs = nextDelayMs;
      nextDelayMs = Math.min(nextDelayMs * 2, maxDelayMs);
      schedule(delayMs);
      return;
    }

    if (!targetResult.target.activeLocalPollingEnabled) {
      stop();
      return;
    }

    stop();
    await registerResolvedTarget(pi, ctx, env, uiScope, fallbackSessionIdentity, targetResult.target, options);
  };

  activeLocalSupervisor = { stop };
  schedule(nextDelayMs);
}

function stopActiveLocalSupervisor(): void {
  activeLocalSupervisor?.stop();
  activeLocalSupervisor = undefined;
}

export async function collectRegistrationPayload(
  pi: PiLikeApi,
  ctx: PiLikeContext,
  env: NodeJS.ProcessEnv = process.env,
  fallbackSessionIdentity?: string
): Promise<SessionRegisterPayload> {
  const cwd = ctx.cwd ?? process.cwd();
  const project = collectProjectMetadata(cwd);
  const session = collectSessionMetadata(pi, ctx, project.branch, project.worktreePath, fallbackSessionIdentity);
  const machine = await getMachineIdentity(env);
  return { machine, project, session };
}

function formatUnavailableRationale(result: Extract<ResolveActiveLocalTargetResult, { status: "unavailable" }>): string {
  const codes = [...new Set(result.diagnostics.map((diagnostic) => diagnostic.code))];
  if (codes.length === 0) return "Pi Postbox is not connected.";
  return `Pi Postbox is unavailable after active-local target resolution (${codes.join(", ")}).`;
}

function createSessionUiScope(ctx: PiLikeContext): SessionUiScope {
  let active = true;
  return {
    isActive: () => active,
    deactivate: () => {
      active = false;
      stopActiveLocalSupervisor();
    },
    notify(message, level) {
      if (!active) return;
      ctx.ui?.notify?.(message, level);
    },
    setStatus(key, value) {
      if (!active) return;
      ctx.ui?.setStatus?.(key, value);
    },
    setWidget(key, value) {
      if (!active) return;
      ctx.ui?.setWidget?.(key, value);
    }
  };
}

function renderLocalFallbackStatus(uiScope: SessionUiScope, status: LocalFallbackStatus | undefined): void {
  if (!status) {
    uiScope.setStatus("postbox-ask", "");
    uiScope.setWidget("postbox-ask", []);
    return;
  }
  uiScope.setStatus("postbox-ask", `Waiting ${status.requestId}`);
  uiScope.setWidget("postbox-ask", [status.message]);
  uiScope.notify(status.message, "info");
}
