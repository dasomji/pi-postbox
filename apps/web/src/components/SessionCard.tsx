import type { SessionSnapshot } from "@pi-postbox/protocol";
import { abbreviatedHead, formatTimestamp, sessionTitle } from "../lib/format";
import { presenceTone, semanticTone } from "../lib/statusStyles";
import { MetadataRow } from "./MetadataRow";
import { ProjectIcon } from "./ProjectIcon";
import { RenameInline } from "./RenameInline";
import { StatusBadge } from "./StatusBadge";

export function SessionCard({ session, onRenamed }: { session: SessionSnapshot; onRenamed: () => Promise<void> }) {
  const title = sessionTitle(session);

  return (
    <article className="rounded-2xl border border-postbox-border bg-postbox-canvas/70 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <ProjectIcon session={session} />
            <div className="min-w-0">
              <h3 className="break-words text-lg font-semibold text-postbox-text">{title}</h3>
              <p className="mt-1 break-words text-sm text-postbox-muted">{session.projectName}</p>
            </div>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <StatusBadge tone={semanticTone(session.semanticState)}>{session.semanticState === "blocked" ? "waiting" : session.semanticState}</StatusBadge>
          <StatusBadge tone={presenceTone(session.presence)}>{session.presence}</StatusBadge>
        </div>
      </div>

      <div className="mt-4 grid gap-3 text-sm">
        <RenameInline
          label="Machine"
          value={session.machineName}
          endpoint={`/api/machines/${encodeURIComponent(session.machineId)}/rename`}
          onRenamed={onRenamed}
        />
        <RenameInline
          label="Project"
          value={session.projectName}
          endpoint={`/api/projects/${encodeURIComponent(session.projectId)}/rename`}
          onRenamed={onRenamed}
        />
        <MetadataRow label="Detected project" value={session.projectDetectedName ?? session.projectName} />
        <MetadataRow label="Repo" value={session.repoName ?? "unknown"} />
        <MetadataRow label="Branch" value={session.branch ?? "unknown"} />
        <MetadataRow label="Head" value={abbreviatedHead(session)} />
        <MetadataRow label="State" value={session.semanticState === "blocked" ? "blocked / waiting" : session.semanticState} />
        <MetadataRow label="CWD" value={session.cwd} />
        <MetadataRow label="Git root" value={session.gitRoot ?? "not reported"} />
        <MetadataRow label="Worktree" value={session.worktreePath ?? "not reported"} />
        {session.projectDescription ? <MetadataRow label="Description" value={session.projectDescription} /> : null}
        <MetadataRow label="Last heartbeat" value={session.lastHeartbeatAt ? formatTimestamp(session.lastHeartbeatAt) : "not reported"} />
      </div>
    </article>
  );
}
