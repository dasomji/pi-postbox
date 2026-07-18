<script lang="ts">
  import {
    QUESTION_CHAT_STARTERS,
    type QuestionChatActivationResponse,
    type QuestionChatEvent,
    type QuestionChatSendPayload,
    type QuestionChatSendResponse,
    type QuestionChatSnapshot
  } from "@pi-postbox/protocol";
  import {
    activateQuestionChat,
    connectQuestionChatEvents,
    fetchQuestionChatSnapshot,
    sendQuestionChatMessage,
    type QuestionChatEventConnection
  } from "../api/postboxApi";
  import { applyQuestionChatEvent, renderSafeMarkdown } from "../lib/questionChat";

  let {
    requestId,
    activate = activateQuestionChat,
    fetchSnapshot = fetchQuestionChatSnapshot,
    sendMessage = sendQuestionChatMessage,
    connectEvents = connectQuestionChatEvents
  }: {
    requestId: string;
    activate?: (requestId: string) => Promise<QuestionChatActivationResponse>;
    fetchSnapshot?: (requestId: string) => Promise<QuestionChatSnapshot>;
    sendMessage?: (requestId: string, command: QuestionChatSendPayload) => Promise<QuestionChatSendResponse>;
    connectEvents?: (requestId: string, onEvent: (event: QuestionChatEvent) => void) => QuestionChatEventConnection;
  } = $props();

  type ViewState =
    | { kind: "not-started" }
    | { kind: "starting" }
    | { kind: "ready"; snapshot: QuestionChatSnapshot }
    | { kind: "unavailable"; message: string };

  let view: ViewState = $state({ kind: "not-started" });
  let activeRequestId: string | undefined = $state();
  let composer = $state("");
  let sending = $state(false);
  let disconnectEvents: (() => void) | undefined;
  let commandCounter = 0;

  $effect(() => {
    if (requestId !== activeRequestId) {
      disconnectEvents?.();
      disconnectEvents = undefined;
      activeRequestId = requestId;
      composer = "";
      sending = false;
      view = { kind: "not-started" };
    }
    return () => disconnectEvents?.();
  });

  async function start(): Promise<void> {
    if (view.kind === "starting" || view.kind === "ready") return;
    const startedRequestId = requestId;
    view = { kind: "starting" };
    try {
      const response = await activate(startedRequestId);
      if (!isCurrent(startedRequestId)) return;
      if (response.status === "unavailable") {
        view = { kind: "unavailable", message: response.error.message };
        return;
      }
      view = { kind: "ready", snapshot: response.snapshot };
      await synchronize(startedRequestId);
    } catch (error) {
      if (!isCurrent(startedRequestId)) return;
      disconnectEvents?.();
      disconnectEvents = undefined;
      view = { kind: "unavailable", message: error instanceof Error ? error.message : "Question Chat is unavailable." };
    }
  }

  async function synchronize(startedRequestId: string): Promise<void> {
    const buffered: QuestionChatEvent[] = [];
    let synchronized = false;
    disconnectEvents?.();
    const connection = connectEvents(startedRequestId, (event) => {
      if (!synchronized) buffered.push(event);
      else reduceEvent(event);
    });
    disconnectEvents = connection.close;
    await connection.ready;
    if (!isCurrent(startedRequestId)) return;
    const snapshot = await fetchSnapshot(startedRequestId);
    if (!isCurrent(startedRequestId)) return;
    view = { kind: "ready", snapshot };
    for (const event of buffered.sort((left, right) => left.sequence - right.sequence)) reduceEvent(event);
    synchronized = true;
  }

  function reduceEvent(event: QuestionChatEvent): void {
    if (view.kind !== "ready") return;
    view = { kind: "ready", snapshot: applyQuestionChatEvent(view.snapshot, event) };
  }

  async function send(text: string): Promise<void> {
    const message = text.trim();
    if (!message || view.kind !== "ready" || view.snapshot.state === "generating" || sending) return;
    const clientCommandId = `browser-${Date.now().toString(36)}-${(++commandCounter).toString(36)}`;
    const optimistic = applyQuestionChatEvent(view.snapshot, {
      requestId,
      sequence: view.snapshot.sequence + 1,
      type: "message.started",
      message: { id: clientCommandId, role: "user", text: message, status: "final" }
    });
    view = { kind: "ready", snapshot: optimistic };
    composer = "";
    sending = true;
    try {
      await sendMessage(requestId, { clientCommandId, message });
    } catch (error) {
      view = { kind: "unavailable", message: error instanceof Error ? error.message : "Question Chat send failed." };
    } finally {
      sending = false;
    }
  }

  function isCurrent(value: string): boolean {
    return requestId === value && activeRequestId === value;
  }
</script>

{#if view.kind === "not-started"}
  <button type="button" class="rounded-full border border-history-border bg-history/5 px-3 py-1 font-medium text-history-foreground transition hover:bg-history/10" onclick={start}>Chat</button>
{:else}
  <section class="mt-5 rounded-lg border border-history-border bg-postbox-elevated p-4 shadow-postbox-section" aria-label="Question Chat">
    {#if view.kind === "starting"}
      <p class="text-sm text-postbox-muted" role="status">Starting Question Chat…</p>
    {:else if view.kind === "unavailable"}
      <h2 class="font-display text-base font-semibold text-postbox-text">Chat unavailable</h2>
      <p class="mt-2 text-sm text-danger-foreground" role="alert">{view.message}</p>
      <button type="button" class="mt-3 rounded-full border border-postbox-border px-3 py-1 text-sm text-postbox-subtle" onclick={start}>Retry</button>
    {:else}
      <div class="flex items-start justify-between gap-3">
        <h2 class="font-display text-base font-semibold text-postbox-text">Question Chat</h2>
        <span class="rounded-full bg-success/10 px-2.5 py-1 text-xs font-medium text-success-foreground">{view.snapshot.state === "generating" ? "Answering…" : "Ready"}</span>
      </div>
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
              {/if}
            </article>
          {/each}
        {/if}
      </div>
      {#if view.snapshot.messages.length === 0}
        <div class="mt-3 flex flex-wrap gap-2" aria-label="Chat starters">
          {#each QUESTION_CHAT_STARTERS as starter}
            <button type="button" class="rounded-full border border-postbox-border px-3 py-1.5 text-sm text-postbox-subtle hover:border-attention-border" onclick={() => send(starter.instruction)}>{starter.label}</button>
          {/each}
        </div>
      {/if}
      <form class="mt-3 flex gap-2" onsubmit={(event) => { event.preventDefault(); void send(composer); }}>
        <label class="sr-only" for="question-chat-composer">Message Question Chat</label>
        <textarea id="question-chat-composer" class="min-h-12 flex-1 resize-y rounded-lg border border-postbox-border bg-postbox-surface p-2 text-sm text-postbox-text" placeholder="Ask about this decision…" bind:value={composer} disabled={view.snapshot.state === "generating" || sending}></textarea>
        <button type="submit" class="self-end rounded-full bg-attention px-4 py-2 text-sm font-medium text-attention-contrast disabled:opacity-50" disabled={!composer.trim() || view.snapshot.state === "generating" || sending}>Send</button>
      </form>
      <p class="mt-3 text-xs text-postbox-muted">Model: <span class="font-medium text-postbox-subtle">{view.snapshot.model.id}</span>{#if view.snapshot.model.source === "pi-default"} · Pi default fallback{/if}</p>
      {#if view.snapshot.model.fallbackReason}<p class="mt-1 text-xs text-warning-foreground">{view.snapshot.model.fallbackReason}</p>{/if}
    {/if}
  </section>
{/if}
