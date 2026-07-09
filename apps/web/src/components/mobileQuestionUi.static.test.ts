import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const componentsDir = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(componentsDir, "..");

function readSource(relativePath: string): string {
  return readFileSync(resolve(srcDir, relativePath), "utf8");
}

describe("Unit 02 mobile-first question UI static contract", () => {
  it("hides the mobile sidebar behind an accessible hamburger menu instead of showing a top list by default", () => {
    const appSource = readSource("App.svelte");
    const sidebarSource = readSource("components/Sidebar.svelte");
    const sidebarClass = sidebarSource.match(/<aside class="([^"]+)"/)?.[1] ?? "";
    const hamburgerButton =
      appSource
        .match(/<button[\s\S]*?<\/button>/g)
        ?.find((button) => /aria-label="(?:Open|Toggle) (?:sidebar|navigation|menu)"/i.test(button)) ?? "";
    const sidebarRenderedInDesktopOnlyWrapper = /<[^>]+class="[^"]*(?:\bhidden\b[^"]*\bmd:(?:block|flex)\b|\bmax-md:hidden\b)[^"]*"[^>]*>\s*<Sidebar\s*\/>\s*<\//.test(
      appSource
    );

    const declaresClosedMobileNavigationState = /let\s+\w*(?:Sidebar|Navigation|Menu)\w*\s*=\s*\$state\(false\)/i.test(appSource);
    const exposesMobileOnlyHamburger = /\bmd:hidden\b/.test(hamburgerButton);
    const hamburgerOpensNavigation =
      /onclick=\{[\s\S]*?(?:=\s*true|=>\s*\w+\s*=\s*!\w+|\w+\s*=\s*!\w+)/.test(hamburgerButton) ||
      (/onclick=\{openMobileNavigation\}/.test(hamburgerButton) && /function\s+openMobileNavigation[\s\S]*?mobileNavigationOpen\s*=\s*true/.test(appSource));
    const defaultSidebarHiddenOnMobile =
      /\bhidden\b(?=[^"]*\bmd:(?:block|flex)\b)/.test(sidebarClass) ||
      /\bmax-md:hidden\b/.test(sidebarClass) ||
      sidebarRenderedInDesktopOnlyWrapper;
    const avoidsMobileTopListSizing = !sidebarClass.includes("max-h-[45vh]");

    expect({
      declaresClosedMobileNavigationState,
      exposesMobileOnlyHamburger,
      hamburgerOpensNavigation,
      defaultSidebarHiddenOnMobile,
      avoidsMobileTopListSizing
    }).toEqual({
      declaresClosedMobileNavigationState: true,
      exposesMobileOnlyHamburger: true,
      hamburgerOpensNavigation: true,
      defaultSidebarHiddenOnMobile: true,
      avoidsMobileTopListSizing: true
    });
  });

  it("closes mobile navigation after selecting a sidebar destination", () => {
    const appSource = readSource("App.svelte");
    const sidebarSource = readSource("components/Sidebar.svelte");
    const sidebarProjectSource = readSource("components/SidebarProject.svelte");
    const mobileNavigationBlock = appSource.slice(appSource.indexOf("{#if mobileNavigationOpen}"));

    expect({
      mobileSidebarReceivesCloseCallback: /<Sidebar\s+onNavigate=\{closeMobileNavigation\}\s*\/>/.test(mobileNavigationBlock),
      sidebarAcceptsNavigateCallback: /onNavigate\??:\s*\(\)\s*=>\s*void/.test(sidebarSource),
      projectSelectionInvokesNavigate: /store\.selectProject\(project\.projectId\)[\s\S]*onNavigate\?\.\(\)/.test(sidebarProjectSource),
      sessionSelectionInvokesNavigate: /store\.selectSession\(sessionId\)[\s\S]*onNavigate\?\.\(\)/.test(sidebarProjectSource),
      questionSelectionInvokesNavigate: /store\.selectRequest\(requestId\)[\s\S]*onNavigate\?\.\(\)/.test(sidebarProjectSource)
    }).toEqual({
      mobileSidebarReceivesCloseCallback: true,
      sidebarAcceptsNavigateCallback: true,
      projectSelectionInvokesNavigate: true,
      sessionSelectionInvokesNavigate: true,
      questionSelectionInvokesNavigate: true
    });
  });

  it("keeps desktop and tablet-wide layouts on a persistent sidebar beside the main view", () => {
    const appSource = readSource("App.svelte");
    const sidebarSource = readSource("components/Sidebar.svelte");
    const shellClass = appSource.match(/<div class="([^"]+)"/)?.[1] ?? "";
    const sidebarClass = sidebarSource.match(/<aside class="([^"]+)"/)?.[1] ?? "";

    expect({
      shellWidensToSideBySideLayout: /\b(?:sm|md|lg|xl):flex-row\b/.test(shellClass),
      sidebarPersistsAtDesktopHeight: /\bmd:h-full\b/.test(sidebarClass),
      sidebarUsesDesktopSideDivider: /\bmd:border-r\b/.test(sidebarClass),
      sidebarHasDesktopWidthConstraint: /\b(?:sm|md|lg|xl):(?:w-|max-w-)\S+/.test(sidebarClass),
      sidebarVisibleOnDesktop: !/\bhidden\b/.test(sidebarClass) || /\bmd:(?:block|flex)\b/.test(sidebarClass)
    }).toEqual({
      shellWidensToSideBySideLayout: true,
      sidebarPersistsAtDesktopHeight: true,
      sidebarUsesDesktopSideDivider: true,
      sidebarHasDesktopWidthConstraint: true,
      sidebarVisibleOnDesktop: true
    });
  });

  it("keeps the question project/branch footer sticky instead of absolutely positioned", () => {
    const source = readSource("components/QuestionLayoutSpotlight.svelte");
    const footerClass = source.match(/<footer class="([^"]+)"/)?.[1] ?? "";

    expect({
      isSticky: /\bsticky\b/.test(footerClass),
      pinsToBottom: /\bbottom-0\b/.test(footerClass),
      notAbsolute: !/\babsolute\b/.test(footerClass)
    }).toEqual({
      isSticky: true,
      pinsToBottom: true,
      notAbsolute: true
    });
  });

  it("keeps context closed by default and opens it as an ease-in-out animated panel with close affordances", () => {
    const source = readSource("components/QuestionLayoutSpotlight.svelte");
    const contextBlock = source.slice(source.indexOf("{#if showContext}"));

    expect({
      closedByDefault: /let\s+showContext\s*=\s*\$state\(false\)/.test(source),
      opensFromContextTrigger: /onclick=\{openContextPanel\}/.test(source),
      escapeCloses: /event\.key\s*===\s*"Escape"\s*&&\s*showContext[\s\S]*?closeContextPanel\(\)/.test(source),
      backdropCloses: /aria-label="Close context"[\s\S]*?onclick=\{closeContextPanel\}/.test(contextBlock),
      closeButtonCloses: /aria-label="Close"[\s\S]*?onclick=\{closeContextPanel\}/.test(contextBlock),
      panelAnimates: /\b(?:transition|animate-|duration-)\b/.test(contextBlock),
      panelUsesEaseInOut: /\bease-in-out\b/.test(contextBlock),
      panelHasDialogSemantics: /<(?:aside|div)[\s\S]*?role="dialog"[\s\S]*?aria-modal="true"[\s\S]*?aria-labelledby="context-panel-title"/.test(
        contextBlock
      ),
      panelHasAccessibleNameSource: /<h2\s+id="context-panel-title"/.test(contextBlock)
    }).toEqual({
      closedByDefault: true,
      opensFromContextTrigger: true,
      escapeCloses: true,
      backdropCloses: true,
      closeButtonCloses: true,
      panelAnimates: true,
      panelUsesEaseInOut: true,
      panelHasDialogSemantics: true,
      panelHasAccessibleNameSource: true
    });
  });

  it("manages focus for modal mobile navigation and context overlays", () => {
    const appSource = readSource("App.svelte");
    const questionSource = readSource("components/QuestionLayoutSpotlight.svelte");
    const focusSource = readSource("lib/modalFocus.ts");
    const mobileNavigationBlock = appSource.slice(appSource.indexOf("{#if mobileNavigationOpen}"));
    const contextBlock = questionSource.slice(questionSource.indexOf("{#if showContext}"));

    expect({
      sharedFocusHelperImported: /import \{ modalFocus \} from "\.\/lib\/modalFocus"/.test(appSource) &&
        /import \{ modalFocus \} from "\.\.\/lib\/modalFocus"/.test(questionSource),
      mobileOpenerCaptured: /mobileNavigationOpener\s*=\s*event\.currentTarget/.test(appSource),
      contextOpenerCaptured: /contextPanelOpener\s*=\s*event\.currentTarget/.test(questionSource),
      mobileDialogUsesFocusHelper: /role="dialog"[\s\S]*?tabindex="-1"[\s\S]*?use:modalFocus=\{mobileNavigationOpener\}/.test(
        mobileNavigationBlock
      ),
      contextDialogUsesFocusHelper: /role="dialog"[\s\S]*?tabindex="-1"[\s\S]*?use:modalFocus=\{contextPanelOpener\}/.test(
        contextBlock
      ),
      mobileInitialFocusAvoidsBackdrop: /aria-label="Close navigation"[\s\S]*?tabindex="-1"[\s\S]*?onclick=\{closeMobileNavigation\}/.test(
        mobileNavigationBlock
      ) && /aria-label="Close navigation"[\s\S]*?data-modal-initial-focus/.test(mobileNavigationBlock),
      contextInitialFocusAvoidsBackdrop: /aria-label="Close context"[\s\S]*?tabindex="-1"[\s\S]*?onclick=\{closeContextPanel\}/.test(
        contextBlock
      ) && /aria-label="Close"[\s\S]*?data-modal-initial-focus/.test(contextBlock),
      nativeFocusablesExcludeNegativeTabindex: [
        /["']a\[href\]:not\(\[tabindex="-1"\]\)["']/,
        /["']area\[href\]:not\(\[tabindex="-1"\]\)["']/,
        /["']button:not\(\[disabled\]\):not\(\[tabindex="-1"\]\)["']/,
        /["']input:not\(\[disabled\]\):not\(\[type="hidden"\]\):not\(\[tabindex="-1"\]\)["']/,
        /["']select:not\(\[disabled\]\):not\(\[tabindex="-1"\]\)["']/,
        /["']textarea:not\(\[disabled\]\):not\(\[tabindex="-1"\]\)["']/,
        /["']\[contenteditable="true"\]:not\(\[tabindex="-1"\]\)["']/
      ].every((selectorPattern) => selectorPattern.test(focusSource)),
      trapsForwardAndReverseTab: /event\.key !== "Tab"/.test(focusSource) && /event\.shiftKey/.test(focusSource),
      restoresFocusOnDestroy: /restoreTarget\?\.isConnected[\s\S]*?focusElement\(restoreTarget\)/.test(focusSource)
    }).toEqual({
      sharedFocusHelperImported: true,
      mobileOpenerCaptured: true,
      contextOpenerCaptured: true,
      mobileDialogUsesFocusHelper: true,
      contextDialogUsesFocusHelper: true,
      mobileInitialFocusAvoidsBackdrop: true,
      contextInitialFocusAvoidsBackdrop: true,
      nativeFocusablesExcludeNegativeTabindex: true,
      trapsForwardAndReverseTab: true,
      restoresFocusOnDestroy: true
    });
  });
});
