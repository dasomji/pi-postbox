// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import type {
  QuestionChatSendPayload,
  QuestionChatSendResponse,
  QuestionChatSnapshot,
  QuestionChatStreamEvent,
  QuestionChatStopPayload
} from "@pi-postbox/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import QuestionChatActivation from "./QuestionChatActivation.svelte";

afterEach(cleanup);

function snapshot(overrides: Partial<QuestionChatSnapshot> = {}): QuestionChatSnapshot {
  return {
    requestId: "ask-ui",
    state: "ready",
    forkKind: "exact",
    model: { id: "anthropic/claude-sonnet-4", source: "originating" },
    sequence: 0,
    messages: [],
    tools: [],
    ...overrides
  };
}

const noEvents = () => ({ ready: Promise.resolve(), close: () => undefined });

describe("Question Chat first message", () => {
  it("starts explicitly, fetches the fork snapshot, and shows freeform plus three deterministic starters", async () => {
    const activate = vi.fn(async () => ({ status: "ready" as const, snapshot: snapshot() }));
    const fetchSnapshot = vi.fn(async () => snapshot());
    render(QuestionChatActivation, { props: { requestId: "ask-ui", api: { activate, fetchSnapshot, connectEvents: noEvents } } });

    expect(activate).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole("button", { name: "Chat" }));

    expect(await screen.findByRole("heading", { name: "Question Chat" })).toBeTruthy();
    expect(screen.getByLabelText("Message Question Chat")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Elaborate" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pro–Cons" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Teach me" })).toBeTruthy();
    expect(fetchSnapshot).toHaveBeenCalledWith("ask-ui");
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("maps a starter to its fixed instruction and renders the optimistic user message plainly", async () => {
    const sendMessage = vi.fn(async (_requestId: string, command: QuestionChatSendPayload) => ({
      status: "accepted" as const,
      clientCommandId: command.clientCommandId,
      mode: "prompt" as const
    }));
    render(QuestionChatActivation, {
      props: {
        requestId: "ask-ui",
        api: {
          activate: async () => ({ status: "ready" as const, snapshot: snapshot() }),
          fetchSnapshot: async () => snapshot(),
          connectEvents: noEvents,
          sendMessage
        }
      }
    });
    await fireEvent.click(screen.getByRole("button", { name: "Chat" }));
    await fireEvent.click(await screen.findByRole("button", { name: "Elaborate" }));

    expect(sendMessage).toHaveBeenCalledWith("ask-ui", {
      clientCommandId: expect.stringMatching(/^browser-/),
      message: "Explain the asking agent's language and intent in this question."
    });
    expect(screen.getByLabelText("Chat messages").textContent).toContain("Explain the asking agent's language and intent");
  });

  it("sends freeform text with a bounded command ID and never interprets the user message as HTML", async () => {
    const sendMessage = vi.fn(async (_requestId: string, command: QuestionChatSendPayload) => ({
      status: "accepted" as const,
      clientCommandId: command.clientCommandId,
      mode: "prompt" as const
    }));
    render(QuestionChatActivation, {
      props: {
        requestId: "ask-ui",
        api: {
          activate: async () => ({ status: "ready" as const, snapshot: snapshot() }),
          fetchSnapshot: async () => snapshot(),
          connectEvents: noEvents,
          sendMessage
        }
      }
    });
    await fireEvent.click(screen.getByRole("button", { name: "Chat" }));
    const composer = await screen.findByLabelText("Message Question Chat");
    await fireEvent.input(composer, { target: { value: "<img src=x onerror=alert(1)> my **question**" } });
    await fireEvent.click(screen.getByRole("button", { name: "Send" }));

    const command = sendMessage.mock.calls[0]![1];
    expect(command.clientCommandId.length).toBeLessThanOrEqual(128);
    expect(command.message).toBe("<img src=x onerror=alert(1)> my **question**");
    expect(screen.getByLabelText("Chat messages").querySelector("img")).toBeNull();
    expect(screen.getByLabelText("Chat messages").querySelector("strong")).toBeNull();
    expect(screen.getByLabelText("Chat messages").textContent).toContain("<img src=x onerror=alert(1)> my **question**");
  });

  it("buffers stream events until the extension-backed snapshot arrives, then renders safe bounded Markdown", async () => {
    let onEvent!: (event: QuestionChatStreamEvent) => void;
    let finishOpen!: () => void;
    let finishSnapshot!: (value: QuestionChatSnapshot) => void;
    const streamReady = new Promise<void>((resolve) => {
      finishOpen = resolve;
    });
    const fetchSnapshot = vi.fn(() => new Promise<QuestionChatSnapshot>((resolve) => {
      finishSnapshot = resolve;
    }));
    render(QuestionChatActivation, {
      props: {
        requestId: "ask-ui",
        api: {
          activate: async () => ({ status: "ready" as const, snapshot: snapshot() }),
          fetchSnapshot,
          connectEvents: (_requestId: string, listener: (event: QuestionChatStreamEvent) => void) => {
            onEvent = listener;
            return { ready: streamReady, close: () => undefined };
          },
          sendMessage: async (_requestId: string, command: { clientCommandId: string }) => ({
            status: "accepted" as const,
            clientCommandId: command.clientCommandId,
            mode: "prompt" as const
          })
        }
      }
    });
    await fireEvent.click(screen.getByRole("button", { name: "Chat" }));
    expect(fetchSnapshot).not.toHaveBeenCalled();
    finishOpen();
    await waitFor(() => expect(fetchSnapshot).toHaveBeenCalledOnce());
    onEvent({ requestId: "ask-ui", sequence: 5, type: "lifecycle", state: "generating" });
    onEvent({
      requestId: "ask-ui",
      sequence: 6,
      type: "message.started",
      message: { id: "assistant-1", role: "assistant", text: "", status: "streaming" }
    });
    onEvent({
      requestId: "ask-ui",
      sequence: 7,
      type: "assistant.text.delta",
      messageId: "assistant-1",
      text: "# Safe heading\n\n- First item\n- Second item\n\n*Emphasis*\n\n> Useful context\n\n[Docs](https://example.com) [bad](javascript:alert(1)) ![remote](https://example.com/x.png) <img src=x onerror=alert(1)>"
    });
    finishSnapshot(snapshot({ sequence: 4, messages: [{ id: "fork-user", role: "user", text: "From the fork", status: "final" }] }));

    expect(await screen.findByText("From the fork")).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Safe heading" })).toBeTruthy());
    expect(screen.getByLabelText("Chat messages").querySelector("img")).toBeNull();
    expect(screen.getByLabelText("Chat messages").querySelectorAll("li")).toHaveLength(2);
    expect(screen.getByLabelText("Chat messages").querySelector("em")?.textContent).toBe("Emphasis");
    expect(screen.getByLabelText("Chat messages").querySelector("blockquote")?.textContent).toContain("Useful context");
    expect(screen.getByRole("link", { name: "Docs" }).getAttribute("href")).toBe("https://example.com");
    expect(screen.queryByRole("link", { name: "bad" })).toBeNull();
    expect(screen.getByLabelText("Chat messages").textContent).toContain("bad");
    expect(screen.getByLabelText("Chat messages").innerHTML).not.toContain("javascript:");
    expect(screen.getByText("Answering…")).toBeTruthy();
  });

  it("renders compact expandable tool rows as plain text through running and success states", async () => {
    let onEvent!: (event: QuestionChatStreamEvent) => void;
    render(QuestionChatActivation, {
      props: {
        requestId: "ask-ui",
        api: {
          activate: async () => ({ status: "ready" as const, snapshot: snapshot() }),
          fetchSnapshot: async () => snapshot(),
          connectEvents: (_requestId: string, listener: (event: QuestionChatStreamEvent) => void) => {
            onEvent = listener;
            return noEvents();
          }
        }
      }
    });
    await fireEvent.click(screen.getByRole("button", { name: "Chat" }));
    await screen.findByRole("heading", { name: "Question Chat" });

    onEvent({
      requestId: "ask-ui",
      sequence: 1,
      type: "tool.started",
      activity: {
        id: "tool-ui-1",
        tool: "repository_read",
        target: "src/file.ts",
        state: "running",
        details: "reading src/file.ts"
      }
    });
    expect(await screen.findByText("Running")).toBeTruthy();
    expect(screen.getByText("src/file.ts")).toBeTruthy();

    onEvent({
      requestId: "ask-ui",
      sequence: 2,
      type: "tool.finished",
      activity: {
        id: "tool-ui-1",
        tool: "repository_read",
        target: "src/file.ts",
        state: "success",
        details: "<img src=x onerror=alert(1)> bounded evidence"
      }
    });
    expect(await screen.findByText("Success")).toBeTruthy();
    const activity = screen.getByRole("list", { name: "Question Chat activity" });
    expect(activity.querySelector("img")).toBeNull();
    expect(activity.textContent).toContain("<img src=x onerror=alert(1)> bounded evidence");
    expect(activity.querySelector("details")).toBeTruthy();
  });

  it("steers while active, stops one turn with its partial marker, and remains reusable", async () => {
    let onEvent!: (event: QuestionChatStreamEvent) => void;
    const active = snapshot({
      state: "generating",
      messages: [{ id: "assistant-live", role: "assistant", text: "Partial answer", status: "streaming" }]
    });
    const sendMessage = vi
      .fn(async (_requestId: string, command: QuestionChatSendPayload): Promise<QuestionChatSendResponse> => ({
        status: "accepted" as const,
        clientCommandId: command.clientCommandId,
        mode: "prompt" as const
      }))
      .mockResolvedValueOnce({ status: "accepted", clientCommandId: "steer", mode: "steer" });
    const stop = vi.fn(async (_requestId: string, command: QuestionChatStopPayload) => ({
      status: "accepted" as const,
      clientCommandId: command.clientCommandId
    }));
    render(QuestionChatActivation, {
      props: {
        requestId: "ask-ui",
        api: {
          activate: async () => ({ status: "ready" as const, snapshot: active }),
          fetchSnapshot: async () => active,
          connectEvents: (_requestId: string, listener: (event: QuestionChatStreamEvent) => void) => {
            onEvent = listener;
            return noEvents();
          },
          sendMessage,
          stop
        }
      }
    });
    await fireEvent.click(screen.getByRole("button", { name: "Chat" }));
    const composer = await screen.findByLabelText("Message Question Chat");
    expect((composer as HTMLTextAreaElement).disabled).toBe(false);
    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();

    await fireEvent.input(composer, { target: { value: "Correct that detail" } });
    await fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Steering accepted")).toBeTruthy();

    await fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(stop).toHaveBeenCalledWith("ask-ui", { clientCommandId: expect.stringMatching(/^browser-stop-/) });
    expect((await screen.findAllByText("Stopping…")).length).toBeGreaterThan(0);
    onEvent({ requestId: "ask-ui", sequence: 2, type: "message.finished", messageId: "assistant-live", text: "Partial answer", status: "stopped" });
    onEvent({ requestId: "ask-ui", sequence: 3, type: "lifecycle", state: "stopped" });
    onEvent({ requestId: "ask-ui", sequence: 4, type: "lifecycle", state: "ready" });
    expect(await screen.findByText("Stopped")).toBeTruthy();
    expect(screen.getByText("Ready")).toBeTruthy();
    expect(screen.queryByText("Stopping…")).toBeNull();

    await fireEvent.input(composer, { target: { value: "Continue now" } });
    await fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Message sent")).toBeTruthy();
    expect(sendMessage).toHaveBeenLastCalledWith("ask-ui", {
      clientCommandId: expect.stringMatching(/^browser-/),
      message: "Continue now"
    });

    onEvent({
      requestId: "ask-ui",
      sequence: 6,
      type: "message.started",
      message: { id: "assistant-error", role: "assistant", text: "Failed partial", status: "streaming" }
    });
    onEvent({
      requestId: "ask-ui",
      sequence: 7,
      type: "message.finished",
      messageId: "assistant-error",
      text: "Failed partial",
      status: "interrupted"
    });
    onEvent({ requestId: "ask-ui", sequence: 8, type: "lifecycle", state: "interrupted" });
    onEvent({ requestId: "ask-ui", sequence: 9, type: "lifecycle", state: "ready" });
    expect(await screen.findByText("Interrupted")).toBeTruthy();
  });

  it("shows a typed availability message and retries into a disclosed Pi-default fallback", async () => {
    const fallback = snapshot({
      model: { id: "openai/gpt-default", source: "pi-default", fallbackReason: "Originating model is unavailable; using Pi default." }
    });
    const activate = vi.fn().mockResolvedValueOnce({ status: "unavailable", error: { code: "extension_offline", message: "The originating Pi extension is offline." } });
    const probeSnapshot = vi.fn(async () => ({ status: "ready" as const, snapshot: fallback }));
    render(QuestionChatActivation, { props: { requestId: "ask-ui", api: { activate, probeSnapshot, fetchSnapshot: async () => fallback, connectEvents: noEvents } } });

    await fireEvent.click(screen.getByRole("button", { name: "Chat" }));
    expect((await screen.findByRole("alert")).textContent).toContain("originating Pi extension is offline");
    await fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText(/Pi default fallback/)).toBeTruthy();
    expect(screen.getByText(/Originating model is unavailable/)).toBeTruthy();
    expect(activate).toHaveBeenCalledOnce();
    expect(probeSnapshot).toHaveBeenCalledOnce();
  });

  it("preserves rendered messages while offline, disables commands, and explicitly retries snapshot resync", async () => {
    let onEvent!: (event: QuestionChatStreamEvent) => void;
    const prior = snapshot({
      state: "generating",
      sequence: 4,
      messages: [{ id: "prior", role: "assistant", text: "Keep this rendered", status: "streaming" }]
    });
    const recovered = snapshot({
      sequence: 6,
      messages: [{ id: "prior", role: "assistant", text: "Keep this rendered", status: "final" }]
    });
    const fetchSnapshot = vi.fn().mockResolvedValueOnce(prior).mockResolvedValueOnce(recovered);
    render(QuestionChatActivation, {
      props: {
        requestId: "ask-ui",
        api: {
          activate: async () => ({ status: "ready" as const, snapshot: prior }),
          fetchSnapshot,
          connectEvents: (_requestId: string, listener: (event: QuestionChatStreamEvent) => void) => {
            onEvent = listener;
            return noEvents();
          }
        }
      }
    });
    await fireEvent.click(screen.getByRole("button", { name: "Chat" }));
    expect(await screen.findByText("Keep this rendered")).toBeTruthy();
    onEvent({ requestId: "ask-ui", type: "transport", state: "offline" });

    expect(await screen.findByText(/Chat offline/)).toBeTruthy();
    expect(screen.getByText("Keep this rendered")).toBeTruthy();
    expect((screen.getByLabelText("Message Question Chat") as HTMLTextAreaElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Stop" }) as HTMLButtonElement).disabled).toBe(true);
    await fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(fetchSnapshot).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/Chat offline/)).toBeNull();
    expect((screen.getByLabelText("Message Question Chat") as HTMLTextAreaElement).disabled).toBe(false);
  });

  it("detects a runtime sequence gap and resynchronizes instead of applying across it", async () => {
    let onEvent!: (event: QuestionChatStreamEvent) => void;
    const initial = snapshot({ sequence: 4, messages: [{ id: "prior", role: "assistant", text: "Before gap", status: "final" }] });
    const resynced = snapshot({ sequence: 7, messages: [{ id: "after", role: "assistant", text: "Recovered after gap", status: "final" }] });
    const fetchSnapshot = vi.fn().mockResolvedValueOnce(initial).mockResolvedValueOnce(resynced);
    render(QuestionChatActivation, {
      props: {
        requestId: "ask-ui",
        api: {
          activate: async () => ({ status: "ready" as const, snapshot: initial }),
          fetchSnapshot,
          connectEvents: (_requestId: string, listener: (event: QuestionChatStreamEvent) => void) => {
            onEvent = listener;
            return noEvents();
          }
        }
      }
    });
    await fireEvent.click(screen.getByRole("button", { name: "Chat" }));
    expect(await screen.findByText("Before gap")).toBeTruthy();
    onEvent({ requestId: "ask-ui", sequence: 6, type: "lifecycle", state: "generating" });
    expect(await screen.findByText(/Chat stale/)).toBeTruthy();
    await waitFor(() => expect(fetchSnapshot).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Recovered after gap")).toBeTruthy();
    expect(screen.queryByText("Before gap")).toBeNull();
    onEvent({ requestId: "ask-ui", sequence: 7, type: "lifecycle", state: "ready" });
    expect(fetchSnapshot).toHaveBeenCalledTimes(2);
  });

  it("shows Chat unavailable rather than a start button for a fresh browser while the extension is offline", async () => {
    render(QuestionChatActivation, {
      props: {
        requestId: "ask-ui",
        recoveryRequest: 1,
        api: {
          probeSnapshot: async () => ({
            status: "unavailable" as const,
            error: { code: "extension_offline" as const, message: "The originating Pi extension is offline." }
          }),
          connectEvents: noEvents
        }
      }
    });
    expect((await screen.findByRole("alert")).textContent).toContain("extension is offline");
    expect(screen.queryByRole("button", { name: "Chat" })).toBeNull();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("clears one question's ready Chat when the selected request changes", async () => {
    const view = render(QuestionChatActivation, {
      props: {
        requestId: "ask-one",
        api: {
          activate: async (requestId: string) => ({ status: "ready" as const, snapshot: snapshot({ requestId }) }),
          fetchSnapshot: async (requestId: string) => snapshot({ requestId }),
          connectEvents: noEvents
        }
      }
    });
    await fireEvent.click(screen.getByRole("button", { name: "Chat" }));
    expect(await screen.findByRole("heading", { name: "Question Chat" })).toBeTruthy();

    await view.rerender({
      requestId: "ask-two",
      api: {
        activate: async (requestId: string) => ({ status: "ready" as const, snapshot: snapshot({ requestId }) }),
        fetchSnapshot: async (requestId: string) => snapshot({ requestId }),
        connectEvents: noEvents
      }
    });
    expect(await screen.findByRole("button", { name: "Chat" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Question Chat" })).toBeNull();
  });

  it("ignores a stale activation response after the selected request changes", async () => {
    let finishActivation!: (value: { status: "ready"; snapshot: QuestionChatSnapshot }) => void;
    const activate = vi.fn(() => new Promise<{ status: "ready"; snapshot: QuestionChatSnapshot }>((resolve) => {
      finishActivation = resolve;
    }));
    const view = render(QuestionChatActivation, {
      props: { requestId: "ask-one", api: { activate, fetchSnapshot: async (requestId: string) => snapshot({ requestId }), connectEvents: noEvents } }
    });
    await fireEvent.click(screen.getByRole("button", { name: "Chat" }));
    await view.rerender({ requestId: "ask-two", api: { activate, fetchSnapshot: async (requestId: string) => snapshot({ requestId }), connectEvents: noEvents } });
    finishActivation({ status: "ready", snapshot: snapshot({ requestId: "ask-one" }) });

    expect(await screen.findByRole("button", { name: "Chat" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Question Chat" })).toBeNull();
  });

  it("does not create an event connection when activation resolves after unmount", async () => {
    let finishActivation!: (value: { status: "ready"; snapshot: QuestionChatSnapshot }) => void;
    const activate = vi.fn(() => new Promise<{ status: "ready"; snapshot: QuestionChatSnapshot }>((resolve) => {
      finishActivation = resolve;
    }));
    const connectEvents = vi.fn(noEvents);
    const view = render(QuestionChatActivation, {
      props: { requestId: "ask-ui", api: { activate, fetchSnapshot: async () => snapshot(), connectEvents } }
    });
    await fireEvent.click(screen.getByRole("button", { name: "Chat" }));
    view.unmount();
    finishActivation({ status: "ready", snapshot: snapshot() });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(connectEvents).not.toHaveBeenCalled();
  });

  it("does not create an event connection when a recovery probe resolves after unmount", async () => {
    let finishProbe!: (value: { status: "ready"; snapshot: QuestionChatSnapshot }) => void;
    const probeSnapshot = vi.fn(() => new Promise<{ status: "ready"; snapshot: QuestionChatSnapshot }>((resolve) => {
      finishProbe = resolve;
    }));
    const connectEvents = vi.fn(noEvents);
    const view = render(QuestionChatActivation, {
      props: { requestId: "ask-ui", recoveryRequest: 1, api: { probeSnapshot, connectEvents } }
    });
    await waitFor(() => expect(probeSnapshot).toHaveBeenCalledOnce());
    view.unmount();
    finishProbe({ status: "ready", snapshot: snapshot() });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(connectEvents).not.toHaveBeenCalled();
  });
});
