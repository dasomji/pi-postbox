const FOCUSABLE_SELECTOR = [
  'a[href]:not([tabindex="-1"])',
  'area[href]:not([tabindex="-1"])',
  'button:not([disabled]):not([tabindex="-1"])',
  'input:not([disabled]):not([type="hidden"]):not([tabindex="-1"])',
  'select:not([disabled]):not([tabindex="-1"])',
  'textarea:not([disabled]):not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]:not([tabindex="-1"])'
].join(",");

function isVisible(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

function focusElement(element: HTMLElement): void {
  element.focus({ preventScroll: true });
}

function getFocusableElements(node: HTMLElement): HTMLElement[] {
  return Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isVisible);
}

function focusInitialElement(node: HTMLElement): void {
  const preferred = node.querySelector<HTMLElement>("[data-modal-initial-focus]");
  if (preferred && isVisible(preferred)) {
    focusElement(preferred);
    return;
  }

  focusElement(getFocusableElements(node)[0] ?? node);
}

export function modalFocus(node: HTMLElement, opener: HTMLElement | null = null) {
  const restoreTarget = opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const frame = requestAnimationFrame(() => focusInitialElement(node));

  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== "Tab") return;

    const focusable = getFocusableElements(node);
    if (focusable.length === 0) {
      event.preventDefault();
      focusElement(node);
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && (active === first || active === node || !node.contains(active))) {
      event.preventDefault();
      focusElement(last);
      return;
    }

    if (!event.shiftKey && (active === last || !node.contains(active))) {
      event.preventDefault();
      focusElement(first);
    }
  }

  node.addEventListener("keydown", onKeydown);

  return {
    destroy(): void {
      cancelAnimationFrame(frame);
      node.removeEventListener("keydown", onKeydown);
      if (restoreTarget?.isConnected) focusElement(restoreTarget);
    }
  };
}
