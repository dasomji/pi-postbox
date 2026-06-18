<script lang="ts">
  import type { HistoryRecord } from "@pi-postbox/protocol";
  import { formatTimestamp, selectedOptionLabels } from "../lib/format";
  import { historyTone } from "../lib/statusStyles";
  import MetadataRow from "./MetadataRow.svelte";
  import RichContext from "./RichContext.svelte";
  import StatusBadge from "./StatusBadge.svelte";

  let { record }: { record: HistoryRecord } = $props();

  const request = $derived(record.request);
  const session = $derived(record.session);
  const result = $derived(record.request.result);
  const selectedLabels = $derived(selectedOptionLabels(record.request));
</script>

<article class="rounded-2xl border border-history-border bg-postbox-canvas/80 p-5">
  <div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
    <div>
      <h3 class="text-lg font-semibold text-postbox-text">{request.question.prompt}</h3>
      <p class="mt-1 text-xs uppercase tracking-wide text-history-foreground/70">
        {session.project.projectName} · {session.project.branch ?? session.branch ?? "unknown branch"} · {session.machine.machineName}
      </p>
    </div>
    <StatusBadge tone={historyTone(request.status)}>{request.status}</StatusBadge>
  </div>

  <dl class="mt-4 grid gap-3 text-sm">
    {#if selectedLabels}<MetadataRow label="Answer" value={selectedLabels} />{/if}
    {#if result && "note" in result && result.note}<MetadataRow label="Note" value={result.note} />{/if}
    {#if result?.rationale}<MetadataRow label="Rationale" value={result.rationale} />{/if}
    <MetadataRow label="Created" value={formatTimestamp(request.createdAt)} />
    {#if request.resolvedAt}<MetadataRow label="Resolved" value={formatTimestamp(request.resolvedAt)} />{/if}
    <MetadataRow label="Session" value={session.title ?? session.sessionId} />
    <MetadataRow label="Repo" value={session.project.repoName ?? session.project.projectName} />
    <MetadataRow label="Worktree" value={session.project.worktreePath ?? session.worktreePath ?? "not reported"} />
  </dl>

  <RichContext {request} />
</article>
