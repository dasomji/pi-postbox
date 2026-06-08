import type { SessionSnapshot } from "@pi-postbox/protocol";

export function ProjectIcon({ session }: { session: SessionSnapshot }) {
  if (session.projectIcon?.dataUrl) {
    return (
      <img
        className="h-11 w-11 shrink-0 rounded-xl border border-postbox-border bg-postbox-elevated object-contain p-1"
        src={session.projectIcon.dataUrl}
        alt=""
      />
    );
  }

  return (
    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-postbox-border bg-attention/10 text-sm font-bold text-attention-foreground">
      {(session.projectName || "?").slice(0, 2).toUpperCase()}
    </div>
  );
}
