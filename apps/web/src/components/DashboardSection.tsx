import type { ReactNode } from "react";

interface DashboardSectionProps {
  children: ReactNode;
  description: string;
  timestamp?: string;
  title: string;
  tone?: "attention" | "history" | "neutral";
}

const sectionToneClasses = {
  attention: "border-attention-border bg-attention/10 text-attention-foreground",
  history: "border-history-border bg-history/10 text-history-foreground",
  neutral: "border-postbox-border bg-postbox-surface/70 text-postbox-muted"
} satisfies Record<NonNullable<DashboardSectionProps["tone"]>, string>;

export function DashboardSection({ children, description, timestamp, title, tone = "neutral" }: DashboardSectionProps) {
  return (
    <section className={`mt-6 rounded-3xl border p-5 shadow-postbox-section ${sectionToneClasses[tone]}`}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-postbox-text">{title}</h2>
          <p className="mt-1 text-sm opacity-75">{description}</p>
        </div>
        {timestamp ? <time className="text-xs opacity-50">{timestamp}</time> : null}
      </div>
      {children}
    </section>
  );
}
