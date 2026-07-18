/**
 * Shared answer-form logic for the open-question view.
 *
 * Each layout variation renders its own markup but drives the same selection,
 * note, submit and cancel behaviour through this factory. Keeping it here means
 * switching layouts never resets the form, and mock questions can short-circuit
 * the network calls.
 */
import { OTHER_OPTION_VALUE, type AskRequestSnapshot } from "@pi-postbox/protocol";
import { postJson } from "../api/postboxApi";
import { store } from "./store.svelte";

export interface QuestionForm {
  readonly selected: string[];
  note: string;
  readonly error: string | undefined;
  readonly done: string | undefined;
  readonly busy: boolean;
  readonly canSubmit: boolean;
  updateRequest(request: AskRequestSnapshot): void;
  isSelected(value: string): boolean;
  toggle(value: string): void;
  submit(): void;
  cancel(): void;
}

export function createQuestionForm(request: AskRequestSnapshot, isMock = false): QuestionForm {
  let currentRequest = request;
  let selected = $state<string[]>([]);
  let note = $state("");
  let error = $state<string | undefined>(undefined);
  let done = $state<string | undefined>(undefined);
  let busy = $state(false);

  function toggle(value: string): void {
    done = undefined;
    if (currentRequest.mode === "single") {
      selected = [value];
      return;
    }
    selected = selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value];
  }

  async function resolveVia(action: () => Promise<void>, fallback: string): Promise<void> {
    busy = true;
    error = undefined;
    store.beginLocalResolve(currentRequest.requestId);
    try {
      await action();
      await store.refresh();
      store.routeAfterRequestResolved(currentRequest.sessionId);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : fallback;
    } finally {
      busy = false;
      store.endLocalResolve(currentRequest.requestId);
    }
  }

  function labelFor(values: string[]): string {
    return values
      .map((value) => currentRequest.options.find((option) => option.value === value)?.label ?? (value === OTHER_OPTION_VALUE ? "Other" : value))
      .join(", ");
  }

  function submit(): void {
    if (selected.length === 0) return;
    if (isMock) {
      done = `Mock submit · ${labelFor(selected)}${note.trim() ? ` · note: "${note.trim()}"` : ""}`;
      return;
    }
    void resolveVia(async () => {
      // Local submits resolve in milliseconds; hold the view long enough for the
      // delivered-stamp animation to land before routing away.
      const minimumStampTime = new Promise((resolve) => setTimeout(resolve, 900));
      await postJson(`/api/requests/${encodeURIComponent(currentRequest.requestId)}/answer`, {
        selectedValues: selected,
        note: note.trim() || undefined
      });
      await minimumStampTime;
    }, "Unable to submit answer");
  }

  function cancel(): void {
    if (isMock) {
      done = "Mock cancel";
      return;
    }
    void resolveVia(
      () => postJson(`/api/requests/${encodeURIComponent(currentRequest.requestId)}/cancel`, { note: note.trim() || undefined }),
      "Unable to cancel request"
    );
  }

  return {
    get selected() {
      return selected;
    },
    get note() {
      return note;
    },
    set note(value: string) {
      note = value;
    },
    get error() {
      return error;
    },
    get done() {
      return done;
    },
    get busy() {
      return busy;
    },
    get canSubmit() {
      return selected.length > 0 && !busy;
    },
    updateRequest(nextRequest) {
      if (nextRequest.requestId === currentRequest.requestId) currentRequest = nextRequest;
    },
    isSelected: (value: string) => selected.includes(value),
    toggle,
    submit,
    cancel
  };
}
