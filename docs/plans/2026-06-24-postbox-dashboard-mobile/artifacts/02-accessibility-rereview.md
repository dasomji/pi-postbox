# Unit 02 Accessibility Rereview

## Scope

Read-only/source rereview after the Unit 02 accessibility repair. Checked:

- `apps/web/src/App.svelte`
- `apps/web/src/components/QuestionLayoutSpotlight.svelte`
- `apps/web/src/lib/modalFocus.ts`
- `apps/web/src/components/mobileQuestionUi.static.test.ts`
- Unit 02 artifacts under `docs/plans/2026-06-24-postbox-dashboard-mobile/artifacts/`

No browser/CDP or runtime keyboard traversal was used.

## Findings

1. **Severity:** Medium  
   **Location:** `apps/web/src/lib/modalFocus.ts:1-8`, `apps/web/src/App.svelte:58-62`, `apps/web/src/App.svelte:69-71`  
   **Requirement/pattern affected:** Modal focus management for the mobile navigation dialog.  
   **Issue:** The repair adds focus movement, focus trapping, and opener restoration, so the previous broad focus-management finding is mostly addressed. However, the shared focus helper still treats native controls with `tabindex="-1"` as trap candidates because `button:not([disabled])` matches them before `[tabindex]:not([tabindex="-1"])` is considered. In the mobile navigation dialog, the backdrop close button is intentionally `tabindex="-1"`, but it remains in `getFocusableElements()`. When focus starts on the visible close button (`data-modal-initial-focus`) and the user presses Tab at the end of the trap, the helper can wrap focus to the full-screen backdrop instead of the first visible sidebar control.  
   **Impact:** Keyboard users can land on an invisible/backdrop control during mobile navigation tab cycling. This is narrower than the original issue but still actionable accessibility friction.  
   **Required fix:** Exclude `tabindex="-1"` from native focusable selector branches, e.g. `button:not([disabled]):not([tabindex="-1"])`, and apply the same pattern to `a`, `input`, `select`, `textarea`, etc. Alternatively, mark modal backdrops with a helper-specific exclusion such as `data-modal-ignore-focus` and filter them out in `getFocusableElements()`.

## Requirements still intact

- Mobile hamburger requirement remains intact in `apps/web/src/App.svelte`: mobile-only top bar/hamburger uses `md:hidden`, desktop sidebar remains in a `hidden md:flex md:h-full md:w-80 md:shrink-0` wrapper, and `mobileNavigationOpen` defaults closed.
- Sticky project/branch footer remains intact in `apps/web/src/components/QuestionLayoutSpotlight.svelte`: footer uses `sticky bottom-0` and remains in normal flow rather than `absolute` positioning.
- Context panel requirements remain intact: `showContext` defaults to `false`; the trigger captures `contextPanelOpener`; Escape/backdrop/close button close the panel; the panel has `role="dialog"`, `aria-modal="true"`, `aria-labelledby="context-panel-title"`, `tabindex="-1"`, `use:modalFocus={contextPanelOpener}`, and ease-in-out fade/fly transitions.
- Static test coverage was updated to include focus-management source contracts and currently asserts imports, opener capture, modal helper usage, initial focus markers, Tab/Shift+Tab handling, and focus restoration.

## Residual risks

- Static/source review only; no browser/CDP keyboard traversal or screen-reader validation was performed.
- The static focus test does not currently catch `tabindex="-1"` native controls being included in the focus trap list.
