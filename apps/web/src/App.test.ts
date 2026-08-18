// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App.svelte";
import { BrowserLayoutState } from "./lib/layout.svelte";
import { store } from "./lib/store.svelte";
import { createHealthResponse } from "@pi-postbox/protocol";

beforeEach(() => {
  localStorage.clear();
  store.connection = { status: "checking" };
  vi.stubGlobal("matchMedia", vi.fn((media: string) => ({
    matches: false,
    media,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn()
  })));
  vi.spyOn(store, "start").mockReturnValue(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("authoritative server environment", () => {
  it("shows a persistent accessible development identity on desktop and mobile and changes the title", () => {
    store.connection = {
      status: "connected",
      health: createHealthResponse({
        startedAtMs: 1_000,
        nowMs: 2_000,
        profile: { kind: "development", id: "development:0123456789abcdef" },
        buildId: "dev-build"
      })
    };

    render(App, { props: { layoutState: new BrowserLayoutState(), shortcutPlatform: "other" } });

    expect(document.title).toBe("Pi Postbox — DEV");
    const badges = screen.getAllByText("Development server");
    expect(badges).toHaveLength(2);
    expect(badges[0]?.getAttribute("title")).toContain("development:0123456789abcdef");

    const desktopNavigation = document.querySelector("#desktop-navigation");
    expect(desktopNavigation?.querySelector("header")?.textContent).not.toContain("Development server");
    expect(desktopNavigation?.querySelector("footer")?.textContent).toContain("Development server");
    expect(desktopNavigation?.querySelector("footer")?.textContent?.indexOf("Development server"))
      .toBeLessThan(desktopNavigation?.querySelector("footer")?.textContent?.indexOf("Notifications") ?? -1);
  });

  it("keeps production title and omits the development indicator", () => {
    store.connection = {
      status: "connected",
      health: createHealthResponse({ startedAtMs: 1_000, nowMs: 2_000 })
    };

    render(App, { props: { layoutState: new BrowserLayoutState(), shortcutPlatform: "other" } });

    expect(document.title).toBe("Pi Postbox");
    expect(screen.queryByText("Development server")).toBeNull();
  });
});

describe("desktop navigation layout", () => {
  it("starts open, exposes a visible toggle, and persists the choice for a fresh browser layout", async () => {
    const firstLayout = new BrowserLayoutState();
    const first = render(App, { props: { layoutState: firstLayout, shortcutPlatform: "other" } });

    expect(screen.getByRole("complementary", { name: "Project and question navigation" })).toBeTruthy();
    const hide = screen.getByRole("button", { name: "Hide navigation" });
    await fireEvent.click(hide);
    expect(screen.queryByRole("complementary", { name: "Project and question navigation" })).toBeNull();
    expect(document.getElementById(hide.getAttribute("aria-controls")!)).toBeTruthy();

    first.unmount();
    const restoredLayout = new BrowserLayoutState();
    render(App, { props: { layoutState: restoredLayout, shortcutPlatform: "other" } });
    expect(screen.queryByRole("complementary", { name: "Project and question navigation" })).toBeNull();
    expect(screen.getByRole("button", { name: "Show navigation" })).toBeTruthy();
  });

  it("owns Command+B on macOS and Control+B elsewhere without hijacking repeats, editors, or the wrong modifier", async () => {
    const macLayout = new BrowserLayoutState();
    const mac = render(App, { props: { layoutState: macLayout, shortcutPlatform: "mac" } });

    await fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(macLayout.navigationOpen).toBe(true);
    await fireEvent.keyDown(window, { key: "b", metaKey: true, repeat: true });
    expect(macLayout.navigationOpen).toBe(true);
    await fireEvent.keyDown(window, { key: "b", metaKey: true, shiftKey: true });
    expect(macLayout.navigationOpen).toBe(true);
    const editor = document.createElement("input");
    document.body.append(editor);
    await fireEvent.keyDown(editor, { key: "b", metaKey: true });
    expect(macLayout.navigationOpen).toBe(true);
    await fireEvent.keyDown(window, { key: "b", metaKey: true });
    expect(macLayout.navigationOpen).toBe(false);
    mac.unmount();

    localStorage.clear();
    const otherLayout = new BrowserLayoutState();
    render(App, { props: { layoutState: otherLayout, shortcutPlatform: "other" } });
    await fireEvent.keyDown(window, { key: "b", metaKey: true });
    expect(otherLayout.navigationOpen).toBe(true);
    await fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(otherLayout.navigationOpen).toBe(false);
  });
});

describe("mobile project navigation", () => {
  it("remains a separate accessible drawer from the Question workspace", async () => {
    render(App, { props: { layoutState: new BrowserLayoutState(), shortcutPlatform: "other" } });

    await fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    const drawer = screen.getByRole("dialog", { name: "Navigation" });
    expect(drawer.querySelector('[role="tab"]')).toBeNull();
    await fireEvent.click(screen.getAllByRole("button", { name: "Close navigation" }).at(-1)!);
    expect(screen.queryByRole("dialog", { name: "Navigation" })).toBeNull();
  });
});
