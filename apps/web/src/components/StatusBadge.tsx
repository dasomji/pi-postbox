import { badgeToneClass, type BadgeTone } from "../lib/statusStyles";

interface StatusBadgeProps {
  children: string;
  tone?: BadgeTone;
}

export function StatusBadge({ children, tone = "neutral" }: StatusBadgeProps) {
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ring-1 ${badgeToneClass(tone)}`}>
      {children}
    </span>
  );
}
