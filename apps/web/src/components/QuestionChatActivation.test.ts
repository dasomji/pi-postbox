// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import QuestionChatActivation from "./QuestionChatActivation.svelte";

afterEach(cleanup);

describe("Question Chat activation", () => {
  it("does not start until the user explicitly chooses Chat, then shows the ready empty fork", async () => {
    const activate = vi.fn(async () => ({
      status: "ready" as const,
      snapshot: {
        requestId: "ask-ui",
        state: "ready" as const,
        forkKind: "exact" as const,
        model: { id: "anthropic/claude-sonnet-4", source: "originating" as const },
        messages: [] as []
      }
    }));
    render(QuestionChatActivation, { props: { requestId: "ask-ui", activate } });

    expect(activate).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole("button", { name: "Chat" }));

    expect(await screen.findByRole("heading", { name: "Chat ready" })).toBeTruthy();
    expect(screen.getByLabelText("Chat messages").textContent).toContain("No messages yet");
    expect(screen.getByText(/anthropic\/claude-sonnet-4/)).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(activate).toHaveBeenCalledOnce();
  });

  it("shows a typed availability message and can retry into a disclosed Pi-default fallback", async () => {
    const activate = vi
      .fn()
      .mockResolvedValueOnce({
        status: "unavailable",
        error: { code: "extension_offline", message: "The originating Pi extension is offline." }
      })
      .mockResolvedValueOnce({
        status: "ready",
        snapshot: {
          requestId: "ask-ui",
          state: "ready",
          forkKind: "exact",
          model: {
            id: "openai/gpt-default",
            source: "pi-default",
            fallbackReason: "Originating model is unavailable; using Pi default."
          },
          messages: []
        }
      });
    render(QuestionChatActivation, { props: { requestId: "ask-ui", activate } });

    await fireEvent.click(screen.getByRole("button", { name: "Chat" }));
    expect((await screen.findByRole("alert")).textContent).toContain("originating Pi extension is offline");
    await fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText(/Pi default fallback/)).toBeTruthy();
    expect(screen.getByText(/Originating model is unavailable/)).toBeTruthy();
  });

  it("does not show one question's ready state after the selected request changes", async () => {
    const activate = vi.fn(async (requestId: string) => ({
      status: "ready" as const,
      snapshot: {
        requestId,
        state: "ready" as const,
        forkKind: "exact" as const,
        model: { id: "test/model", source: "originating" as const },
        messages: [] as []
      }
    }));
    const view = render(QuestionChatActivation, { props: { requestId: "ask-one", activate } });
    await fireEvent.click(screen.getByRole("button", { name: "Chat" }));
    expect(await screen.findByRole("heading", { name: "Chat ready" })).toBeTruthy();

    await view.rerender({ requestId: "ask-two", activate });
    expect(await screen.findByRole("button", { name: "Chat" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Chat ready" })).toBeNull();
  });

  it("ignores an activation response after the selected request changes", async () => {
    let resolveActivation!: (value: {
      status: "ready";
      snapshot: {
        requestId: string;
        state: "ready";
        forkKind: "exact";
        model: { id: string; source: "originating" };
        messages: [];
      };
    }) => void;
    const activate = vi.fn(
      () =>
        new Promise<Parameters<typeof resolveActivation>[0]>((resolve) => {
          resolveActivation = resolve;
        })
    );
    const view = render(QuestionChatActivation, { props: { requestId: "ask-one", activate } });
    await fireEvent.click(screen.getByRole("button", { name: "Chat" }));
    await view.rerender({ requestId: "ask-two", activate });
    resolveActivation({
      status: "ready",
      snapshot: {
        requestId: "ask-one",
        state: "ready",
        forkKind: "exact",
        model: { id: "test/model", source: "originating" },
        messages: []
      }
    });

    expect(await screen.findByRole("button", { name: "Chat" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Chat ready" })).toBeNull();
  });
});
