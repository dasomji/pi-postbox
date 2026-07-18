/** Browser-local shell and per-question presentation state. */

import { SvelteMap } from "svelte/reactivity";

const STORAGE_KEY = "postbox.devUi";
const LEGACY_STORAGE_KEY = "postbox.layout";
const NAVIGATION_STORAGE_KEY = "postbox.navigationOpen";

export type QuestionWorkspaceTab = "question" | "chat";

export interface QuestionChatPresentation {
  started: boolean;
  visible: boolean;
  mobileTab: QuestionWorkspaceTab;
}

function readStoredNavigation(): boolean {
  try {
    const raw = localStorage.getItem(NAVIGATION_STORAGE_KEY);
    if (raw === "false") return false;
    return true;
  } catch {
    return true;
  }
}

function readStoredMock(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return false;
    return Boolean((JSON.parse(raw) as { mock?: boolean }).mock);
  } catch {
    return false;
  }
}

export class BrowserLayoutState {
  /** Whether the desktop project/question navigation is visible. */
  navigationOpen = $state(true);

  /** When true, render a mock question whenever no real question is active. */
  mockQuestion = $state(false);
  private questionChats = new SvelteMap<string, QuestionChatPresentation>();

  constructor() {
    this.navigationOpen = readStoredNavigation();
    this.mockQuestion = readStoredMock();
  }

  toggleNavigation(): void {
    this.navigationOpen = !this.navigationOpen;
    try {
      localStorage.setItem(NAVIGATION_STORAGE_KEY, String(this.navigationOpen));
    } catch {
      // localStorage may be unavailable (private mode); the UI still works.
    }
  }

  questionChat(requestId: string): QuestionChatPresentation {
    return this.questionChats.get(requestId) ?? { started: false, visible: false, mobileTab: "question" };
  }

  markQuestionChatStarted(requestId: string): void {
    const current = this.questionChat(requestId);
    this.questionChats.set(
      requestId,
      current.started ? current : { started: true, visible: true, mobileTab: "chat" }
    );
  }

  showQuestionChat(requestId: string): void {
    const current = this.questionChat(requestId);
    if (!current.started) return;
    this.questionChats.set(requestId, { ...current, visible: true });
  }

  hideQuestionChat(requestId: string): void {
    const current = this.questionChat(requestId);
    if (!current.started) return;
    this.questionChats.set(requestId, { ...current, visible: false });
  }

  selectQuestionWorkspaceTab(requestId: string, mobileTab: QuestionWorkspaceTab): void {
    const current = this.questionChat(requestId);
    if (!current.started) return;
    this.questionChats.set(requestId, { ...current, mobileTab });
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ mock: this.mockQuestion }));
    } catch {
      // localStorage may be unavailable (private mode); the UI still works.
    }
  }

  toggleMock(): void {
    this.mockQuestion = !this.mockQuestion;
    this.persist();
  }
}

export const layout = new BrowserLayoutState();
