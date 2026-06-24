import { afterEach, describe, expect, it, vi } from "vitest";
import { modalFocus } from "./modalFocus";

interface FakeDocument {
  activeElement: FakeElement | null;
}

const fakeDocument: FakeDocument = { activeElement: null };

class FakeElement {
  readonly tagName: string;
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  readonly keydownListeners: Array<(event: KeyboardEvent) => void> = [];
  parent: FakeElement | null = null;
  isConnected = true;
  focused = false;

  constructor(tagName: string, attributes: Record<string, string | boolean> = {}) {
    this.tagName = tagName.toLowerCase();
    for (const [name, value] of Object.entries(attributes)) {
      if (value === false) continue;
      this.attributes.set(name, value === true ? "" : value);
    }
  }

  append(...children: FakeElement[]): this {
    for (const child of children) {
      child.parent = this;
      this.children.push(child);
    }
    return this;
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  querySelector<T extends HTMLElement>(selector: string): T | null {
    return (this.descendants().find((element) => matchesSelectorList(element, selector)) ?? null) as T | null;
  }

  querySelectorAll<T extends HTMLElement>(selector: string): T[] {
    return this.descendants().filter((element) => matchesSelectorList(element, selector)) as unknown as T[];
  }

  addEventListener(type: string, listener: (event: KeyboardEvent) => void): void {
    if (type === "keydown") this.keydownListeners.push(listener);
  }

  removeEventListener(type: string, listener: (event: KeyboardEvent) => void): void {
    if (type !== "keydown") return;
    const index = this.keydownListeners.indexOf(listener);
    if (index >= 0) this.keydownListeners.splice(index, 1);
  }

  contains(node: unknown): boolean {
    return node instanceof FakeElement && (node === this || this.descendants().includes(node));
  }

  focus(): void {
    if (fakeDocument.activeElement) fakeDocument.activeElement.focused = false;
    this.focused = true;
    fakeDocument.activeElement = this;
  }

  dispatchTab(shiftKey = false): { defaultPrevented: boolean } {
    const event = {
      key: "Tab",
      shiftKey,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      }
    } as KeyboardEvent & { defaultPrevented: boolean };

    for (const listener of [...this.keydownListeners]) listener(event);
    return event;
  }

  private descendants(): FakeElement[] {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }
}

function matchesSelectorList(element: FakeElement, selectorList: string): boolean {
  return selectorList.split(",").some((selector) => matchesSelector(element, selector.trim()));
}

function matchesSelector(element: FakeElement, selector: string): boolean {
  if (selector.includes(':not([tabindex="-1"])') && element.getAttribute("tabindex") === "-1") return false;
  if (selector.includes(":not([disabled])") && element.hasAttribute("disabled")) return false;
  if (selector.includes(':not([type="hidden"])') && element.getAttribute("type") === "hidden") return false;

  const positiveSelector = selector.replace(/:not\([^)]+\)/g, "");
  const tagWithAttribute = positiveSelector.match(/^([a-z]+)\[([^=\]]+)(?:="([^"]+)")?\]$/);
  if (tagWithAttribute) {
    const [, tagName, attribute, value] = tagWithAttribute;
    return element.tagName === tagName && element.hasAttribute(attribute) && (value === undefined || element.getAttribute(attribute) === value);
  }

  const attributeOnly = positiveSelector.match(/^\[([^=\]]+)(?:="([^"]+)")?\]$/);
  if (attributeOnly) {
    const [, attribute, value] = attributeOnly;
    return element.hasAttribute(attribute) && (value === undefined || element.getAttribute(attribute) === value);
  }

  return element.tagName === positiveSelector;
}

function installFakeDom(): void {
  fakeDocument.activeElement = null;
  vi.stubGlobal("HTMLElement", FakeElement);
  vi.stubGlobal("document", fakeDocument);
  vi.stubGlobal("window", {
    getComputedStyle: () => ({ display: "block", visibility: "visible" })
  });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("modalFocus", () => {
  it("keeps hamburger navigation tab order on visible controls and restores the opener", () => {
    installFakeDom();
    const opener = new FakeElement("button");
    const backdrop = new FakeElement("button", { tabindex: "-1", "aria-label": "Close navigation" });
    const firstSidebarLink = new FakeElement("a", { href: "/project" });
    const closeButton = new FakeElement("button", { "data-modal-initial-focus": "" });
    const sidebar = new FakeElement("div").append(firstSidebarLink, closeButton);
    const dialog = new FakeElement("div", { tabindex: "-1" }).append(backdrop, sidebar);

    opener.focus();
    const action = modalFocus(dialog as unknown as HTMLElement, opener as unknown as HTMLElement);

    expect(fakeDocument.activeElement).toBe(closeButton);

    const tabFromLast = dialog.dispatchTab();
    expect(tabFromLast.defaultPrevented).toBe(true);
    expect(fakeDocument.activeElement).toBe(firstSidebarLink);

    const shiftTabFromFirst = dialog.dispatchTab(true);
    expect(shiftTabFromFirst.defaultPrevented).toBe(true);
    expect(fakeDocument.activeElement).toBe(closeButton);

    action.destroy();
    expect(fakeDocument.activeElement).toBe(opener);
  });

  it("wraps context panel focus without moving to the tabindex -1 backdrop", () => {
    installFakeDom();
    const backdrop = new FakeElement("button", { tabindex: "-1", "aria-label": "Close context" });
    const closeButton = new FakeElement("button", { "data-modal-initial-focus": "" });
    const contextLink = new FakeElement("a", { href: "/context" });
    const panel = new FakeElement("div", { tabindex: "-1" }).append(closeButton, contextLink);
    const dialog = new FakeElement("div", { tabindex: "-1" }).append(backdrop, panel);

    const action = modalFocus(dialog as unknown as HTMLElement);

    expect(fakeDocument.activeElement).toBe(closeButton);

    closeButton.focus();
    const shiftTabFromFirst = dialog.dispatchTab(true);
    expect(shiftTabFromFirst.defaultPrevented).toBe(true);
    expect(fakeDocument.activeElement).toBe(contextLink);

    contextLink.focus();
    const tabFromLast = dialog.dispatchTab();
    expect(tabFromLast.defaultPrevented).toBe(true);
    expect(fakeDocument.activeElement).toBe(closeButton);

    action.destroy();
    expect(fakeDocument.activeElement).not.toBe(backdrop);
  });
});
