import { randomUUID } from "node:crypto";
import {
  ASK_STATUSES,
  AnswerReadResultSchema,
  POSTBOX_EXPLICIT_ID_MAX,
  POSTBOX_OWNER_PAGE_MAX,
  QUESTION_DISCOVERY_PAGE_MAX,
  QUESTION_HISTORY_PAGE_MAX,
  QUESTION_STATUS_PAGE_MAX,
  type SessionRegisterPayload
} from "./protocol.js";
import { PostboxClient } from "./client/PostboxClient.js";
import { registerPostboxFallbackCommands } from "./commands/localFallback.js";
import { registerOpenPostboxCommand } from "./commands/openPostbox.js";
import { ensurePostboxServerAutostarted, getPostboxAutostartFailureDiagnostic, postboxAutostartTimeoutMs } from "./autostart.js";
import {
  resolveServerTarget,
  type ResolveServerTargetOptions,
  type ResolveServerTargetResult,
  type ResolvedServerTarget
} from "./serverTargetResolver.js";
import { createSemanticStateController, installSemanticStateHandlers, type SemanticStateController } from "./lifecycle.js";
import { getMachineIdentity } from "./machineIdentity.js";
import { collectProjectMetadata } from "./projectMetadata.js";
import { collectSessionMetadata } from "./sessionMetadata.js";
import { executeAskPostbox } from "./tools/askPostbox.js";
import {
  normalizeWriteQuestionResult,
  toAskPostboxInput,
  toQuestionUpdateRequest,
  writeQuestionParameters,
  type WriteQuestionInput
} from "./tools/writeQuestion.js";
import { collectPostboxStatusSnapshot, formatPostboxStatusSnapshot } from "./status.js";
import { PiQuestionChatRuntimeAdapter, QuestionChatRuntimeRegistry } from "./questionChatRuntime.js";
import { FileAnswerNotificationInbox } from "./answerNotificationInbox.js";
import { resolveServerProfile, type ResolvedServerProfile } from "./serverProfile.js";
import { readExtensionConfig } from "./config.js";
import {
  AnswerAutoWakeCoordinator,
  resolveAnswerAutoWakeEnabled,
  type AnswerAutoWakePiApi,
  type AnswerAutoWakeSessionManager
} from "./answerAutoWake.js";

interface PiLikeApi extends AnswerAutoWakePiApi {
  on(event: string, handler: (event: unknown, ctx: PiLikeContext) => unknown): void;
  getSessionName?: () => string | undefined;
  registerTool?: (definition: unknown) => void;
  registerCommand?: (name: string, options: { description?: string; handler: (args: string, ctx: PiLikeContext) => unknown }) => void;
  events?: { emit?: (eventName: string, data: unknown) => void };
}

interface PiLikeContext {
  hasUI?: boolean;
  cwd?: string;
  ui?: {
    confirm?: (title: string, message: string) => Promise<boolean>;
    notify?: (message: string, level?: string) => void;
    setStatus?: (key: string, value: string) => void;
    setWidget?: (key: string, value: string[] | undefined) => void;
  };
  sessionManager?: AnswerAutoWakeSessionManager & {
    getSessionId?: () => string;
    getSessionFile?: () => string | undefined;
    getLeafId?: () => string | undefined;
  };
}

export function createWaitForPostboxTool(wait: (signal?: AbortSignal) => Promise<Record<string, unknown>>) {
  return {
    name: "wait_for_postbox", label: "Wait for Postbox", annotations: { readOnlyHint: false },
    description: "Cancellably idle until the first actionable event across every Question owned by this agent.",
    promptGuidelines: [
      "Use wait_for_postbox only when a human Postbox decision is the only blocker and no independent work remains. Call it once, remain idle until it wakes from a notification or actionable lifecycle event, then use get_answer for the relevant Question. Never use repeated status or Answer reads as a polling substitute."
    ],
    parameters: { type: "object", properties: {}, additionalProperties: false },
    async execute(_id: string, _params: Record<string, never>, signal?: AbortSignal) {
      const result = await wait(signal);
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
    }
  };
}

export function createPostboxNavigationGuard(options: {
  owner: { harness: string; ownerId: string };
  query: (type: "owner.status.get", payload: { owners: Array<{ harness: string; ownerId: string }> }) => Promise<Array<{ activeQuestionCount?: number; unreadAnswerCount?: number }>>;
  confirm: (title: string, message: string) => Promise<boolean>;
}) {
  return async () => {
    try {
      const [status] = await options.query("owner.status.get", { owners: [options.owner] });
      const active = status?.activeQuestionCount ?? 0;
      const unread = status?.unreadAnswerCount ?? 0;
      if (active === 0 && unread === 0) return;
      const confirmed = await options.confirm("Leave Postbox work unresolved?",
        `${active} active Question(s) and ${unread} unread Answer(s) will remain assigned to this owner. Continue?`);
      if (!confirmed) return { cancel: true };
    } catch {
      // Navigation must fail open: Postbox can warn, but cannot trap the user.
      return;
    }
  };
}

interface SessionUiScope {
  isActive(): boolean;
  deactivate(): void;
  notify(message: string, level?: string): void;
  setStatus(key: string, value: string): void;
  setWidget(key: string, value: string[] | undefined): void;
}

export interface StartRegistrationOptions {
  resolveOptions?: Omit<ResolveServerTargetOptions, "env">;
  supervisor?: {
    initialDelayMs?: number;
    maxDelayMs?: number;
  };
}

interface ProfileSupervisor {
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
let profileSupervisor: ProfileSupervisor | undefined;
let answerAutoWakeCoordinator: AnswerAutoWakeCoordinator | undefined;
let activeSessionRegistrationContext: ActiveSessionRegistrationContext | undefined;
let unavailableNote = "Pi Postbox is not connected.";
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
    description: "Return privacy-preserving Pi Postbox connectivity, operator, and current-owner open-question count status.",
    annotations: { readOnlyHint: true },
    parameters: { type: "object", properties: {}, additionalProperties: false },
    async execute() {
      const snapshot = await collectExtensionPostboxStatusSnapshot(process.env);
      return { content: [{ type: "text", text: formatPostboxStatusSnapshot(snapshot) }], details: snapshot };
    }
  });

  pi.registerTool?.({
    name: "write_question",
    label: "Write Question",
    description: "Create, revise, cancel, supersede, reparent, transfer, or take over Postbox Questions through one compact write interface.",
    annotations: { readOnlyHint: false },
    promptGuidelines: [
      "Use write_question action create or create_batch when you need a human decision. State the ambiguity and concise options. Creation returns after durable persistence with questionId, revision, and ownerRevision; it does not wait for an Answer. Continue independent work and do not poll get_answer, list_question_status, or list_questions. If the Answer is the only blocker, call wait_for_postbox once, remain idle until it wakes, then call get_answer. Existing-Question actions require the latest revision and ownerRevision; reuse the handle returned by the preceding write, and fetch full current state only after a conflict or external change."
    ],
    parameters: writeQuestionParameters,
    async execute(_toolCallId: string, params: WriteQuestionInput, signal?: AbortSignal) {
      if (!client || !currentRegistration) await ensureRegistrationForMutatingCaller(process.env, signal);

      if (!client || !currentRegistration) {
        if (params.action !== "create" && params.action !== "create_batch") throw new Error(unavailableNote);
        const unavailable = {
          status: "unavailable" as const,
          requestId: params.requestId ?? "unavailable",
          note: unavailableNote,
          resolvedAt: new Date().toISOString()
        };
        const result = normalizeWriteQuestionResult(params.action, unavailable);
        return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
      }

      let rawResult: Record<string, unknown>;
      if (params.action === "create" || params.action === "create_batch") {
        const liveContext = activeSessionRegistrationContext?.ctx;
        const liveSessionPath = liveContext?.sessionManager?.getSessionFile?.();
        const liveLeafId = liveContext?.sessionManager?.getLeafId?.();
        if (liveSessionPath && liveLeafId) {
          const source = { cwd: liveContext?.cwd ?? currentRegistration.session.cwd, agentSessionPath: liveSessionPath, leafId: liveLeafId };
          const sourceAwareClient = client as PostboxClient & { updateQuestionSource?: (value: typeof source) => boolean };
          sourceAwareClient.updateQuestionSource?.(source);
          currentRegistration = { ...currentRegistration, session: { ...currentRegistration.session, ...source } };
        }
        rawResult = await executeAskPostbox(
          toAskPostboxInput(params),
          client,
          currentRegistration.session.sessionId,
          signal,
          semanticStateController
        ) as unknown as Record<string, unknown>;
      } else {
        const request = toQuestionUpdateRequest(params);
        rawResult = await client.query("question.update", {
          sessionId: currentRegistration.session.sessionId,
          ...request
        }) as Record<string, unknown>;
      }

      const result = normalizeWriteQuestionResult(params.action, rawResult);
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
    }
  });

  pi.registerTool?.({
    name: "get_answer",
    label: "Get Postbox Answer",
    description: "Read the latest Answer for an owned Postbox Question, or receive a compact pending result while unresolved; the registered Pi session supplies reader identity.",
    annotations: { readOnlyHint: false },
    parameters: { type: "object", additionalProperties: false, required: ["questionId"], properties: {
      questionId: { type: "string", minLength: 1, description: "Question ID returned by write_question." }
    } },
    async execute(_toolCallId: string, params: { questionId: string }, signal?: AbortSignal) {
      if (!client || !currentRegistration) await ensureRegistrationForMutatingCaller(process.env);
      if (!client) throw new Error(unavailableNote);
      const answerUiScope = activeUiScope;
      const result = AnswerReadResultSchema.parse(await client.getAnswer(params.questionId, signal));
      if ("answerId" in result && answerUiScope?.isActive()) {
        answerUiScope.setWidget(answerNotificationWidgetKey(result.answerId), undefined);
      }
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
    }
  });

  const registerQueryTool = (name: string, description: string, parameters: any, type: any, payload: (params: any) => any = (value) => value) => pi.registerTool?.({
    name, label: name, description, annotations: { readOnlyHint: name !== "recover_question_answer" }, parameters,
    async execute(_id: string, params: any) {
      if (!client || !currentRegistration) await ensureRegistrationForMutatingCaller(process.env);
      if (!client || !currentRegistration) throw new Error(unavailableNote);
      const result = await client.query(type, payload(params));
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
    }
  });
  const ownerIdentityParameters = {
    type: "object", additionalProperties: false, required: ["harness", "ownerId"],
    properties: {
      harness: { type: "string", minLength: 1, description: "Agent harness that owns the Question." },
      ownerId: { type: "string", minLength: 1, description: "Harness-neutral owner identifier." }
    }
  };
  const filters = {
    owner: { ...ownerIdentityParameters, description: "Exact owner identity; normally omit and use scope." },
    status: {
      type: "string",
      enum: [...ASK_STATUSES],
      description: "Question lifecycle status. Use 'pending' for open or unanswered questions."
    }
  };
  const discoveryScope = {
    type: "string",
    enum: ["owner", "feature", "worktree", "repository", "global"],
    description: "Discovery breadth. Defaults to the current owner; broader values deliberately include other owners."
  };
  registerQueryTool("list_questions", "List compact pending Question IDs and text. Defaults to Questions owned by the current Pi session; set scope explicitly to broaden across a feature, worktree, repository, or all Postbox Questions.",
    { type: "object", additionalProperties: false, properties: {
      ...filters,
      scope: discoveryScope,
      cursor: { type: "string", description: "Opaque pagination cursor returned by a previous list response." },
      pageSize: { type: "integer", minimum: 1, maximum: QUESTION_DISCOVERY_PAGE_MAX,
        description: "Maximum number of Questions to return on this page." }
    } }, "question.list",
    (params: any) => ({ sessionId: currentRegistration!.session.sessionId, ...params }));
  registerQueryTool("get_questions", "Get compact latest Question controls for explicit IDs by default; request the full view for complete current Question and resolution evidence.",
    { type: "object", additionalProperties: false, required: ["questionIds"], properties: {
      questionIds: {
        type: "array", minItems: 1, maxItems: POSTBOX_EXPLICIT_ID_MAX, description: "Question IDs to retrieve.",
        items: { type: "string", description: "One Question ID returned by Postbox." }
      },
      view: {
        type: "string",
        enum: ["control", "full"],
        description: "Defaults to compact control records; use 'full' for complete Question content."
      }
    } }, "questions.get");
  registerQueryTool("list_question_status", "List one page of compact actionable Question and unread Answer status as { statuses, nextCursor? }. Defaults to Questions owned by the current Pi session; set scope explicitly to broaden.",
    { type: "object", additionalProperties: false, properties: {
      ...filters,
      scope: discoveryScope,
      readState: { type: "string", enum: ["read", "unread"], description: "Human Answer read state; composes conjunctively with status." },
      includeTerminal: { type: "boolean", description: "With no status/readState filter, include every lifecycle state instead of only actionable pending and unread items." },
      cursor: { type: "string", description: "Opaque pagination cursor returned by a previous status page." },
      pageSize: { type: "integer", minimum: 1, maximum: QUESTION_STATUS_PAGE_MAX,
        description: "Maximum number of status records to return on this page." }
    } }, "question.status.list",
    (params: any) => ({ sessionId: currentRegistration!.session.sessionId, ...params }));
  registerQueryTool("list_postbox_owners", "List one { owners, nextCursor? } page of present or actionable owners in the caller's feature, with coarse presence and scoped queue counts.",
    { type: "object", additionalProperties: false, properties: {
      scope: {
        type: "string",
        enum: ["feature", "worktree", "repository"],
        description: "Defaults to the caller's current feature; broader scopes remain within its worktree or repository."
      },
      includeInactive: { type: "boolean", description: "Include offline historical owners with no active Questions or unread Answers." },
      cursor: { type: "string", description: "Opaque pagination cursor returned by a previous owner page." },
      pageSize: { type: "integer", minimum: 1, maximum: POSTBOX_OWNER_PAGE_MAX,
        description: "Maximum number of owners to return on this page." }
    } }, "owner.list",
    (params: any) => ({ sessionId: currentRegistration!.session.sessionId, ...params }));
  registerQueryTool("get_postbox_owner_status", "Get compact presence and queue counts for exact harness-neutral owners.",
    { type: "object", additionalProperties: false, required: ["owners"], properties: {
      owners: { type: "array", minItems: 1, maxItems: POSTBOX_EXPLICIT_ID_MAX, description: "Exact owner identities to inspect.", items: {
        ...ownerIdentityParameters,
        description: "One exact harness-neutral owner identity."
      } }
    } }, "owner.status.get");
  registerQueryTool("get_question_history", "Retrieve one bounded history page with optional nextCursor; compact events are default and full immutable snapshots are explicit.",
    { type: "object", additionalProperties: false, required: ["questionId"], properties: {
      questionId: { type: "string", description: "Question ID whose history should be retrieved." },
      view: {
        type: "string",
        enum: ["events", "full"],
        description: "Defaults to compact event-oriented history; use 'full' for immutable revision snapshots."
      },
      cursor: { type: "string", description: "Opaque pagination cursor returned by a previous history page." },
      pageSize: { type: "integer", minimum: 1, maximum: QUESTION_HISTORY_PAGE_MAX,
        description: "Maximum combined revision and event records to return on this page." }
    } }, "question.history.get");
  registerQueryTool("recover_question_answer", "Read a discovered offline owner's Answer without taking ownership; returns compact output by default.",
    { type: "object", additionalProperties: false, required: ["questionId"], properties: {
      questionId: { type: "string", description: "Question ID whose Answer should be recovered." },
      view: {
        type: "string",
        enum: ["compact", "full"],
        description: "Defaults to compact recovery output; use 'full' for the complete Question, Answer, and read metadata."
      }
    } }, "question.answer.recover",
    (params: any) => ({ sessionId: currentRegistration!.session.sessionId, ...params }));
  pi.registerTool?.(createWaitForPostboxTool(async (signal) => {
      if (!client || !currentRegistration) await ensureRegistrationForMutatingCaller(process.env, signal);
      if (!client || !currentRegistration) throw new Error(unavailableNote);
      // Expose explicit Postbox waiting independently to Herdr and other parent status systems.
      const release = semanticStateController?.beginAskPostboxWait("waiting_for_postbox");
      try { return await client.waitForPostbox(currentRegistration.session.sessionId, signal); }
      finally { release?.(); }
  }));

  const confirmUnresolvedPostboxWork = async (ctx: PiLikeContext) => {
    if (!client || !currentRegistration?.session.owner || !ctx.hasUI || !ctx.ui?.confirm) return;
    return createPostboxNavigationGuard({ owner: currentRegistration.session.owner,
      query: (type, payload) => client!.query(type, payload), confirm: ctx.ui.confirm })();
  };
  pi.on("session_before_switch", (_event, ctx) => confirmUnresolvedPostboxWork(ctx));
  pi.on("session_before_fork", (_event, ctx) => confirmUnresolvedPostboxWork(ctx));

  pi.on("session_start", (_event, ctx) => {
    activeUiScope?.deactivate();
    stopProfileSupervisor();
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
    stopProfileSupervisor();
    activeUiScope = undefined;
    activeSessionRegistrationContext = undefined;
    answerAutoWakeCoordinator?.stop();
    answerAutoWakeCoordinator = undefined;
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
  return collectPostboxStatusSnapshot({ client, env, unavailableNote });
}

export async function startRegistration(
  pi: PiLikeApi,
  ctx: PiLikeContext,
  env: NodeJS.ProcessEnv = process.env,
  uiScope: SessionUiScope = createSessionUiScope(ctx),
  fallbackSessionIdentity?: string,
  options: StartRegistrationOptions = {}
): Promise<void> {
  stopProfileSupervisor();
  const targetResult = await resolveServerTarget({
    ...options.resolveOptions,
    cwd: options.resolveOptions?.cwd ?? ctx.cwd,
    env
  });
  if (!uiScope.isActive()) return;
  if (targetResult.status === "unavailable") {
    unavailableNote = formatUnavailableNote(targetResult);
    uiScope.setStatus("postbox", "Postbox unavailable");
    startNoClientProfileSupervisor(pi, ctx, env, uiScope, fallbackSessionIdentity, options);
    return;
  }

  await registerResolvedTarget(pi, ctx, env, uiScope, fallbackSessionIdentity, targetResult.profile, targetResult.target, options);
}

async function registerResolvedTarget(
  pi: PiLikeApi,
  ctx: PiLikeContext,
  env: NodeJS.ProcessEnv,
  uiScope: SessionUiScope,
  fallbackSessionIdentity: string | undefined,
  profile: ResolvedServerProfile,
  target: ResolvedServerTarget,
  options: StartRegistrationOptions
): Promise<void> {
  unavailableNote = "Pi Postbox is not connected.";
  let registrationAutoWakeCoordinator: AnswerAutoWakeCoordinator | undefined;

  try {
    const [registration, extensionConfig] = await Promise.all([
      collectRegistrationPayload(pi, ctx, env, fallbackSessionIdentity, profile),
      readExtensionConfig(env, profile)
    ]);
    if (!uiScope.isActive()) return;
    currentRegistration = registration;
    answerAutoWakeCoordinator?.stop();
    client?.stop();
    registrationAutoWakeCoordinator = new AnswerAutoWakeCoordinator({
      pi,
      sessionManager: ctx.sessionManager,
      enabled: resolveAnswerAutoWakeEnabled(env, extensionConfig.autoWake)
    });
    answerAutoWakeCoordinator = registrationAutoWakeCoordinator;
    let footerRenderVersion = 0;
    let postboxClient!: PostboxClient;
    const renderFooter = () => {
      const renderVersion = ++footerRenderVersion;
      void renderPostboxFooter(uiScope, postboxClient, target.url, () => renderVersion === footerRenderVersion);
    };
    postboxClient = new PostboxClient({
      serverUrl: target.url,
      targetSource: target.source,
      targetProfile: target.profile,
      targetIdentity: {
        version: target.version,
        protocolVersion: target.protocolVersion,
        instanceId: target.instanceId,
        buildId: target.buildId
      },
      registration,
      ...(target.profilePollingEnabled
        ? {
            resolveTarget: createSessionStickyProfileResolver(env, ctx.cwd, options, target),
            profilePollingEnabled: true
          }
        : {}),
      onStatus: renderFooter,
      onLocalFallbackStatus: renderFooter,
      onOwnerQuestionStateChanged: renderFooter,
      onAnswerAvailable: (notification, deliveryId) => {
        // Stable widget identity makes at-least-once transport replay owner-visible exactly once.
        uiScope.setWidget(answerNotificationWidgetKey(deliveryId), [
          `Postbox answer ready for “${notification.question}” (${notification.questionId}). Use get_answer.`
        ]);
        registrationAutoWakeCoordinator?.notify(notification, deliveryId);
      },
      answerNotificationInbox: new FileAnswerNotificationInbox(env, undefined, profile),
      questionChats
    });
    client = postboxClient;
    postboxClient.start();
    registrationAutoWakeCoordinator.recover();
    renderFooter();
    notifyRegistrationWaiters();
  } catch (error) {
    registrationAutoWakeCoordinator?.stop();
    if (answerAutoWakeCoordinator === registrationAutoWakeCoordinator) answerAutoWakeCoordinator = undefined;
    if (!uiScope.isActive()) return;
    const message = error instanceof Error ? error.message : String(error);
    uiScope.notify(`Pi Postbox registration skipped: ${message}`, "warn");
    uiScope.setStatus("postbox", "Postbox registration skipped");
  }
}

function startNoClientProfileSupervisor(
  pi: PiLikeApi,
  ctx: PiLikeContext,
  env: NodeJS.ProcessEnv,
  uiScope: SessionUiScope,
  fallbackSessionIdentity: string | undefined,
  options: StartRegistrationOptions
): void {
  if (profileSupervisor || client) return;

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let nextDelayMs = options.supervisor?.initialDelayMs ?? DEFAULT_SUPERVISOR_INITIAL_DELAY_MS;
  const maxDelayMs = options.supervisor?.maxDelayMs ?? DEFAULT_SUPERVISOR_MAX_DELAY_MS;

  const stop = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (profileSupervisor?.stop === stop) {
      profileSupervisor = undefined;
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

    const targetResult = await resolveServerTarget({
      ...options.resolveOptions,
      cwd: options.resolveOptions?.cwd ?? ctx.cwd,
      ttlMs: options.resolveOptions?.ttlMs ?? AUTOSTART_RECOVERY_METADATA_TTL_MS,
      env
    });
    if (stopped || !uiScope.isActive() || client) {
      stop();
      return;
    }

    if (targetResult.status === "unavailable") {
      unavailableNote = formatUnavailableNote(targetResult);
      uiScope.setStatus("postbox", "Postbox unavailable");
      const delayMs = nextDelayMs;
      nextDelayMs = Math.min(nextDelayMs * 2, maxDelayMs);
      schedule(delayMs);
      return;
    }

    stop();
    await registerResolvedTarget(
      pi,
      ctx,
      env,
      uiScope,
      fallbackSessionIdentity,
      targetResult.profile,
      targetResult.target,
      options
    );
  };

  profileSupervisor = { stop };
  schedule(nextDelayMs);
}

function stopProfileSupervisor(): void {
  profileSupervisor?.stop();
  profileSupervisor = undefined;
}

function createSessionStickyProfileResolver(
  env: NodeJS.ProcessEnv,
  cwd: string | undefined,
  options: StartRegistrationOptions,
  originalTarget: ResolvedServerTarget
): () => Promise<ResolveServerTargetResult> {
  return async () => {
    const result = await resolveServerTarget({
      ...options.resolveOptions,
      cwd: options.resolveOptions?.cwd ?? cwd,
      env,
      skipConfiguredUrl: true
    });
    if (result.status !== "selected") return result;
    if (isSameSessionStickyLocalTarget(originalTarget, result.target)) return result;

    return {
      status: "unavailable",
      profile: result.profile,
      diagnostics: [
        ...result.diagnostics,
        {
          code: "session-sticky-target-mismatch",
          source: result.target.source
        }
      ]
    };
  };
}

function isSameSessionStickyLocalTarget(original: ResolvedServerTarget, next: ResolvedServerTarget): boolean {
  if (next.source !== original.source || next.url !== original.url) return false;
  if (original.source === "profile-metadata") {
    // Pin the session to its profile and endpoint, not to one server process. A clean
    // restart at the same URL must refresh the connected instance/build identity.
    return next.profile.kind === original.profile.kind
      && next.profile.id === original.profile.id;
  }
  return true;
}

interface MutatingRegistrationRetryResult {
  targetWasAvailable: boolean;
  autostartAllowed: boolean;
}

async function retryRegistrationForMutatingCaller(env: NodeJS.ProcessEnv): Promise<MutatingRegistrationRetryResult> {
  const context = activeSessionRegistrationContext;
  if (!context || !context.uiScope.isActive()) return { targetWasAvailable: false, autostartAllowed: true };

  const targetResult = await resolveServerTarget({
    ...context.options.resolveOptions,
    cwd: context.options.resolveOptions?.cwd ?? context.ctx.cwd,
    env
  });
  if (!context.uiScope.isActive()) return { targetWasAvailable: false, autostartAllowed: true };
  if (client && (await isCurrentClientConnected())) return { targetWasAvailable: true, autostartAllowed: true };
  if (client) {
    if (clientHasPendingAsks(client)) return { targetWasAvailable: true, autostartAllowed: true };
    client.stop();
    client = undefined;
    currentRegistration = undefined;
  }

  if (targetResult.status === "unavailable") {
    unavailableNote = formatUnavailableNote(targetResult);
    context.uiScope.setStatus("postbox", "Postbox unavailable");
    return {
      targetWasAvailable: false,
      autostartAllowed: targetResult.recovery !== "restart-required"
    };
  }

  stopProfileSupervisor();
  await registerResolvedTarget(
    context.pi,
    context.ctx,
    env,
    context.uiScope,
    context.fallbackSessionIdentity,
    targetResult.profile,
    targetResult.target,
    context.options
  );
  return { targetWasAvailable: true, autostartAllowed: true };
}

async function ensureRegistrationForMutatingCaller(env: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<void> {
  const retryResult = await retryRegistrationForMutatingCaller(env);
  if (client && currentRegistration && (await isCurrentClientConnected())) return;
  if (retryResult.targetWasAvailable && client && currentRegistration) return;
  if (!retryResult.autostartAllowed) return;

  let asyncAutostartFailure: string | undefined;
  const autostartResult = ensurePostboxServerAutostarted(env, {
    profile: resolveServerProfile({ env, cwd: activeSessionRegistrationContext?.ctx.cwd }),
    onFailure: (diagnostic) => {
      asyncAutostartFailure = diagnostic;
    }
  });
  if (autostartResult.status === "disabled" || autostartResult.status === "failed") {
    unavailableNote = `${unavailableNote} ${autostartResult.diagnostic}`;
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
  if (signal?.aborted) return Promise.reject(new Error("write_question was aborted"));

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
      if (kind === "reject") reject(error ?? new Error("write_question was aborted"));
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
    const onAbort = () => settle("reject", new Error("write_question was aborted"));

    registrationWaiters.add(onRegistered);
    signal?.addEventListener("abort", onAbort, { once: true });
    pollTimer = setInterval(() => {
      void pollForRegistration();
    }, 100);
    pollTimer.unref?.();
    timeout = setTimeout(() => {
      const failureDiagnostic = getAsyncAutostartFailure() ?? getPostboxAutostartFailureDiagnostic(env);
      unavailableNote = failureDiagnostic
        ? `Pi Postbox autostart failed before healthy profile metadata was available. ${failureDiagnostic}`
        : `Pi Postbox autostart timed out after ${timeoutMs}ms waiting for healthy profile metadata. ${autostartDiagnostic}`;
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
  fallbackSessionIdentity?: string,
  profile: ResolvedServerProfile = resolveServerProfile({ env, cwd: ctx.cwd })
): Promise<SessionRegisterPayload> {
  const cwd = ctx.cwd ?? process.cwd();
  const project = collectProjectMetadata(cwd);
  const session = collectSessionMetadata(pi, ctx, project.branch, project.worktreePath, fallbackSessionIdentity);
  const machine = await getMachineIdentity(env, profile);
  return { machine, project, session };
}

function formatUnavailableNote(result: Extract<ResolveServerTargetResult, { status: "unavailable" }>): string {
  if (result.recovery === "restart-required") {
    return "A full Pi restart is required because /reload retained an incompatible shared Postbox protocol dependency. Package-local autostart was suppressed to avoid competing for the exact live profile server.";
  }
  const codes = [...new Set(result.diagnostics.map((diagnostic) => diagnostic.code))];
  if (codes.length === 0) return "Pi Postbox is not connected.";
  return `Pi Postbox is unavailable after profile target resolution (${codes.join(", ")}).`;
}

function answerNotificationWidgetKey(answerId: string): string {
  return `postbox-answer-${answerId}`;
}

function createSessionUiScope(ctx: PiLikeContext): SessionUiScope {
  let active = true;
  return {
    isActive: () => active,
    deactivate: () => {
      active = false;
      stopProfileSupervisor();
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

async function renderPostboxFooter(
  uiScope: SessionUiScope,
  postboxClient: PostboxClient,
  fallbackUrl: string,
  isLatest: () => boolean
): Promise<void> {
  let displayUrl = fallbackUrl;
  let openQuestionCount = postboxClient.listPendingAsks().length;
  try {
    const snapshot = await postboxClient.getStatusSnapshot();
    displayUrl = snapshot.connection.tailnetUrl
      ?? snapshot.connection.localUrl
      ?? snapshot.connection.activeUrl
      ?? fallbackUrl;
    openQuestionCount = Math.max(openQuestionCount, snapshot.openQuestionCount);
  } catch {
    // The known target and pending asks still make a useful footer if diagnostics fail.
  }
  if (!isLatest()) return;

  const questionLabel = openQuestionCount === 1 ? "question" : "questions";
  uiScope.setStatus("postbox", `Postbox ${displayUrl} · ${openQuestionCount} open ${questionLabel}`);
  uiScope.setStatus("postbox-ask", "");
  uiScope.setWidget("postbox-ask", []);
}
