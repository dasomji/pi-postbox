interface EmptyStateProps {
  children: string;
  tone?: "attention" | "history" | "neutral";
}

const emptyStateToneClasses = {
  attention: "border-attention-border text-attention-foreground",
  history: "border-history-border text-history-foreground",
  neutral: "border-postbox-border text-postbox-muted"
} satisfies Record<NonNullable<EmptyStateProps["tone"]>, string>;

export function EmptyState({ children, tone = "neutral" }: EmptyStateProps) {
  return (
    <div className={`mt-5 rounded-2xl border border-dashed bg-postbox-canvas/50 p-8 text-center opacity-75 ${emptyStateToneClasses[tone]}`}>
      {children}
    </div>
  );
}
