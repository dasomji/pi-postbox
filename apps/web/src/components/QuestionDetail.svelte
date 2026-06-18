<script lang="ts">
  import type { AskRequestSnapshot, SessionSnapshot } from "@pi-postbox/protocol";
  import { createQuestionForm } from "../lib/questionForm.svelte";
  import QuestionLayoutSpotlight from "./QuestionLayoutSpotlight.svelte";

  let {
    request,
    session,
    isMock = false
  }: { request: AskRequestSnapshot; session?: SessionSnapshot; isMock?: boolean } = $props();

  // One form instance per question — survives layout switches so selections and
  // the in-progress note are not lost when comparing variations. The real request
  // is remounted via {#key} on requestId, and the mock request is stable, so
  // capturing the initial props here is intentional.
  // svelte-ignore state_referenced_locally
  const form = createQuestionForm(request, isMock);
</script>

<QuestionLayoutSpotlight {request} {session} {form} />
