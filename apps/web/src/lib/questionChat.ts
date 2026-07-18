import {
  QUESTION_CHAT_ASSISTANT_TEXT_MAX,
  type QuestionChatEvent,
  type QuestionChatMessage,
  type QuestionChatSnapshot
} from "@pi-postbox/protocol";

export function applyQuestionChatEvent(snapshot: QuestionChatSnapshot, event: QuestionChatEvent): QuestionChatSnapshot {
  if (event.requestId !== snapshot.requestId || event.sequence <= snapshot.sequence) return snapshot;
  const messages = snapshot.messages.map((message) => ({ ...message }));
  if (event.type === "message.started") {
    const existing = messages.findIndex((message) => message.id === event.message.id);
    if (existing >= 0) messages[existing] = event.message;
    else messages.push(event.message);
  } else if (event.type === "assistant.text.delta") {
    const existing = messages.find((message) => message.id === event.messageId && message.role === "assistant");
    if (existing?.role === "assistant") {
      existing.text = (existing.text + event.text).slice(0, QUESTION_CHAT_ASSISTANT_TEXT_MAX);
      existing.status = "streaming";
    }
  } else if (event.type === "message.finished") {
    const existing = messages.find((message) => message.id === event.messageId && message.role === "assistant");
    if (existing?.role === "assistant") {
      existing.text = event.text;
      existing.status = "final";
    }
  }
  return {
    ...snapshot,
    state: event.type === "lifecycle" ? event.state : snapshot.state,
    sequence: event.sequence,
    messages: messages.slice(-100) as QuestionChatMessage[]
  };
}

export function renderSafeMarkdown(markdown: string): string {
  const escaped = escapeHtml(markdown.slice(0, QUESTION_CHAT_ASSISTANT_TEXT_MAX));
  const codeBlocks: string[] = [];
  let rendered = escaped.replace(/```(?:[^\n]*)\n?([\s\S]*?)```/g, (_match, code: string) => {
    const index = codeBlocks.push(`<pre><code>${code}</code></pre>`) - 1;
    return `\u0000CODE${index}\u0000`;
  });
  rendered = rendered
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");
  rendered = rendered.replace(/\u0000CODE(\d+)\u0000/g, (_match, index: string) => codeBlocks[Number(index)] ?? "");
  return rendered;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]!);
}
