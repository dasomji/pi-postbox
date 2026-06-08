import type { AskRequestSnapshot, SessionSnapshot } from "@pi-postbox/protocol";

export type BadgeTone = "neutral" | "attention" | "history" | "success" | "warning" | "danger";

export function historyTone(status: AskRequestSnapshot["status"]): BadgeTone {
  if (status === "answered") return "success";
  if (status === "cancelled") return "warning";
  if (status === "expired") return "neutral";
  return "attention";
}

export function semanticTone(state: SessionSnapshot["semanticState"]): BadgeTone {
  if (state === "blocked") return "danger";
  if (state === "working") return "attention";
  return "neutral";
}

export function presenceTone(presence: SessionSnapshot["presence"]): BadgeTone {
  if (presence === "live") return "success";
  if (presence === "stale") return "warning";
  return "neutral";
}

export function badgeToneClass(tone: BadgeTone): string {
  const tones: Record<BadgeTone, string> = {
    neutral: "bg-postbox-muted/40 text-postbox-subtle ring-postbox-border-strong",
    attention: "bg-attention/10 text-attention-foreground ring-attention/30",
    history: "bg-history/10 text-history-foreground ring-history/30",
    success: "bg-success/10 text-success-foreground ring-success/30",
    warning: "bg-warning/10 text-warning-foreground ring-warning/30",
    danger: "bg-danger/10 text-danger-foreground ring-danger/40"
  };
  return tones[tone];
}
