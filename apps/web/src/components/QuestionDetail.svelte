<script lang="ts">
  import type { AskRequestSnapshot, QuestionChatAvailabilityError, SessionSnapshot } from "@pi-postbox/protocol";
  import { onMount } from "svelte";
  import { layout, type BrowserLayoutState, type QuestionWorkspaceTab } from "../lib/layout.svelte";
  import { createQuestionForm } from "../lib/questionForm.svelte";
  import type { QuestionChatApi } from "../lib/questionChatLifecycle.svelte";
  import QuestionChatActivation from "./QuestionChatActivation.svelte";
  import QuestionLayoutSpotlight from "./QuestionLayoutSpotlight.svelte";

  let {
    request,
    session,
    isMock = false,
    layoutState = layout,
    matchMedia = (query: string) => window.matchMedia(query),
    chatApi = {}
  }: {
    request: AskRequestSnapshot;
    session?: SessionSnapshot;
    isMock?: boolean;
    layoutState?: BrowserLayoutState;
    matchMedia?: (query: string) => MediaQueryList;
    chatApi?: Partial<QuestionChatApi>;
  } = $props();

  // One form instance per question — survives layout switches so selections and
  // the in-progress note are not lost when comparing variations. The real request
  // is remounted via {#key} on requestId, and the mock request is stable, so
  // capturing the initial props here is intentional.
  // svelte-ignore state_referenced_locally
  const form = createQuestionForm(request, isMock);

  $effect(() => {
    form.updateRequest(request);
  });

  let mobile = $state(false);
  let chatStarting = $state(false);
  let activationRequest = $state(0);
  let contextActivationRequest = $state(0);
  let activationError = $state<QuestionChatAvailabilityError | undefined>();
  let confirmingContextChat = $state(false);
  let recoveryPanelVisible = $state(false);
  const presentation = $derived(layoutState.questionChat(request.requestId));
  const questionPresented = $derived(
    !mobile || (!chatStarting && !recoveryPanelVisible && (!presentation.started || presentation.mobileTab === "question"))
  );
  const chatPresented = $derived(
    (!mobile && (chatStarting || recoveryPanelVisible || (presentation.started && presentation.visible))) ||
      (mobile && (chatStarting || recoveryPanelVisible || (presentation.started && presentation.mobileTab === "chat")))
  );
  const chatButtonLabel = $derived.by<"Chat" | undefined>(() => {
    if (chatStarting || recoveryPanelVisible || (mobile && presentation.started) || (!mobile && presentation.started && presentation.visible)) {
      return undefined;
    }
    return "Chat";
  });

  onMount(() => {
    const query = matchMedia("(max-width: 767px)");
    mobile = query.matches;
    const update = (event: MediaQueryListEvent): void => {
      mobile = event.matches;
    };
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  });

  function openChat(): void {
    if (presentation.started) {
      layoutState.showQuestionChat(request.requestId);
      return;
    }
    activationError = undefined;
    confirmingContextChat = false;
    chatStarting = true;
    activationRequest += 1;
  }

  function chatStarted(): void {
    chatStarting = false;
    recoveryPanelVisible = false;
    activationError = undefined;
    confirmingContextChat = false;
    layoutState.markQuestionChatStarted(request.requestId);
  }

  function chatRecoveryUnavailable(): void {
    chatStarting = false;
    recoveryPanelVisible = true;
  }

  function chatRecoveryNotStarted(): void {
    recoveryPanelVisible = false;
  }

  function chatActivationFailed(error: QuestionChatAvailabilityError): void {
    chatStarting = false;
    activationError = error;
  }

  function confirmContextChat(): void {
    confirmingContextChat = false;
    activationError = undefined;
    chatStarting = true;
    contextActivationRequest += 1;
  }

  function onWorkspaceKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && confirmingContextChat) confirmingContextChat = false;
  }

  function contextUnavailableMessage(error: QuestionChatAvailabilityError): string | undefined {
    if (error.contextFallback?.status !== "unavailable") return undefined;
    if (error.contextFallback.reason === "missing_codebase_context") {
      return "The context-only interviewer is unavailable because this legacy Postbox Question has no persisted codebase context.";
    }
    if (error.contextFallback.reason === "missing_problem_context") {
      return "The context-only interviewer is unavailable because this legacy Postbox Question has no persisted problem context.";
    }
    return "The context-only interviewer is unavailable because this legacy Postbox Question has no persisted codebase or problem context.";
  }

  function selectTab(tab: QuestionWorkspaceTab): void {
    layoutState.selectQuestionWorkspaceTab(request.requestId, tab);
  }

  function onTabKeydown(event: KeyboardEvent): void {
    let tab: QuestionWorkspaceTab | undefined;
    const current = event.currentTarget instanceof HTMLElement && event.currentTarget.id === "question-workspace-tab"
      ? "question"
      : "chat";
    if (event.key === "ArrowLeft") tab = current === "question" ? "chat" : "question";
    if (event.key === "ArrowRight") tab = current === "chat" ? "question" : "chat";
    if (event.key === "Home") tab = "question";
    if (event.key === "End") tab = "chat";
    if (!tab) return;
    event.preventDefault();
    selectTab(tab);
    document.getElementById(tab === "question" ? "question-workspace-tab" : "chat-workspace-tab")?.focus();
  }
</script>

<svelte:window onkeydown={onWorkspaceKeydown} />

<div class="flex h-full min-h-0 flex-1 flex-col md:flex-row">
  <section
    id="question-workspace-panel"
    role={mobile && presentation.started ? "tabpanel" : "region"}
    aria-label={mobile && presentation.started ? undefined : "Question"}
    aria-labelledby={mobile && presentation.started ? "question-workspace-tab" : undefined}
    hidden={!questionPresented}
    class="min-h-0 min-w-0 flex-1 overflow-y-auto bg-postbox-canvas"
    class:pb-24={mobile && presentation.started}
  >
    {#if activationError && !chatStarting}
      <div class="mx-4 mt-4 rounded-lg border border-danger-border bg-danger/5 p-4 text-sm sm:mx-6" role="alert">
        <p class="font-medium text-danger-foreground">{activationError.message}</p>
        {#if contextUnavailableMessage(activationError)}
          <p class="mt-2 text-postbox-subtle">{contextUnavailableMessage(activationError)}</p>
        {/if}
        {#if activationError.contextFallback?.status === "available"}
          <button
            type="button"
            class="mt-3 rounded-full border border-warning-border px-3 py-1.5 font-medium text-warning-foreground"
            onclick={() => (confirmingContextChat = true)}
          >Start context-only interviewer</button>
        {/if}
      </div>
    {/if}
    {#if confirmingContextChat}
      <div
        class="mx-4 mt-4 rounded-lg border border-warning-border bg-warning/5 p-4 sm:mx-6"
        role="group"
        aria-labelledby="context-chat-confirmation-title"
      >
        <h2 id="context-chat-confirmation-title" class="font-display font-semibold text-postbox-text">Start context-only interviewer?</h2>
        <p class="mt-2 text-sm text-postbox-subtle">This starts a fresh private interviewer session from persisted handoff context. It is not an exact fork of the originating Pi Session.</p>
        <div class="mt-3 flex flex-wrap gap-2">
          <button type="button" class="rounded-full border border-warning/40 bg-warning/10 px-3 py-1.5 text-sm font-medium text-warning-foreground" onclick={confirmContextChat}>Confirm context-only interviewer</button>
          <button type="button" class="rounded-full border border-postbox-border px-3 py-1.5 text-sm text-postbox-subtle" onclick={() => (confirmingContextChat = false)}>Cancel context-only interviewer</button>
        </div>
      </div>
    {/if}
    <QuestionLayoutSpotlight
      {request}
      {session}
      {form}
      {chatButtonLabel}
      onChat={openChat}
    />
  </section>

  <aside
    id="chat-workspace-panel"
    role={mobile && presentation.started ? "tabpanel" : "complementary"}
    aria-label={mobile && presentation.started ? undefined : "Question Chat sidebar"}
    aria-labelledby={mobile && presentation.started ? "chat-workspace-tab" : undefined}
    hidden={!chatPresented}
    class="flex min-h-0 w-full shrink-0 flex-col overflow-hidden border-t border-postbox-border bg-postbox-surface px-3 pb-24 md:w-[clamp(20rem,30vw,28rem)] md:border-l md:border-t-0 md:pb-3"
  >
    {#if !mobile && presentation.started}
      <div class="z-10 flex shrink-0 justify-end bg-postbox-surface py-2">
        <button type="button" class="rounded-full border border-postbox-border px-2.5 py-1 text-xs text-postbox-subtle" onclick={() => layoutState.hideQuestionChat(request.requestId)}>Hide Question Chat</button>
      </div>
    {/if}
    <QuestionChatActivation
      requestId={request.requestId}
      api={chatApi}
      showActivationButton={false}
      {activationRequest}
      {contextActivationRequest}
      recoveryRequest={1}
      onStarted={chatStarted}
      onActivationFailed={chatActivationFailed}
      onRecoveryUnavailable={chatRecoveryUnavailable}
      onRecoveryNotStarted={chatRecoveryNotStarted}
      showQuestionActions={mobile}
      onShowQuestion={() => selectTab("question")}
    />
  </aside>

  {#if mobile && presentation.started}
    <div class="fixed inset-x-0 bottom-0 z-30 grid grid-cols-2 border-t border-postbox-border bg-postbox-surface p-2 shadow-postbox-panel" style="padding-bottom: max(0.5rem, env(safe-area-inset-bottom));" role="tablist" aria-label="Question workspace">
      <button
        id="question-workspace-tab"
        type="button"
        role="tab"
        aria-selected={presentation.mobileTab === "question"}
        aria-controls="question-workspace-panel"
        tabindex={presentation.mobileTab === "question" ? 0 : -1}
        class="rounded-lg px-4 py-3 text-sm font-medium {presentation.mobileTab === 'question' ? 'bg-attention/10 text-attention-foreground' : 'text-postbox-muted'}"
        onclick={() => selectTab("question")}
        onkeydown={onTabKeydown}
      >Question</button>
      <button
        id="chat-workspace-tab"
        type="button"
        role="tab"
        aria-selected={presentation.mobileTab === "chat"}
        aria-controls="chat-workspace-panel"
        tabindex={presentation.mobileTab === "chat" ? 0 : -1}
        class="rounded-lg px-4 py-3 text-sm font-medium {presentation.mobileTab === 'chat' ? 'bg-attention/10 text-attention-foreground' : 'text-postbox-muted'}"
        onclick={() => selectTab("chat")}
        onkeydown={onTabKeydown}
      >Question Chat</button>
    </div>
  {/if}
</div>
