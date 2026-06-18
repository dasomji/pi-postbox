<script lang="ts">
  import type { SessionSnapshot } from "@pi-postbox/protocol";
  import { abbreviatedHead, formatTimestamp, sessionTitle } from "../lib/format";
  import { dotLabel, sessionDot } from "../lib/status";
  import { presenceTone, semanticTone } from "../lib/statusStyles";
  import { store } from "../lib/store.svelte";
  import MetadataRow from "./MetadataRow.svelte";
  import ProjectIcon from "./ProjectIcon.svelte";
  import RenameInline from "./RenameInline.svelte";
  import StatusBadge from "./StatusBadge.svelte";
  import StatusDot from "./StatusDot.svelte";

  let { session }: { session: SessionSnapshot } = $props();

  const questions = $derived(store.openQuestionsFor(session.sessionId));
  const dot = $derived(sessionDot(session, questions.length > 0));
</script>

<article class="mx-auto max-w-3xl px-6 py-8">
  <div class="flex items-start justify-between gap-3">
    <div class="flex min-w-0 items-center gap-3">
      <ProjectIcon name={session.projectName} icon={session.projectIcon} />
      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <StatusDot color={dot} />
          <h1 class="break-words text-xl font-semibold text-postbox-text">{sessionTitle(session)}</h1>
        </div>
        <p class="mt-1 break-words text-sm text-postbox-muted">{session.projectName} · {dotLabel[dot]}</p>
      </div>
    </div>
    <div class="flex shrink-0 flex-col items-end gap-2">
      <StatusBadge tone={semanticTone(session.semanticState)}>
        {session.semanticState === "blocked" ? "waiting" : session.semanticState}
      </StatusBadge>
      <StatusBadge tone={presenceTone(session.presence)}>{session.presence}</StatusBadge>
    </div>
  </div>

  {#if questions.length > 0}
    <section class="mt-6">
      <h2 class="text-sm font-semibold uppercase tracking-wide text-attention-foreground">Open questions</h2>
      <ul class="mt-2 space-y-2">
        {#each questions as question (question.requestId)}
          <li>
            <button
              class="block w-full truncate rounded-xl border border-attention-border bg-attention/10 px-4 py-3 text-left text-sm text-attention-foreground transition hover:bg-attention/20"
              onclick={() => store.selectRequest(question.requestId)}
              title={question.question.prompt}
            >
              {question.question.prompt}
            </button>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <dl class="mt-6 grid gap-3 text-sm">
    <RenameInline label="Machine" value={session.machineName} endpoint={`/api/machines/${encodeURIComponent(session.machineId)}/rename`} />
    <RenameInline label="Project" value={session.projectName} endpoint={`/api/projects/${encodeURIComponent(session.projectId)}/rename`} />
    <MetadataRow label="Detected project" value={session.projectDetectedName ?? session.projectName} />
    <MetadataRow label="Repo" value={session.repoName ?? "unknown"} />
    <MetadataRow label="Branch" value={session.branch ?? "unknown"} />
    <MetadataRow label="Head" value={abbreviatedHead(session)} />
    <MetadataRow label="State" value={session.semanticState === "blocked" ? "blocked / waiting" : session.semanticState} />
    <MetadataRow label="CWD" value={session.cwd} />
    <MetadataRow label="Git root" value={session.gitRoot ?? "not reported"} />
    <MetadataRow label="Worktree" value={session.worktreePath ?? "not reported"} />
    {#if session.projectDescription}<MetadataRow label="Description" value={session.projectDescription} />{/if}
    <MetadataRow label="Last heartbeat" value={session.lastHeartbeatAt ? formatTimestamp(session.lastHeartbeatAt) : "not reported"} />
  </dl>
</article>
