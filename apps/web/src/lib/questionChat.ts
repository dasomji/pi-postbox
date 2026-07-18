import {
  QUESTION_CHAT_ASSISTANT_TEXT_MAX,
  type QuestionChatEvent,
  type QuestionChatMessage,
  type QuestionChatSnapshot
} from "@pi-postbox/protocol";
import { Marked, Renderer } from "marked";

const markdownRenderer = createMarkdownRenderer();

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
  // The HTML renderer makes raw tags inert while preserving CommonMark block
  // syntax such as `>` quotes. Link/image renderers constrain URL-bearing HTML.
  return markdownRenderer.parse(markdown.slice(0, QUESTION_CHAT_ASSISTANT_TEXT_MAX)) as string;
}

function createMarkdownRenderer(): Marked {
  const renderer = new Renderer();
  renderer.html = ({ text }) => escapeHtml(text);
  renderer.link = function ({ href, title, tokens }) {
    const label = this.parser.parseInline(tokens);
    if (!isSafeLink(href)) return label;
    const titleAttribute = title ? ` title="${escapeHtml(title)}"` : "";
    return `<a href="${escapeHtml(href)}"${titleAttribute} rel="noopener noreferrer">${label}</a>`;
  };
  renderer.image = function ({ text }) {
    return escapeHtml(text);
  };
  return new Marked({ async: false, breaks: true, gfm: true, renderer });
}

function isSafeLink(href: string): boolean {
  if (href.startsWith("/") || href.startsWith("#")) return true;
  try {
    const url = new URL(href);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
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
