import { randomUUID } from "node:crypto";
import type { SessionRegisterPayload } from "../../protocol/src/index.js";
import { PostboxClient, type LocalFallbackStatus } from "./client/PostboxClient.js";
import { registerPostboxFallbackCommands } from "./commands/localFallback.js";
import { registerOpenPostboxCommand } from "./commands/openPostbox.js";
import { ensurePostboxServerAutostarted, getPostboxAutostartFailureDiagnostic, postboxAutostartTimeoutMs } from "./autostart.js";
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
import { collectPostboxStatusSnapshot, formatPostboxStatusSnapshot } from "./status.js";
import { PiQuestionChatRuntimeAdapter, QuestionChatRuntimeRegistry } from "./questionChatRuntime.js";

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

interface ActiveSessionRegistrationContext {
  pi: PiLikeApi;
  ctx: PiLikeContext;
  uiScope: SessionUiScope;
  fallbackSessionIdentity: string;
  options: StartRegistrationOptions;
}

const DEFAULT_SUPERVISOR_INITIAL_DELAY_MS = 1_000;
const DEFAULT_SUPERVISOR_MAX_DELAY_MS = 30_000;
const AUTOSTART_RECOVERY_METADATA_TTL_MS = 24 * 60 * 60 * 1_000;
const RELOAD_FALLBACK_IDENTITY = Symbol.for("@wienerberliner/pi-postbox/reload-fallback-session-identity");

interface ReloadIdentityGlobal {
  [RELOAD_FALLBACK_IDENTITY]?: string;
}

let client: PostboxClient | undefined;
let currentRegistration: SessionRegisterPayload | undefined;
let semanticStateController: SemanticStateController | undefined;
let activeUiScope: SessionUiScope | undefined;
let activeLocalSupervisor: ActiveLocalSupervisor | undefined;
let activeSessionRegistrationContext: ActiveSessionRegistrationContext | undefined;
let unavailableRationale = "Pi Postbox is not connected.";
const registrationWaiters = new Set<() => void>();
const questionChats = new QuestionChatRuntimeRegistry(new PiQuestionChatRuntimeAdapter());

export default function postboxExtension(pi: PiLikeApi): void {
  semanticStateController = createSemanticStateController(() => client, pi);
  installSemanticStateHandlers(pi, semanticStateController);
  registerPostboxFallbackCommands(pi, () => client, () => collectExtensionPostboxStatusSnapshot(process.env));
  registerOpenPostboxCommand(pi, {
    ensureReady: () => ensureRegistrationForMutatingCaller(process.env),
    getStatusSnapshot: () => collectExtensionPostboxStatusSnapshot(process.env)
  });
  pi.registerTool?.({
    name: "postbox_status",
    label: "Postbox Status",
    description: "Return privacy-preserving Pi Postbox connectivity, operator, and open-question count status.",
    annotations: { readOnlyHint: true },
    parameters: { type: "object", properties: {}, additionalProperties: false },
    async execute() {
      const snapshot = await collectExtensionPostboxStatusSnapshot(process.env);
      return { content: [{ type: "text", text: formatPostboxStatusSnapshot(snapshot) }], details: snapshot };
    }
  });

  pi.registerTool?.({
    name: "ask_postbox",
    label: "Ask Postbox",
    description: "Send a structured decision question to Pi Postbox and wait for the remote answer.",
    promptSnippet: "Ask the user for a remote decision through Pi Postbox.",
    promptGuidelines: [
      "Use ask_postbox when you need a human decision and can provide concise options. Include non-blank context.codebaseContext and context.problemContext so a future interviewer can explain the decision. The tool blocks until the Postbox card is answered or cancelled."
    ],
    parameters: askPostboxParameters,
    async execute(_toolCallId: string, params: AskPostboxInput, signal?: AbortSignal) {
      if (!client || !currentRegistration) {
        await ensureRegistrationForMutatingCaller(process.env, signal);
      }

      if (!client || !currentRegistration) {
        const result = {
          status: "unavailable" as const,
          requestId: params.requestId ?? "unavailable",
          rationale: unavailableRationale,
          resolvedAt: new Date().toISOString()
        };
        return { content: [{ type: "text", text: formatAskResult(result) }], details: result };
      }

      const liveContext = activeSessionRegistrationContext?.ctx;
      const liveSessionPath = liveContext?.sessionManager?.getSessionFile?.();
      const liveLeafId = liveContext?.sessionManager?.getLeafId?.();
      if (liveSessionPath && liveLeafId) {
        const source = { cwd: liveContext?.cwd ?? currentRegistration.session.cwd, agentSessionPath: liveSessionPath, leafId: liveLeafId };
        const sourceAwareClient = client as PostboxClient & { updateQuestionSource?: (value: typeof source) => boolean };
        sourceAwareClient.updateQuestionSource?.(source);
        currentRegistration = {
          ...currentRegistration,
          session: { ...currentRegistration.session, ...source }
        };
      }

      const result = await executeAskPostbox(params, client, currentRegistration.session.sessionId, signal, semanticStateController);
      return { content: [{ type: "text", text: formatAskResult(result) }], details: result };
    }
  });

  pi.on("session_start", (_event, ctx) => {
    activeUiScope?.deactivate();
    stopActiveLocalSupervisor();
    activeUiScope = createSessionUiScope(ctx);
    const fallbackSessionIdentity = consumeReloadFallbackIdentity() ?? randomUUID();
    const options: StartRegistrationOptions = {};
    activeSessionRegistrationContext = { pi, ctx, uiScope: activeUiScope, fallbackSessionIdentity, options };
    void startRegistration(pi, ctx, process.env, activeUiScope, fallbackSessionIdentity, options);
  });

  pi.on("session_shutdown", async (event, ctx) => {
    const reason = event && typeof event === "object" && "reason" in event ? (event as { reason?: unknown }).reason : undefined;
    preserveFallbackIdentityForReload(reason, activeSessionRegistrationContext?.fallbackSessionIdentity);
    const ownerSessionId = currentRegistration?.session.sessionId ?? collectSessionMetadata(
      pi,
      activeSessionRegistrationContext?.ctx ?? ctx,
      undefined,
      undefined,
      activeSessionRegistrationContext?.fallbackSessionIdentity
    ).sessionId;
    const chatCleanup = reason === "reload" ? questionChats.suspendAll() : questionChats.cleanupAll(ownerSessionId);
    activeUiScope?.deactivate();
    stopActiveLocalSupervisor();
    activeUiScope = undefined;
    activeSessionRegistrationContext = undefined;
    client?.stop();
    client = undefined;
    currentRegistration = undefined;
    notifyRegistrationWaiters();
    await chatCleanup;
  });
}

function consumeReloadFallbackIdentity(): string | undefined {
  const reloadState = globalThis as ReloadIdentityGlobal;
  const identity = reloadState[RELOAD_FALLBACK_IDENTITY];
  delete reloadState[RELOAD_FALLBACK_IDENTITY];
  return identity;
}

function preserveFallbackIdentityForReload(reason: unknown, identity: string | undefined): void {
  const reloadState = globalThis as ReloadIdentityGlobal;
  if (reason === "reload" && identity) {
    reloadState[RELOAD_FALLBACK_IDENTITY] = identity;
    return;
  }
  delete reloadState[RELOAD_FALLBACK_IDENTITY];
}

async function collectExtensionPostboxStatusSnapshot(env: NodeJS.ProcessEnv) {
  return collectPostboxStatusSnapshot({ client, env, unavailableRationale });
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
      targetSource: target.source,
      targetRole: target.role,
      registration,
      ...(target.activeLocalPollingEnabled
        ? {
            resolveTarget: createSessionStickyActiveLocalResolver(env, options, target),
            activeLocalPollingEnabled: true
          }
        : {}),
      onStatus: (status) => uiScope.setStatus("postbox", `Postbox ${status}`),
      onLocalFallbackStatus: (status) => {
        void renderLocalFallbackStatus(uiScope, status);
      },
      questionChats
    });
    client.start();
    notifyRegistrationWaiters();
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

    const targetResult = await resolveActiveLocalTarget({
      ...options.resolveOptions,
      ttlMs: options.resolveOptions?.ttlMs ?? AUTOSTART_RECOVERY_METADATA_TTL_MS,
      env
    });
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

function createSessionStickyActiveLocalResolver(
  env: NodeJS.ProcessEnv,
  options: StartRegistrationOptions,
  originalTarget: ResolvedActiveLocalTarget
): () => Promise<ResolveActiveLocalTargetResult> {
  return async () => {
    const result = await resolveActiveLocalTarget({ ...options.resolveOptions, env, skipConfiguredRemote: true });
    if (result.status !== "selected") return result;
    if (isSameSessionStickyLocalTarget(originalTarget, result.target)) return result;

    return {
      status: "unavailable",
      diagnostics: [
        ...result.diagnostics,
        {
          code: "session-sticky-target-mismatch",
          source: result.target.source,
          role: result.target.role
        }
      ]
    };
  };
}

function isSameSessionStickyLocalTarget(original: ResolvedActiveLocalTarget, next: ResolvedActiveLocalTarget): boolean {
  if (next.source !== original.source || next.url !== original.url) return false;
  if (original.source === "active-local") {
    return next.role === original.role && next.instanceId === original.instanceId;
  }
  return true;
}

async function retryRegistrationForMutatingCaller(env: NodeJS.ProcessEnv): Promise<boolean> {
  const context = activeSessionRegistrationContext;
  if (!context || !context.uiScope.isActive()) return false;

  const targetResult = await resolveActiveLocalTarget({ ...context.options.resolveOptions, env });
  if (!context.uiScope.isActive()) return false;
  if (client && (await isCurrentClientConnected())) return true;
  if (client) {
    if (clientHasPendingAsks(client)) return true;
    client.stop();
    client = undefined;
    currentRegistration = undefined;
  }

  if (targetResult.status === "unavailable") {
    unavailableRationale = formatUnavailableRationale(targetResult);
    context.uiScope.setStatus("postbox", "Postbox unavailable");
    return false;
  }

  stopActiveLocalSupervisor();
  await registerResolvedTarget(
    context.pi,
    context.ctx,
    env,
    context.uiScope,
    context.fallbackSessionIdentity,
    targetResult.target,
    context.options
  );
  return true;
}

async function ensureRegistrationForMutatingCaller(env: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<void> {
  const targetWasAvailable = await retryRegistrationForMutatingCaller(env);
  if (client && currentRegistration && (await isCurrentClientConnected())) return;
  if (targetWasAvailable && client && currentRegistration) return;

  let asyncAutostartFailure: string | undefined;
  const autostartResult = ensurePostboxServerAutostarted(env, {
    onFailure: (diagnostic) => {
      asyncAutostartFailure = diagnostic;
    }
  });
  if (autostartResult.status === "disabled" || autostartResult.status === "failed") {
    unavailableRationale = `${unavailableRationale} ${autostartResult.diagnostic}`;
    return;
  }

  await waitForRegistration(
    postboxAutostartTimeoutMs(env),
    env,
    autostartResult.diagnostic,
    () => asyncAutostartFailure,
    signal
  );
}

function clientHasPendingAsks(postboxClient: PostboxClient): boolean {
  return postboxClient.listPendingAsks().length > 0;
}

async function isCurrentClientConnected(): Promise<boolean> {
  try {
    return (await client?.getStatusSnapshot?.())?.connection.state === "connected";
  } catch {
    return false;
  }
}

function waitForRegistration(
  timeoutMs: number,
  env: NodeJS.ProcessEnv,
  autostartDiagnostic: string,
  getAsyncAutostartFailure: () => string | undefined,
  signal?: AbortSignal
): Promise<void> {
  if (client && currentRegistration) return Promise.resolve();
  if (signal?.aborted) return Promise.reject(new Error("ask_postbox was aborted"));

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let polling = false;

    const settle = (kind: "resolve" | "reject", error?: Error) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (pollTimer) clearInterval(pollTimer);
      registrationWaiters.delete(onRegistered);
      signal?.removeEventListener("abort", onAbort);
      if (kind === "reject") reject(error ?? new Error("ask_postbox was aborted"));
      else resolve();
    };

    const pollForRegistration = async () => {
      if (settled || polling || client) return;
      polling = true;
      try {
        await retryRegistrationForMutatingCaller(env);
        if (client && currentRegistration) settle("resolve");
      } finally {
        polling = false;
      }
    };

    const onRegistered = () => settle("resolve");
    const onAbort = () => settle("reject", new Error("ask_postbox was aborted"));

    registrationWaiters.add(onRegistered);
    signal?.addEventListener("abort", onAbort, { once: true });
    pollTimer = setInterval(() => {
      void pollForRegistration();
    }, 100);
    pollTimer.unref?.();
    timeout = setTimeout(() => {
      const failureDiagnostic = getAsyncAutostartFailure() ?? getPostboxAutostartFailureDiagnostic(env);
      unavailableRationale = failureDiagnostic
        ? `Pi Postbox autostart failed before healthy active-local metadata was available. ${failureDiagnostic}`
        : `Pi Postbox autostart timed out after ${timeoutMs}ms waiting for healthy active-local metadata. ${autostartDiagnostic}`;
      settle("resolve");
    }, timeoutMs);
    timeout.unref?.();
    void pollForRegistration();
  });
}

function notifyRegistrationWaiters(): void {
  for (const waiter of [...registrationWaiters]) waiter();
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

async function renderLocalFallbackStatus(uiScope: SessionUiScope, status: LocalFallbackStatus | undefined): Promise<void> {
  if (!status) {
    uiScope.setStatus("postbox-ask", "");
    uiScope.setWidget("postbox-ask", []);
    return;
  }

  const displayUrl = await resolveAskDisplayUrl(status);
  const message = status.message.replace(`Open ${status.serverUrl} to answer.`, `Open ${displayUrl} to answer.`);
  uiScope.setStatus("postbox-ask", `Postbox ${displayUrl}`);
  uiScope.setWidget("postbox-ask", [message]);
  uiScope.notify(message, "info");
}

async function resolveAskDisplayUrl(status: LocalFallbackStatus): Promise<string> {
  try {
    const snapshot = await client?.getStatusSnapshot?.();
    return snapshot?.connection.tailnetUrl ?? status.serverUrl;
  } catch {
    return status.serverUrl;
  }
}
