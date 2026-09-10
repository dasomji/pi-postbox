<script lang="ts">
  import { QuestionRevisionSnapshotSchema, PROTOCOL_VERSION, type QuestionRevisionSnapshot } from "@pi-postbox/protocol";
  import QuestionGallery from "./QuestionGallery.svelte";
  let { questionId }: { questionId: string } = $props();
  let revisions = $state<QuestionRevisionSnapshot[]>([]);
  let cursor = $state<string | undefined>();
  let opened = $state(false);
  let loading = $state(false);
  let error = $state(false);
  async function load() {
    loading = true; error = false;
    try {
      const response = await fetch(`/api/requests/${encodeURIComponent(questionId)}/history${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
      if (!response.ok) throw new Error();
      const page = await response.json();
      if (page.protocolVersion !== PROTOCOL_VERSION) throw new Error();
      const values = (page.revisions as unknown[]).map(value => QuestionRevisionSnapshotSchema.parse(value));
      revisions = [...revisions, ...values]; cursor = page.nextCursor; opened = true;
    } catch { error = true; }
    finally { loading = false; }
  }
</script>

<div class="mt-4">
  {#if !opened || cursor || error}<button type="button" class="underline" disabled={loading} onclick={load}>{loading ? "Loading revisions…" : error ? "Retry revisions" : opened ? "More revisions" : "Show immutable revisions"}</button>{/if}
  {#if error}<p role="status">Revision history is unavailable.</p>{/if}
  {#each revisions as revision (revision.revision)}
    <details class="mt-3 border rounded p-3">
      <summary>Revision {revision.revision}</summary>
      <p>{revision.question.prompt}</p>
      {#if revision.question.ambiguity}<p>{revision.question.ambiguity}</p>{/if}
      <QuestionGallery images={revision.images} />
      <ul>{#each revision.options as option}<li>{option.label}</li>{/each}</ul>
    </details>
  {/each}
</div>
