<script lang="ts">
  import type { QuestionChatActivationResponse, QuestionChatSnapshot } from "@pi-postbox/protocol";
  import { activateQuestionChat } from "../api/postboxApi";

  let {
    requestId,
    activate = activateQuestionChat
  }: {
    requestId: string;
    activate?: (requestId: string) => Promise<QuestionChatActivationResponse>;
  } = $props();

  type ViewState =
    | { kind: "not-started" }
    | { kind: "starting" }
    | { kind: "ready"; snapshot: QuestionChatSnapshot }
    | { kind: "unavailable"; message: string };

  let view: ViewState = $state({ kind: "not-started" });
  let activeRequestId: string | undefined = $state();

  $effect(() => {
    if (requestId !== activeRequestId) {
      activeRequestId = requestId;
      view = { kind: "not-started" };
    }
  });

  async function start(): Promise<void> {
    if (view.kind === "starting" || view.kind === "ready") return;
    const startedRequestId = requestId;
    view = { kind: "starting" };
    try {
      const response = await activate(startedRequestId);
      if (requestId !== startedRequestId || activeRequestId !== startedRequestId) return;
      view =
        response.status === "ready"
          ? { kind: "ready", snapshot: response.snapshot }
          : { kind: "unavailable", message: response.error.message };
    } catch (error) {
      if (requestId !== startedRequestId || activeRequestId !== startedRequestId) return;
      view = {
        kind: "unavailable",
        message: error instanceof Error ? error.message : "Question Chat is unavailable."
      };
    }
  }
</script>

{#if view.kind === "not-started"}
  <button
    type="button"
    class="rounded-full border border-history-border bg-history/5 px-3 py-1 font-medium text-history-foreground transition hover:bg-history/10"
    onclick={start}
  >
    Chat
  </button>
{:else}
  <section class="mt-5 rounded-lg border border-history-border bg-postbox-elevated p-4 shadow-postbox-section" aria-label="Question Chat">
    {#if view.kind === "starting"}
      <p class="text-sm text-postbox-muted" role="status">Starting Question Chat…</p>
    {:else if view.kind === "unavailable"}
      <h2 class="font-display text-base font-semibold text-postbox-text">Chat unavailable</h2>
      <p class="mt-2 text-sm text-danger-foreground" role="alert">{view.message}</p>
      <button type="button" class="mt-3 rounded-full border border-postbox-border px-3 py-1 text-sm text-postbox-subtle" onclick={start}>
        Retry
      </button>
    {:else}
      <div class="flex items-start justify-between gap-3">
        <div>
          <h2 class="font-display text-base font-semibold text-postbox-text">Chat ready</h2>
          <p class="mt-1 text-sm text-postbox-muted">Empty private fork · no model response has been generated.</p>
        </div>
        <span class="rounded-full bg-success/10 px-2.5 py-1 text-xs font-medium text-success-foreground">Ready</span>
      </div>
      <div class="mt-4 min-h-16 rounded-md border border-dashed border-postbox-border p-3" aria-label="Chat messages">
        <p class="text-sm text-postbox-muted">No messages yet.</p>
      </div>
      <p class="mt-3 text-xs text-postbox-muted">
        Model: <span class="font-medium text-postbox-subtle">{view.snapshot.model.id}</span>
        {#if view.snapshot.model.source === "pi-default"} · Pi default fallback{/if}
      </p>
      {#if view.snapshot.model.fallbackReason}
        <p class="mt-1 text-xs text-warning-foreground">{view.snapshot.model.fallbackReason}</p>
      {/if}
    {/if}
  </section>
{/if}
