<script lang="ts">
  import { layout } from "../lib/layout.svelte";
  import { mockRequest, mockSession } from "../lib/mock";
  import { store } from "../lib/store.svelte";
  import EmptyMain from "./EmptyMain.svelte";
  import HistoryView from "./HistoryView.svelte";
  import OpenQuestionsQueue from "./OpenQuestionsQueue.svelte";
  import QuestionDetail from "./QuestionDetail.svelte";
  import SessionDetail from "./SessionDetail.svelte";

  const selection = $derived(store.selection);
  const realRequest = $derived(selection.kind === "request" ? store.selectedRequest : undefined);
  // Mock takes over only when there is no real question to answer.
  const showMock = $derived(layout.mockQuestion && !realRequest);
</script>

<main class="min-h-0 flex-1 overflow-y-auto bg-postbox-canvas">
  {#if showMock}
    <QuestionDetail request={mockRequest} session={mockSession} isMock />
  {:else if selection.kind === "request"}
    {#if store.selectedRequest}
      {#key store.selectedRequest.requestId}
        <QuestionDetail request={store.selectedRequest} session={store.selectedSession} />
      {/key}
    {:else}
      <EmptyMain title="Question resolved" message="This request was answered, cancelled, or expired." />
    {/if}
  {:else if selection.kind === "session"}
    {#if store.selectedSession}
      <SessionDetail session={store.selectedSession} />
    {:else}
      <EmptyMain title="Session ended" message="This Pi session is no longer registered." />
    {/if}
  {:else if selection.kind === "project"}
    <OpenQuestionsQueue projectId={selection.projectId} />
  {:else if selection.kind === "history"}
    <HistoryView />
  {:else}
    <OpenQuestionsQueue />
  {/if}
</main>
