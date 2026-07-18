<script lang="ts">
  import {
    QUESTION_CHAT_STARTERS,
    type QuestionChatEvent,
    type QuestionChatSnapshot
  } from "@pi-postbox/protocol";
  import { onDestroy } from "svelte";
  import {
    activateQuestionChat,
    activateContextQuestionChat,
    connectQuestionChatEvents,
    fetchQuestionChatSnapshot,
    probeQuestionChatSnapshot,
    sendQuestionChatMessage,
    stopQuestionChat
  } from "../api/postboxApi";
  import { renderSafeMarkdown } from "../lib/questionChat";
  import { QuestionChatLifecycle, type QuestionChatApi } from "../lib/questionChatLifecycle.svelte";

  let {
    requestId,
    api = {},
    showActivationButton = true,
    activationRequest = 0,
    contextActivationRequest = 0,
    recoveryRequest = 0,
    onStarted,
    onActivationFailed,
    onRecoveryUnavailable,
    onRecoveryNotStarted
  }: {
    requestId: string;
    api?: Partial<QuestionChatApi>;
    showActivationButton?: boolean;
    activationRequest?: number;
    recoveryRequest?: number;
    onStarted?: () => void;
    contextActivationRequest?: number;
    onActivationFailed?: (error: import("@pi-postbox/protocol").QuestionChatAvailabilityError) => void;
    onRecoveryUnavailable?: (error: import("@pi-postbox/protocol").QuestionChatAvailabilityError) => void;
    onRecoveryNotStarted?: () => void;
  } = $props();

  // API dependencies are stable for one keyed Chat component instance.
  // svelte-ignore state_referenced_locally
  const chatApi: QuestionChatApi = {
    activate: api.activate ?? activateQuestionChat,
    activateContext: api.activateContext ?? activateContextQuestionChat,
    fetchSnapshot: api.fetchSnapshot ?? fetchQuestionChatSnapshot,
    probeSnapshot: api.probeSnapshot ?? probeQuestionChatSnapshot,
    sendMessage: api.sendMessage ?? sendQuestionChatMessage,
    stop: api.stop ?? stopQuestionChat,
    connectEvents: api.connectEvents ?? connectQuestionChatEvents
  };
  const lifecycle = new QuestionChatLifecycle(chatApi, {});
  const view = $derived(lifecycle.view);
  let composer = $state("");
  let sending = $state(false);
  let stopping = $state(false);
  let actionMessage = $state("");
  let commandCounter = 0;
  let observedActivationRequest = 0;
  let observedContextActivationRequest = 0;
  let observedRecoveryRequest = 0;

  $effect(() => {
    lifecycle.selectRequest(requestId);
    composer = "";
    sending = false;
    stopping = false;
    actionMessage = "";
    observedActivationRequest = 0;
    observedContextActivationRequest = 0;
    observedRecoveryRequest = 0;
  });

  $effect(() => {
    lifecycle.setCallbacks({
      started: onStarted,
      activationFailed: onActivationFailed,
      recoveryUnavailable: onRecoveryUnavailable,
      recoveryNotStarted: onRecoveryNotStarted,
      event: handleLifecycleEvent
    });
  });

  $effect(() => {
    if (contextActivationRequest <= observedContextActivationRequest) return;
    observedContextActivationRequest = contextActivationRequest;
    void lifecycle.startContext();
  });

  $effect(() => {
    if (activationRequest <= observedActivationRequest) return;
    observedActivationRequest = activationRequest;
    void lifecycle.start();
  });

  $effect(() => {
    if (recoveryRequest <= observedRecoveryRequest) return;
    observedRecoveryRequest = recoveryRequest;
    void lifecycle.recover();
  });

  function handleLifecycleEvent(event: QuestionChatEvent): void {
    if (event.type === "lifecycle" && (event.state === "stopped" || event.state === "interrupted" || event.state === "ready")) {
      if (stopping) {
        actionMessage = event.state === "stopped" ? "Response stopped" : event.state === "interrupted" ? "Response interrupted" : "Ready";
      }
      stopping = false;
    }
  }

  async function send(text: string): Promise<void> {
    const message = text.trim();
    if (!message || view.kind !== "ready" || view.connection !== "online" || view.snapshot.state === "stopping" || stopping || sending) return;
    const clientCommandId = `browser-${Date.now().toString(36)}-${(++commandCounter).toString(36)}`;
    lifecycle.applyEvent({
      requestId,
      sequence: view.snapshot.sequence + 1,
      type: "message.started",
      message: { id: clientCommandId, role: "user", text: message, status: "final" }
    });
    composer = "";
    sending = true;
    try {
      const response = await chatApi.sendMessage(requestId, { clientCommandId, message });
      actionMessage = response.mode === "steer" ? "Steering accepted" : "Message sent";
    } catch (error) {
      actionMessage = error instanceof Error ? error.message : "Question Chat send failed.";
    } finally {
      sending = false;
    }
  }

  async function stopActive(): Promise<void> {
    if (view.kind !== "ready" || view.connection !== "online" || view.snapshot.state !== "generating" || stopping) return;
    const clientCommandId = `browser-stop-${Date.now().toString(36)}-${(++commandCounter).toString(36)}`;
    stopping = true;
    actionMessage = "Stopping…";
    try {
      await chatApi.stop(requestId, { clientCommandId });
    } catch (error) {
      stopping = false;
      actionMessage = error instanceof Error ? error.message : "Question Chat stop failed.";
    }
  }

  function stateLabel(snapshot: QuestionChatSnapshot): string {
    if (stopping || snapshot.state === "stopping") return "Stopping…";
    if (snapshot.state === "generating") return "Answering…";
    if (snapshot.state === "stopped") return "Stopped";
    if (snapshot.state === "interrupted") return "Interrupted";
    return "Ready";
  }

  onDestroy(() => lifecycle.destroy());
</script>

{#if view.kind === "not-started" && showActivationButton}
  <button type="button" class="rounded-full border border-history-border bg-history/5 px-3 py-1 font-medium text-history-foreground transition hover:bg-history/10" onclick={() => lifecycle.start()}>Chat</button>
{:else if view.kind !== "not-started"}
  <section class="mt-5 rounded-lg border border-history-border bg-postbox-elevated p-4 shadow-postbox-section" aria-label="Question Chat">
    {#if view.kind === "starting"}
      <p class="text-sm text-postbox-muted" role="status">Starting Question Chat…</p>
    {:else if view.kind === "unavailable"}
      <h2 class="font-display text-base font-semibold text-postbox-text">Chat unavailable</h2>
      <p class="mt-2 text-sm text-danger-foreground" role="alert">{view.error.message}</p>
      <button type="button" class="mt-3 rounded-full border border-postbox-border px-3 py-1 text-sm text-postbox-subtle" onclick={() => lifecycle.retry()}>Retry</button>
    {:else}
      <div class="flex items-start justify-between gap-3">
        <div>
          <h2 class="font-display text-base font-semibold text-postbox-text">Question Chat</h2>
          {#if view.snapshot.forkKind === "context-only"}
            <span class="mt-1 inline-flex rounded-full bg-warning/10 px-2.5 py-1 text-xs font-medium text-warning-foreground">Context-only · degraded</span>
          {/if}
        </div>
        <div class="flex items-center gap-2">
          <span class="rounded-full bg-success/10 px-2.5 py-1 text-xs font-medium text-success-foreground">{stateLabel(view.snapshot)}</span>
        </div>
      </div>
      {#if view.snapshot.forkKind === "context-only"}
        <p class="mt-3 text-xs text-warning-foreground">This fresh private interviewer uses persisted handoff context, not the exact source conversation.</p>
      {/if}
      {#if view.connection !== "online"}
        <div class="mt-3 flex items-center justify-between gap-3 rounded-md border border-warning/30 bg-warning/10 p-2 text-sm text-warning-foreground" role="status">
          <span>{view.connection === "offline" ? "Chat offline · showing saved messages" : "Chat stale · resynchronizing"}</span>
          <button type="button" class="rounded-full border border-warning/40 px-3 py-1 font-medium" onclick={() => lifecycle.retry()}>Retry</button>
        </div>
      {/if}
      <div class="mt-4 min-h-16 space-y-3 rounded-md border border-postbox-border p-3" aria-label="Chat messages" aria-live="polite">
        {#if view.snapshot.messages.length === 0}
          <p class="text-sm text-postbox-muted">Ask what you need to understand this decision.</p>
        {:else}
          {#each view.snapshot.messages as message (message.id)}
            <article class={message.role === "user" ? "ml-8 rounded-lg bg-attention/10 p-3 text-sm text-postbox-text" : "mr-4 rounded-lg bg-postbox-surface p-3 text-sm text-postbox-subtle"}>
              {#if message.role === "user"}
                <p class="whitespace-pre-wrap">{message.text}</p>
              {:else}
                <div class="chat-markdown">{@html renderSafeMarkdown(message.text)}</div>
                {#if message.status === "stopped"}<p class="mt-2 text-xs font-medium text-warning-foreground">Stopped</p>{/if}
                {#if message.status === "interrupted"}<p class="mt-2 text-xs font-medium text-danger-foreground">Interrupted</p>{/if}
              {/if}
            </article>
          {/each}
        {/if}
      </div>
      {#if view.snapshot.messages.length === 0}
        <div class="mt-3 flex flex-wrap gap-2" aria-label="Chat starters">
          {#each QUESTION_CHAT_STARTERS as starter}
            <button type="button" class="rounded-full border border-postbox-border px-3 py-1.5 text-sm text-postbox-subtle hover:border-attention-border disabled:opacity-50" disabled={view.connection !== "online"} onclick={() => send(starter.instruction)}>{starter.label}</button>
          {/each}
        </div>
      {/if}
      <form class="mt-3 flex gap-2" onsubmit={(event) => { event.preventDefault(); void send(composer); }}>
        <label class="sr-only" for="question-chat-composer">Message Question Chat</label>
        <textarea id="question-chat-composer" class="min-h-12 flex-1 resize-y rounded-lg border border-postbox-border bg-postbox-surface p-2 text-sm text-postbox-text" placeholder="Ask about this decision…" bind:value={composer} disabled={view.connection !== "online" || view.snapshot.state === "stopping" || stopping || sending}></textarea>
        <button type="submit" class="self-end rounded-full bg-attention px-4 py-2 text-sm font-medium text-attention-contrast disabled:opacity-50" disabled={view.connection !== "online" || !composer.trim() || view.snapshot.state === "stopping" || stopping || sending}>Send</button>
      </form>
      {#if view.snapshot.state === "generating"}
        <button type="button" class="mt-2 rounded-full border border-danger-border px-3 py-1.5 text-sm text-danger-foreground disabled:opacity-50" disabled={view.connection !== "online" || stopping} onclick={() => void stopActive()}>{stopping ? "Stopping…" : "Stop"}</button>
      {/if}
      {#if actionMessage}<p class="mt-2 text-xs text-postbox-muted" role="status">{actionMessage}</p>{/if}
      <p class="mt-3 text-xs text-postbox-muted">Model: <span class="font-medium text-postbox-subtle">{view.snapshot.model.id}</span>{#if view.snapshot.model.source === "pi-default"} · Pi default fallback{/if}</p>
      {#if view.snapshot.model.fallbackReason}<p class="mt-1 text-xs text-warning-foreground">{view.snapshot.model.fallbackReason}</p>{/if}
    {/if}
  </section>
{/if}
