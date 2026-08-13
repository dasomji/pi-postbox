import { randomUUID } from "node:crypto";
import { AnswerReadResultSchema, type SessionRegisterPayload } from "@pi-postbox/protocol";
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
import { FileAnswerNotificationInbox } from "./answerNotificationInbox.js";

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
    getSessionId?: () => string;
    getSessionFile?: () => string | undefined;
    getLeafId?: () => string | undefined;
  };
}

export function createWaitForPostboxTool(wait: (signal?: AbortSignal) => Promise<Record<string, unknown>>) {
  return {
    name: "wait_for_postbox", label: "Wait for Postbox", annotations: { readOnlyHint: false },
    description: "Cancellably wait for the first actionable event across every Question owned by this agent.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    async execute(_id: string, _params: Record<string, never>, signal?: AbortSignal) {
      const result = await wait(signal);
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
    }
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
const questionChats = new QuestionChatRuntimeRegistry(new PiQuestionChatRuntimeAdapter({
  proposeAnswer: (requestId, proposal, signal) => client
    ? client.proposeAnswer(requestId, proposal, signal)
    : Promise.resolve({
        status: "error",
        error: { code: "internal_error", message: "Postbox is not connected." }
      })
}));

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
    description: "Persist a structured decision question in Pi Postbox and return after server acknowledgement.",
    promptSnippet: "Queue a remote decision, continue other work, then use get_answer after notification.",
    promptGuidelines: [
      "Use ask_postbox when you need a human decision and can provide concise options. Include non-blank context.codebaseContext and context.problemContext. It returns after durable persistence, not after an Answer. Continue non-blocked work and call get_answer with the questionId after notification."
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

  pi.registerTool?.({
    name: "get_answer",
    label: "Get Postbox Answer",
    description: "Read the latest Answer for an owned Postbox Question; the registered Pi session supplies reader identity.",
    annotations: { readOnlyHint: false },
    parameters: { type: "object", additionalProperties: false, required: ["questionId"], properties: {
      questionId: { type: "string", minLength: 1, description: "Question ID returned by ask_postbox." }
    } },
    async execute(_toolCallId: string, params: { questionId: string }) {
      if (!client || !currentRegistration) await ensureRegistrationForMutatingCaller(process.env);
      if (!client) throw new Error(unavailableRationale);
      const result = AnswerReadResultSchema.parse(await client.getAnswer(params.questionId));
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
    }
  });

  const registerQueryTool = (name: string, description: string, parameters: any, type: any, payload: (params: any) => any = (value) => value) => pi.registerTool?.({
    name, label: name, description, annotations: { readOnlyHint: true }, parameters,
    async execute(_id: string, params: any) {
      if (!client || !currentRegistration) await ensureRegistrationForMutatingCaller(process.env);
      if (!client || !currentRegistration) throw new Error(unavailableRationale);
      const result = await client.query(type, payload(params));
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
    }
  });
  const filters = { owner: { type: "object" }, repository: { type: "string" }, worktree: { type: "string" }, feature: { type: "string" }, status: { type: "string" }, global: { type: "boolean" } };
  registerQueryTool("list_questions", "List compact active Postbox Question IDs and text in the current repository/worktree/feature unless deliberately broadened.",
    { type: "object", additionalProperties: false, properties: { ...filters, cursor: { type: "string" }, pageSize: { type: "number" } } }, "question.list",
    (params: any) => ({ sessionId: currentRegistration!.session.sessionId, ...params }));
  registerQueryTool("get_questions", "Get complete latest Question details for explicit IDs without Answer content.",
    { type: "object", additionalProperties: false, required: ["questionIds"], properties: { questionIds: { type: "array", minItems: 1, items: { type: "string" } } } }, "questions.get");
  registerQueryTool("list_question_status", "List compact actionable Question and unread Answer status.",
    { type: "object", additionalProperties: false, properties: { ...filters, readState: { type: "string", enum: ["read", "unread"] }, includeTerminal: { type: "boolean" } } }, "question.status.list",
    (params: any) => ({ sessionId: currentRegistration!.session.sessionId, ...params }));
  registerQueryTool("get_postbox_owner_status", "Get compact presence and queue counts for exact harness-neutral owners.",
    { type: "object", additionalProperties: false, required: ["owners"], properties: {
      owners: { type: "array", minItems: 1, items: { type: "object", additionalProperties: false,
        required: ["harness", "ownerId"], properties: { harness: { type: "string" }, ownerId: { type: "string" } } } }
    } }, "owner.status.get");
  registerQueryTool("update_question", "Revise, cancel, supersede, or reparent an owned Question with expected-revision concurrency.",
    { type: "object", additionalProperties: false, required: ["questionId", "update"], properties: { questionId: { type: "string" }, update: {
      oneOf: [
        { type: "object", additionalProperties: false, required: ["action", "expectedRevision", "question"], properties: {
          action: { const: "revise" }, expectedRevision: { type: "integer", minimum: 1 },
          question: { type: "object", additionalProperties: false, required: ["prompt"], properties: {
            prompt: { type: "string" }, context: { type: "string" }, relevance: { type: "string" }, decisionImpact: { type: "string" }
          } },
          options: { type: "array", minItems: 1, maxItems: 20, items: { type: "object", additionalProperties: false,
            required: ["value", "label"], properties: { value: { type: "string" }, label: { type: "string" }, description: { type: "string" }, meaning: { type: "string" }, context: { type: "string" } } } },
          context: { type: "object", additionalProperties: false, required: ["codebaseContext", "problemContext"], properties: {
            codebaseContext: { type: "string" }, problemContext: { type: "string" }, additionalInfo: { type: "array", maxItems: 20, items: {
              type: "object", additionalProperties: false, required: ["content"], properties: {
                kind: { type: "string", enum: ["text", "code", "diagram", "link"] }, title: { type: "string" },
                content: { type: "string" }, language: { type: "string" }
              }
            } }
          } }
        } },
        { type: "object", additionalProperties: false, required: ["action", "expectedRevision"], properties: {
          action: { const: "cancel" }, expectedRevision: { type: "integer", minimum: 1 }, rationale: { type: "string" }
        } },
        { type: "object", additionalProperties: false, required: ["action", "expectedRevision", "replacementQuestionId"], properties: {
          action: { const: "supersede" }, expectedRevision: { type: "integer", minimum: 1 }, replacementQuestionId: { type: "string" }
        } },
        { type: "object", additionalProperties: false, required: ["action", "expectedRevision", "parentQuestionId"], properties: {
          action: { const: "reparent" }, expectedRevision: { type: "integer", minimum: 1 }, parentQuestionId: { type: ["string", "null"] }
        } }
      ]
    } } }, "question.update",
    (params: any) => ({ sessionId: currentRegistration!.session.sessionId, ...params }));
  registerQueryTool("get_question_history", "Explicitly retrieve immutable Question revision, parent, and terminal event facts.",
    { type: "object", additionalProperties: false, required: ["questionId"], properties: { questionId: { type: "string" } } }, "question.history.get");
  pi.registerTool?.(createWaitForPostboxTool(async (signal) => {
      if (!client || !currentRegistration) await ensureRegistrationForMutatingCaller(process.env, signal);
      if (!client || !currentRegistration) throw new Error(unavailableRationale);
      return client.waitForPostbox(currentRegistration.session.sessionId, signal);
  }));

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
      onAnswerAvailable: (notification, deliveryId) => {
        // Stable widget identity makes at-least-once transport replay owner-visible exactly once.
        uiScope.setWidget(`postbox-answer-${deliveryId}`, [
          `Postbox answer ready for “${notification.question}” (${notification.questionId}). Use get_answer.`
        ]);
      },
      answerNotificationInbox: new FileAnswerNotificationInbox(env),
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
