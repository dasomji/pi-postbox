// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { createHealthResponse } from "@pi-postbox/protocol";
import type {
  AskRequestSnapshot,
  QuestionChatActivationResponse,
  QuestionChatSendPayload,
  QuestionChatSnapshot,
  QuestionChatStopPayload
} from "@pi-postbox/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { BrowserLayoutState } from "../lib/layout.svelte";
import type { QuestionChatProbeResult } from "../api/postboxApi";
import QuestionDetail from "./QuestionDetail.svelte";
import MainView from "./MainView.svelte";
import ConnectionBadge from "./ConnectionBadge.svelte";
import OpenQuestionsQueue from "./OpenQuestionsQueue.svelte";
import { PostboxStore, store } from "../lib/store.svelte";

const isolatedStore = vi.hoisted(() => ({ current: undefined as PostboxStore | undefined }));
vi.mock("../lib/store.svelte", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/store.svelte")>();
  return { ...original, get store() { return isolatedStore.current ??= new original.PostboxStore(); } };
});
beforeEach(() => { isolatedStore.current = new PostboxStore(); });

afterEach(() => { cleanup(); vi.unstubAllGlobals(); store.clearSelection(); });

const REQUEST: AskRequestSnapshot = {
  requestId: "question-one",
  sessionId: "session-one",
  revision: 1,
  ownerRevision: 1,
  creator: { harness: "pi", ownerId: "test-owner" },
  owner: { harness: "pi", ownerId: "test-owner" },
  images: [],
      mode: "single",
  question: { prompt: "Which path should we take?" },
  options: [{ value: "a", label: "Path A" }],
  status: "pending",
  createdAt: "2026-07-17T12:00:00.000Z"
};

function snapshot(requestId = REQUEST.requestId): QuestionChatSnapshot {
  return {
    requestId,
    state: "ready",
    forkKind: "fresh",
    model: { id: "test/model", source: "postbox-settings" },
    sequence: 0,
    messages: [],
    tools: []
  };
}

function mediaController(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const query = {
    get matches() { return matches; },
    media: "(max-width: 767px)",
    onchange: null,
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn()
  } as unknown as MediaQueryList;
  return {
    query,
    setMatches(next: boolean) {
      matches = next;
      const event = { matches: next, media: query.media } as MediaQueryListEvent;
      for (const listener of listeners) listener(event);
    }
  };
}

function chatBoundary(requestId = REQUEST.requestId, alreadyRunning = false, active = snapshot(requestId)) {
  const close = vi.fn();
  return {
    activate: vi.fn(async (): Promise<QuestionChatActivationResponse> => ({ status: "ready", snapshot: active })),
    fetchSnapshot: vi.fn(async () => active),
    probeSnapshot: vi.fn(async (): Promise<QuestionChatProbeResult> => alreadyRunning
      ? { status: "ready" as const, snapshot: active }
      : { status: "not-started" as const }),
    sendMessage: vi.fn(async (_requestId: string, command: QuestionChatSendPayload) => ({
      status: "accepted" as const,
      clientCommandId: command.clientCommandId,
      mode: "turn" as const
    })),
    stop: vi.fn(async (_requestId: string, command: QuestionChatStopPayload) => ({
      status: "accepted" as const,
      clientCommandId: command.clientCommandId
    })),
    connectEvents: vi.fn(() => ({ ready: Promise.resolve(), close })),
    close
  };
}

describe("outage-safe Question workspace", () => {
  it("refuses offline Dismiss at the action boundary when the disabled button is bypassed", async () => {
    const current = { timestamp: REQUEST.createdAt, sessions: [], requests: [REQUEST] };
    store.applyStateSnapshot(current);
    store.connection = { status: "unavailable", message: "Offline" };
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json(current));
    vi.stubGlobal("fetch", fetcher);
    render(OpenQuestionsQueue);
    const dismiss = screen.getByRole("button", { name: /^Dismiss question:/ }) as HTMLButtonElement;
    dismiss.disabled = false;
    await fireEvent.click(dismiss);
    expect(fetcher).not.toHaveBeenCalled();
    expect(store.pendingRequests[0]?.status).toBe("pending");
    expect(screen.getByRole("status").textContent).toContain("offline or reconnecting");
    store.connection = { status: "connected", health: createHealthResponse({ startedAtMs: 1_000 }) };
    await waitFor(() => expect(dismiss.disabled).toBe(false));
    await fireEvent.click(dismiss);
    await waitFor(() => expect(fetcher.mock.calls.some((call) => call[1]?.method === "POST")).toBe(true));
  });

  it("disables queue Dismiss with an accessible offline explanation and re-enables it after recovery", async () => {
    const current = { timestamp: REQUEST.createdAt, sessions: [], requests: [REQUEST, { ...REQUEST, requestId: "child-question", parentQuestionId: REQUEST.requestId }] };
    store.applyStateSnapshot(current);
    store.connection = { status: "unavailable", message: "Offline" };
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json(current));
    vi.stubGlobal("fetch", fetcher);
    render(OpenQuestionsQueue);
    const buttons = screen.getAllByRole("button", { name: /^Dismiss question:/ }) as HTMLButtonElement[];
    expect(buttons).toHaveLength(2); // Includes the nested Question tree.
    for (const button of buttons) {
      expect(button.disabled).toBe(true);
      const descriptionId = button.getAttribute("aria-describedby");
      expect(descriptionId).toBeTruthy();
      expect(document.getElementById(descriptionId!)?.textContent).toContain("offline or reconnecting");
    }
    await fireEvent.click(buttons[0]!);
    expect(fetcher).not.toHaveBeenCalled();
    expect(store.pendingRequests).toHaveLength(2);
    store.connection = { status: "connected", health: createHealthResponse({ startedAtMs: 1_000 }) };
    await waitFor(() => expect(buttons.every((button) => !button.disabled)).toBe(true));
    expect(buttons.every((button) => !button.hasAttribute("aria-describedby"))).toBe(true);
    await fireEvent.click(buttons[0]!);
    await waitFor(() => expect(fetcher.mock.calls.some((call) => call[1]?.method === "POST")).toBe(true));
  });

  it.each(["/healthz", "/api/state"])("recovers delivery on a later poll after %s hangs without a network error", async (hungPath) => {
    vi.useFakeTimers();
    const health = createHealthResponse({ startedAtMs: 1_000 });
    const current = { timestamp: REQUEST.createdAt, sessions: [], requests: [REQUEST] };
    let events!: RecoveryEventSource;
    class RecoveryEventSource extends EventTarget {
      readyState = 0;
      onerror: ((event: Event) => unknown) | null = null;
      constructor(_url: string) { super(); events = this; }
      emitState() {
        this.readyState = 1;
        this.dispatchEvent(new MessageEvent("state", { data: JSON.stringify(current) }));
      }
      close() { this.readyState = 2; }
    }
    let hanging = false;
    let hungSignal: AbortSignal | null | undefined;
    vi.stubGlobal("EventSource", RecoveryEventSource);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (hanging && String(input) === hungPath) {
        hungSignal = init?.signal;
        // A blackholed TCP connection never resolves or rejects until aborted.
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        });
      }
      return Response.json(String(input) === "/healthz" ? health : current);
    }));
    const stop = store.start();
    try {
      await vi.advanceTimersByTimeAsync(0);
      events.emitState();
      render(QuestionDetail, { props: { request: REQUEST, chatApi: chatBoundary(), matchMedia: () => mediaController(false).query } });
      await fireEvent.click(screen.getByRole("radio", { name: "Path A" }));
      const submit = screen.getByRole("button", { name: "Submit" }) as HTMLButtonElement;
      expect(submit.disabled).toBe(false);

      hanging = true;
      events.onerror?.(new Event("error"));
      await vi.advanceTimersByTimeAsync(0);
      await tick();
      expect(submit.disabled).toBe(true);
      await vi.advanceTimersByTimeAsync(4_000);
      hanging = false;
      // The stream can reopen before health completes, or reopen without a new state event.
      if (hungPath === "/healthz") events.emitState();
      else events.readyState = 1;
      await vi.advanceTimersByTimeAsync(1_000);
      await tick();
      expect(store.connection.status).toBe("connected");
      expect(store.syncing).toBe(false);
      expect(store.pendingRequests[0]?.status).toBe("pending");
      expect(submit.disabled).toBe(false);
      expect(hungSignal?.aborted).toBe(true);
    } finally {
      stop();
      vi.useRealTimers();
    }
  });

  it("describes unavailable answer controls and uses neutral wording while connected data refreshes", async () => {
    const health = createHealthResponse({ startedAtMs: 1_000 });
    store.applyStateSnapshot({ timestamp: REQUEST.createdAt, sessions: [], requests: [REQUEST] });
    store.connection = { status: "unavailable", message: "Offline" };
    render(QuestionDetail, { props: { request: REQUEST, chatApi: chatBoundary(), matchMedia: () => mediaController(false).query } });
    render(ConnectionBadge);
    const submit = screen.getByRole("button", { name: "Submit" });
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const descriptionId = submit.getAttribute("aria-describedby");
    expect(descriptionId).toBeTruthy();
    expect(cancel.getAttribute("aria-describedby")).toBe(descriptionId);
    expect(document.getElementById(descriptionId!)?.textContent).toContain("offline or reconnecting");
    store.connection = { status: "connected", health };
    store.syncing = true; // A tab returning after more than 10 seconds.
    await waitFor(() => expect(screen.getByLabelText(/^Connected/)).toBeTruthy());
    expect(screen.queryByText(/offline or reconnecting/)).toBeNull();
    expect(document.getElementById(descriptionId!)?.textContent).toContain("Refreshing");
    store.syncing = false;
    await waitFor(() => expect(submit.hasAttribute("aria-describedby")).toBe(false));
    expect(screen.queryByText(/Refreshing/)).toBeNull();
  });

  it("shows an unknown Question status without a cached snapshot until the server confirms resolution", async () => {
    store.snapshot = { status: "loading" };
    store.syncing = true;
    store.connection = { status: "unavailable", message: "Failed to fetch" };
    store.selectRequest("uncached-question");
    render(MainView);

    expect(screen.getByText("Question status unknown")).toBeTruthy();
    expect(screen.queryByText("Question resolved")).toBeNull();

    store.applyStateSnapshot({ timestamp: REQUEST.createdAt, sessions: [], requests: [] });
    store.connection = { status: "connected", health: createHealthResponse({ startedAtMs: 1_000, nowMs: 2_000 }) };
    await waitFor(() => expect(screen.getByText("Question resolved")).toBeTruthy());
  });

  it("keeps the Question, gallery and answer draft visible during an outage and disables delivery until recovery", async () => {
    const request = { ...REQUEST, images: [{
      imageId: "12345678-1234-4123-8123-123456789abc",
      mediaType: "image/png" as const, byteSize: 128, width: 32, height: 16, alt: "Rollout gallery"
    }] };
    const health = createHealthResponse({ startedAtMs: 1_000, nowMs: 2_000 });
    store.connection = { status: "connected", health };
    store.applyStateSnapshot({ timestamp: REQUEST.createdAt, sessions: [], requests: [request] });
    store.selectRequest(request.requestId);
    vi.stubGlobal("matchMedia", () => mediaController(false).query);
    // The Chat probe is a separate HTTP boundary; no Chat is active for this Question.
    const fetchBoundary = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetchBoundary);
    render(MainView);
    render(ConnectionBadge);
    await fireEvent.click(screen.getByRole("radio", { name: "Path A" }));
    await fireEvent.click(screen.getByRole("button", { name: "+ Add a note" }));
    const note = screen.getByPlaceholderText("Add nuance for the coding agent…") as HTMLTextAreaElement;
    await fireEvent.input(note, { target: { value: "Keep this unsent answer" } });

    await store.loadSnapshot(async () => { throw new TypeError("Failed to fetch"); });

    await waitFor(() => expect((screen.getByRole("button", { name: "Submit" }) as HTMLButtonElement).disabled).toBe(true));
    expect(screen.getByLabelText("Server unavailable")).toBeTruthy();
    expect(screen.getByText(/Answers cannot be sent while offline/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: REQUEST.question.prompt })).toBeTruthy();
    expect(screen.getByAltText("Rollout gallery")).toBeTruthy();
    expect(screen.queryByText("Question resolved")).toBeNull();
    await fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(screen.queryByLabelText("Answer submitted. Dismiss.")).toBeNull();
    expect(fetchBoundary.mock.calls.filter(([, init]) => init?.method === "POST")).toEqual([]);

    store.applyStateSnapshot({ timestamp: REQUEST.createdAt, sessions: [], requests: [request] });
    store.connection = { status: "connected", health };
    await waitFor(() => expect((screen.getByRole("button", { name: "Submit" }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByText(/Answers cannot be sent while offline/)).toBeNull();
    expect(note.value).toBe("Keep this unsent answer");
    expect((screen.getByRole("radio", { name: "Path A" }) as HTMLInputElement).checked).toBe(true);

    store.applyStateSnapshot({ timestamp: REQUEST.createdAt, sessions: [], requests: [] });
    await waitFor(() => expect(screen.queryByRole("heading", { name: REQUEST.question.prompt })).toBeNull());
  });

});

describe("responsive Question Chat workspace", () => {
  it("preserves a Chat draft across a same-question state snapshot update", async () => {
    const media = mediaController(false);
    const layoutState = new BrowserLayoutState();
    const chatApi = chatBoundary(REQUEST.requestId, true);
    const view = render(QuestionDetail, {
      props: {
        request: REQUEST,
        isMock: true,
        layoutState,
        matchMedia: () => media.query,
        chatApi
      }
    });
    const composer = await screen.findByLabelText("Message Question Chat") as HTMLTextAreaElement;
    await fireEvent.input(composer, { target: { value: "Keep this unsent Chat draft" } });

    await view.rerender({
      request: { ...REQUEST, question: { prompt: "Which updated path should we take?" } },
      isMock: true,
      layoutState,
      matchMedia: () => media.query,
      chatApi
    });

    expect(screen.getByLabelText("Message Question Chat")).toBe(composer);
    expect(chatApi.connectEvents).toHaveBeenCalledOnce();
    expect(composer.value).toBe("Keep this unsent Chat draft");
  });

  it("preserves selection and note across a live option append and never auto-selects the suggestion", async () => {
    const media = mediaController(false);
    const view = render(QuestionDetail, {
      props: {
        request: REQUEST,
        isMock: true,
        layoutState: new BrowserLayoutState(),
        matchMedia: () => media.query,
        chatApi: chatBoundary()
      }
    });
    await fireEvent.click(screen.getByRole("radio", { name: "Path A" }));
    await fireEvent.click(screen.getByRole("button", { name: "+ Add a note" }));
    await fireEvent.input(screen.getByPlaceholderText("Add nuance for the coding agent…"), { target: { value: "Keep my draft" } });

    await view.rerender({
      request: {
        ...REQUEST,
        options: [...REQUEST.options, { value: "chat_opaque", label: "Stage first", provenance: "chat" as const }]
      },
      isMock: true,
      layoutState: new BrowserLayoutState(),
      matchMedia: () => media.query,
      chatApi: chatBoundary()
    });

    expect((screen.getByPlaceholderText("Add nuance for the coding agent…") as HTMLTextAreaElement).value).toBe("Keep my draft");
    expect((screen.getByRole("radio", { name: "Path A" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("radio", { name: /Stage first Suggested in Chat/ }) as HTMLInputElement).checked).toBe(false);
    await fireEvent.click(screen.getByRole("radio", { name: /Stage first Suggested in Chat/ }));
    expect((screen.getByRole("radio", { name: /Stage first Suggested in Chat/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByPlaceholderText("Add nuance for the coding agent…") as HTMLTextAreaElement).value).toBe("Keep my draft");
  });

  it("offers an explicit proposal action on mobile without switching the desktop workspace", async () => {
    const proposalSnapshot = snapshot();
    proposalSnapshot.tools = [{
      id: "proposal-tool",
      tool: "propose_answer",
      target: "Stage first",
      state: "success",
      details: "Added “Stage first” as a Suggested in Chat option.",
      action: { type: "show-question", optionValue: "chat_opaque" }
    }];
    const mobile = mediaController(true);
    const mobileView = render(QuestionDetail, {
      props: {
        request: REQUEST,
        isMock: true,
        layoutState: new BrowserLayoutState(),
        matchMedia: () => mobile.query,
        chatApi: chatBoundary(REQUEST.requestId, true, proposalSnapshot)
      }
    });
    const action = await screen.findByRole("button", { name: "View in Question" });
    expect(screen.getByRole("tab", { name: "Question Chat" }).getAttribute("aria-selected")).toBe("true");
    await fireEvent.click(action);
    expect(screen.getByRole("tab", { name: "Question" }).getAttribute("aria-selected")).toBe("true");
    const mobileActionBar = screen.getByTestId("question-action-bar");
    expect(mobileActionBar.className).toContain("sticky");
    expect(mobileActionBar.style.bottom).toContain("4.25rem");
    expect(mobileActionBar.style.bottom).toContain("safe-area-inset-bottom");
    mobileView.unmount();

    const desktop = mediaController(false);
    render(QuestionDetail, {
      props: {
        request: REQUEST,
        isMock: true,
        layoutState: new BrowserLayoutState(),
        matchMedia: () => desktop.query,
        chatApi: chatBoundary(REQUEST.requestId, true, proposalSnapshot)
      }
    });
    expect(await screen.findByRole("complementary", { name: "Question Chat sidebar" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "View in Question" })).toBeNull();
    expect(screen.getByRole("region", { name: "Question" })).toBeTruthy();
  });

  it("reveals fresh-browser Chat unavailable with Retry when the extension is offline", async () => {
    const media = mediaController(false);
    const chatApi = chatBoundary();
    chatApi.probeSnapshot.mockResolvedValueOnce({
      status: "unavailable" as const,
      error: { code: "extension_offline" as const, message: "The originating Pi extension is offline." }
    }).mockResolvedValueOnce({ status: "ready" as const, snapshot: snapshot() });
    render(QuestionDetail, {
      props: {
        request: REQUEST,
        isMock: true,
        layoutState: new BrowserLayoutState(),
        matchMedia: () => media.query,
        chatApi
      }
    });

    expect((await screen.findByRole("alert")).textContent).toContain("extension is offline");
    expect(screen.getByRole("complementary", { name: "Question Chat sidebar" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Chat" })).toBeNull();
    await fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("heading", { name: "Question Chat" })).toBeTruthy();
    expect(chatApi.activate).not.toHaveBeenCalled();
    expect(chatApi.probeSnapshot).toHaveBeenCalledTimes(2);
  });

  it("adds a fixed responsive desktop sidebar and hide/reopens presentation without lifecycle commands", async () => {
    const media = mediaController(false);
    const chatApi = chatBoundary();
    const { container } = render(QuestionDetail, {
      props: {
        request: REQUEST,
        isMock: true,
        layoutState: new BrowserLayoutState(),
        matchMedia: () => media.query,
        chatApi
      }
    });

    expect(screen.getByRole("region", { name: "Question" })).toBeTruthy();
    expect(screen.queryByRole("complementary", { name: "Question Chat sidebar" })).toBeNull();
    const sidebarElement = container.querySelector<HTMLElement>("#chat-workspace-panel");
    expect(sidebarElement?.style.display).toBe("none");
    const projectLabel = screen.getByText("Project:");
    const projectMetadata = projectLabel.parentElement;
    const metadata = projectMetadata?.parentElement;
    expect(metadata?.className).toContain("font-display");
    expect(metadata?.className).toContain("text-lg");
    expect(metadata?.className).toContain("font-bold");
    expect(metadata?.className).toContain("tracking-wide");
    const contextBar = screen.getByTestId("question-context-bar");
    expect(contextBar).toBe(metadata?.parentElement);
    expect(contextBar.className).toContain("sticky");
    expect(contextBar.className).toContain("top-0");
    expect(contextBar.className).toContain("bg-postbox-canvas/95");
    const questionRegion = screen.getByRole("region", { name: "Question" });
    expect(questionRegion.className).toContain("overflow-y-auto");
    expect(projectLabel.className).toContain("text-postbox-subtle");
    expect(projectLabel.nextElementSibling?.className).toContain("text-attention");
    const branchLabel = screen.getByText("Branch:");
    expect(branchLabel.className).toContain("text-postbox-subtle");
    expect(branchLabel.nextElementSibling?.className).toContain("text-history-foreground");
    const submitAnswer = screen.getByRole("button", { name: "Submit" });
    expect(submitAnswer.lastElementChild?.tagName).toBe("svg");
    const actionBar = screen.getByTestId("question-action-bar");
    expect(actionBar).toBe(submitAnswer.parentElement);
    expect(actionBar.className).toContain("sticky");
    expect(actionBar.className).toContain("bg-postbox-canvas/95");
    expect(actionBar.style.bottom).toBe("0px");
    expect(actionBar.style.paddingBottom).toContain("safe-area-inset-bottom");
    expect(container.querySelector(".postal-stripes")).toBeNull();
    const chatAction = screen.getByRole("button", { name: "Chat" });
    const noteAction = screen.getByRole("button", { name: "+ Add a note" });
    expect(chatAction.previousElementSibling).toBe(submitAnswer);
    expect(noteAction.previousElementSibling).toBe(chatAction);
    expect(chatAction.className).toContain("rounded-md");
    expect(chatAction.className).toContain("bg-history");
    expect(noteAction.className).toContain("rounded-md");
    expect(noteAction.className).toContain("bg-postbox-elevated");
    await fireEvent.click(chatAction);

    const sidebar = await screen.findByRole("complementary", { name: "Question Chat sidebar" });
    expect(sidebar.style.display).toBe("");
    const chatRegion = screen.getByRole("region", { name: "Question Chat" });
    expect(chatRegion.className).not.toContain("border-history-border");
    const chatHeading = screen.getByRole("heading", { name: "Question Chat" });
    const hideChat = screen.getByRole("button", { name: "Hide Question Chat" });
    expect(hideChat.textContent?.trim()).toBe("›");
    expect(hideChat.parentElement?.contains(chatHeading)).toBe(true);
    const messages = screen.getByLabelText("Question Chat messages");
    const composerForm = chatRegion.querySelector("form");
    expect(sidebar.className).toContain("w-[clamp(");
    expect(sidebar.className).toContain("overflow-hidden");
    expect(chatRegion.className).toContain("min-h-0");
    expect(chatRegion.className).toContain("overflow-hidden");
    expect(messages.className).toContain("flex-1");
    expect(messages.className).toContain("overflow-y-auto");
    expect(composerForm?.className).toContain("shrink-0");
    expect(screen.queryByRole("separator")).toBeNull();
    await fireEvent.click(hideChat);
    expect(screen.queryByRole("complementary", { name: "Question Chat sidebar" })).toBeNull();
    expect(sidebar.style.display).toBe("none");
    expect(screen.getByRole("region", { name: "Question" })).toBeTruthy();

    await fireEvent.click(screen.getByRole("button", { name: "Chat" }));
    expect(await screen.findByRole("complementary", { name: "Question Chat sidebar" })).toBeTruthy();
    expect(chatApi.activate).toHaveBeenCalledOnce();
    expect(chatApi.stop).not.toHaveBeenCalled();
    expect(chatApi.sendMessage).not.toHaveBeenCalled();
    expect(chatApi.close).not.toHaveBeenCalled();

    media.setMatches(true);
    await waitFor(() => expect(screen.getByRole("tablist", { name: "Question workspace" })).toBeTruthy());
    expect(screen.getByRole("tab", { name: "Question Chat" }).getAttribute("aria-selected")).toBe("true");
  });

  it("reattaches from an authoritative running snapshot with fresh browser presentation state", async () => {
    const media = mediaController(false);
    const chatApi = chatBoundary(REQUEST.requestId, true);
    render(QuestionDetail, {
      props: {
        request: REQUEST,
        isMock: true,
        layoutState: new BrowserLayoutState(),
        matchMedia: () => media.query,
        chatApi
      }
    });

    expect(await screen.findByRole("complementary", { name: "Question Chat sidebar" })).toBeTruthy();
    expect(chatApi.probeSnapshot).toHaveBeenCalledWith(REQUEST.requestId);
    expect(chatApi.activate).not.toHaveBeenCalled();
  });

  it("closes a failed recovery stream and presents a coherent unavailable state", async () => {
    const media = mediaController(false);
    const chatApi = chatBoundary(REQUEST.requestId, true);
    chatApi.connectEvents.mockReturnValue({
      ready: Promise.reject(new Error("Recovery stream failed")),
      close: chatApi.close
    });
    render(QuestionDetail, {
      props: {
        request: REQUEST,
        isMock: true,
        layoutState: new BrowserLayoutState(),
        matchMedia: () => media.query,
        chatApi
      }
    });

    expect((await screen.findByRole("alert")).textContent).toContain("Recovery stream failed");
    expect(chatApi.close).toHaveBeenCalledOnce();
    await fireEvent.click(screen.getByRole("button", { name: "Hide Question Chat" }));
    expect(screen.queryByRole("complementary", { name: "Question Chat sidebar" })).toBeNull();
    await fireEvent.click(screen.getByRole("button", { name: "Chat" }));
    expect(await screen.findByRole("complementary", { name: "Question Chat sidebar" })).toBeTruthy();
    expect(chatApi.activate).not.toHaveBeenCalled();
    expect(chatApi.stop).not.toHaveBeenCalled();
    expect(chatApi.sendMessage).not.toHaveBeenCalled();
    expect(chatApi.close).toHaveBeenCalledOnce();
  });

  it("shows mobile recovery progress immediately and waits for success before adding tabs", async () => {
    const media = mediaController(true);
    const chatApi = chatBoundary();
    let finishActivation!: () => void;
    chatApi.activate.mockImplementation(() => new Promise((resolve) => {
      finishActivation = () => resolve({ status: "ready", snapshot: snapshot() });
    }));
    render(QuestionDetail, {
      props: {
        request: REQUEST,
        isMock: true,
        layoutState: new BrowserLayoutState(),
        matchMedia: () => media.query,
        chatApi
      }
    });

    await fireEvent.click(screen.getByRole("button", { name: "Chat" }));
    expect(screen.getByRole("status").textContent).toContain("Starting Question Chat");
    expect(screen.queryByRole("tablist", { name: "Question workspace" })).toBeNull();
    finishActivation();
    expect(await screen.findByRole("tablist", { name: "Question workspace" })).toBeTruthy();
  });

  it("returns mobile activation failures to the Question with no tabs and a reusable Chat action", async () => {
    const media = mediaController(true);
    const chatApi = chatBoundary();
    chatApi.activate.mockResolvedValue({
      status: "unavailable",
      error: { code: "extension_offline", message: "The extension is offline." }
    });
    render(QuestionDetail, {
      props: {
        request: REQUEST,
        isMock: true,
        layoutState: new BrowserLayoutState(),
        matchMedia: () => media.query,
        chatApi
      }
    });

    await fireEvent.click(screen.getByRole("button", { name: "Chat" }));
    expect(await screen.findByRole("region", { name: "Question" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Chat" })).toBeTruthy();
    expect(screen.queryByRole("tablist", { name: "Question workspace" })).toBeNull();
  });

  it("shows no mobile tabs before activation, opens Chat first, and remembers the last tab per question", async () => {
    const media = mediaController(true);
    const layoutState = new BrowserLayoutState();
    const firstChat = chatBoundary();
    const first = render(QuestionDetail, {
      props: { request: REQUEST, isMock: true, layoutState, matchMedia: () => media.query, chatApi: firstChat }
    });

    expect(screen.queryByRole("tablist", { name: "Question workspace" })).toBeNull();
    await fireEvent.click(screen.getByRole("button", { name: "Chat" }));
    expect(await screen.findByRole("tablist", { name: "Question workspace" })).toBeTruthy();
    const chatTab = screen.getByRole("tab", { name: "Question Chat" });
    const questionTab = screen.getByRole("tab", { name: "Question" });
    expect(chatTab.getAttribute("aria-selected")).toBe("true");
    expect(chatTab.getAttribute("tabindex")).toBe("0");
    expect(document.getElementById(chatTab.getAttribute("aria-controls")!)?.getAttribute("role")).toBe("tabpanel");
    await fireEvent.keyDown(chatTab, { key: "ArrowLeft" });
    expect(questionTab.getAttribute("aria-selected")).toBe("true");
    expect(questionTab.getAttribute("tabindex")).toBe("0");
    expect(document.activeElement).toBe(questionTab);
    const questionPanel = screen.getByRole("tabpanel", { name: "Question" });
    expect(questionPanel.className).toContain("pb-24");
    const tablist = screen.getByRole("tablist", { name: "Question workspace" });
    expect(tablist.getAttribute("style")).toContain("safe-area-inset-bottom");
    await fireEvent.keyDown(questionTab, { key: "End" });
    expect(chatTab.getAttribute("aria-selected")).toBe("true");
    await fireEvent.keyDown(chatTab, { key: "Home" });
    expect(questionTab.getAttribute("aria-selected")).toBe("true");
    await fireEvent.keyDown(questionTab, { key: "ArrowLeft" });
    expect(chatTab.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(chatTab);
    await fireEvent.keyDown(chatTab, { key: "ArrowRight" });
    expect(questionTab.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(questionTab);
    expect(firstChat.stop).not.toHaveBeenCalled();
    expect(firstChat.sendMessage).not.toHaveBeenCalled();
    expect(firstChat.close).not.toHaveBeenCalled();
    first.unmount();

    const secondRequest = { ...REQUEST, requestId: "question-two", question: { prompt: "Second question?" } };
    const secondChat = chatBoundary(secondRequest.requestId);
    const second = render(QuestionDetail, {
      props: { request: secondRequest, isMock: true, layoutState, matchMedia: () => media.query, chatApi: secondChat }
    });
    expect(screen.queryByRole("tablist", { name: "Question workspace" })).toBeNull();
    await fireEvent.click(screen.getByRole("button", { name: "Chat" }));
    expect((await screen.findByRole("tab", { name: "Question Chat" })).getAttribute("aria-selected")).toBe("true");
    second.unmount();

    const restoredChat = chatBoundary(REQUEST.requestId, true);
    render(QuestionDetail, {
      props: { request: REQUEST, isMock: true, layoutState, matchMedia: () => media.query, chatApi: restoredChat }
    });
    expect(await screen.findByRole("tablist", { name: "Question workspace" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Question" }).getAttribute("aria-selected")).toBe("true");
    expect(restoredChat.activate).not.toHaveBeenCalled();
  });
});
