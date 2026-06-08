import type { AskOption, AskRequestSnapshot } from "@pi-postbox/protocol";

interface QuestionOptionChoiceProps {
  checked: boolean;
  mode: AskRequestSnapshot["mode"];
  name: string;
  onToggle: () => void;
  option: AskOption;
}

export function QuestionOptionChoice({ checked, mode, name, onToggle, option }: QuestionOptionChoiceProps) {
  return (
    <label className="flex cursor-pointer gap-3 rounded-xl border border-postbox-border bg-postbox-elevated/70 p-3 transition hover:border-attention-border">
      <input className="mt-1 accent-attention" type={mode === "single" ? "radio" : "checkbox"} name={name} checked={checked} onChange={onToggle} />
      <span>
        <span className="block font-medium text-postbox-text">{option.label}</span>
        {option.description ? <span className="mt-1 block text-sm text-postbox-muted">{option.description}</span> : null}
        {option.meaning ? <span className="mt-2 block text-sm text-attention-foreground/80">Meaning: {option.meaning}</span> : null}
        {option.context ? <span className="mt-1 block text-sm text-postbox-muted">Context: {option.context}</span> : null}
      </span>
    </label>
  );
}
