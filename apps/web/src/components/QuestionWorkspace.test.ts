// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import type {
  AskRequestSnapshot,
  QuestionChatActivationResponse,
  QuestionChatSendPayload,
  QuestionChatSnapshot,
  QuestionChatStopPayload
} from "@pi-postbox/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserLayoutState } from "../lib/layout.svelte";
import QuestionDetail from "./QuestionDetail.svelte";

afterEach(cleanup);

const REQUEST: AskRequestSnapshot = {
  requestId: "question-one",
  sessionId: "session-one",
  mode: "single",
  urgency: "normal",
  question: { prompt: "Which path should we take?" },
  options: [{ value: "a", label: "Path A" }],
  status: "pending",
  createdAt: "2026-07-17T12:00:00.000Z"
};

function snapshot(requestId = REQUEST.requestId): QuestionChatSnapshot {
  return {
    requestId,
    state: "ready",
    forkKind: "exact",
    model: { id: "test/model", source: "originating" },
    sequence: 0,
    messages: []
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

function chatBoundary(requestId = REQUEST.requestId, alreadyRunning = false) {
  const active = snapshot(requestId);
  const close = vi.fn();
  return {
    activate: vi.fn(async (): Promise<QuestionChatActivationResponse> => ({ status: "ready", snapshot: active })),
    fetchSnapshot: vi.fn(async () => active),
    probeSnapshot: vi.fn(async () => alreadyRunning
      ? { status: "ready" as const, snapshot: active }
      : { status: "not-started" as const }),
    sendMessage: vi.fn(async (_requestId: string, command: QuestionChatSendPayload) => ({
      status: "accepted" as const,
      clientCommandId: command.clientCommandId,
      mode: "prompt" as const
    })),
    stop: vi.fn(async (_requestId: string, command: QuestionChatStopPayload) => ({
      status: "accepted" as const,
      clientCommandId: command.clientCommandId
    })),
    connectEvents: vi.fn(() => ({ ready: Promise.resolve(), close })),
    close
  };
}

describe("responsive Question Chat workspace", () => {
  it("adds a fixed responsive desktop sidebar and hide/reopens presentation without lifecycle commands", async () => {
    const media = mediaController(false);
    const chatApi = chatBoundary();
    render(QuestionDetail, {
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
    await fireEvent.click(screen.getByRole("button", { name: "Chat" }));

    const sidebar = await screen.findByRole("complementary", { name: "Question Chat sidebar" });
    expect(sidebar.className).toContain("w-[clamp(");
    expect(screen.queryByRole("separator")).toBeNull();
    await fireEvent.click(screen.getByRole("button", { name: "Hide Chat" }));
    expect(screen.queryByRole("complementary", { name: "Question Chat sidebar" })).toBeNull();
    expect(screen.getByRole("region", { name: "Question" })).toBeTruthy();

    await fireEvent.click(screen.getByRole("button", { name: "Open Chat" }));
    expect(await screen.findByRole("complementary", { name: "Question Chat sidebar" })).toBeTruthy();
    expect(chatApi.activate).toHaveBeenCalledOnce();
    expect(chatApi.stop).not.toHaveBeenCalled();
    expect(chatApi.sendMessage).not.toHaveBeenCalled();
    expect(chatApi.close).not.toHaveBeenCalled();

    media.setMatches(true);
    await waitFor(() => expect(screen.getByRole("tablist", { name: "Question workspace" })).toBeTruthy());
    expect(screen.getByRole("tab", { name: "Chat" }).getAttribute("aria-selected")).toBe("true");
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
    await fireEvent.click(screen.getByRole("button", { name: "Hide Chat" }));
    expect(screen.queryByRole("complementary", { name: "Question Chat sidebar" })).toBeNull();
    await fireEvent.click(screen.getByRole("button", { name: "Open Chat" }));
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
    const chatTab = screen.getByRole("tab", { name: "Chat" });
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
    expect((await screen.findByRole("tab", { name: "Chat" })).getAttribute("aria-selected")).toBe("true");
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
