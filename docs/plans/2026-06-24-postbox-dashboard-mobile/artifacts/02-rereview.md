# Unit 02 Rereview — current Svelte UI diff

## Findings

1. **Severity:** Medium  
   **Location:** `apps/web/src/App.svelte:21`, `apps/web/src/App.svelte:39`, `apps/web/src/components/QuestionLayoutSpotlight.svelte:52`, `apps/web/src/components/QuestionLayoutSpotlight.svelte:180`  
   **Requirement/pattern violated:** Dialog accessibility for the mobile navigation modal and context panel.  
   **Issue:** Both overlays are exposed as modal dialogs (`role="dialog"`/`aria-modal="true"`), but opening them only flips Svelte state. Focus is not moved into the dialog, focus is not trapped/inerted while the dialog is open, and focus is not restored to the opener on close. For the context panel, the trigger can remain focused behind the overlay and Tab can continue into the underlying question controls before reaching the panel close button. For the mobile navigation overlay, Tab can leave the rendered overlay and continue into `MainView` because the overlay sits before main content in DOM order.  
   **Required fix:** Add modal focus management for both overlays: capture the opener, focus the dialog container or first close/navigation control after open, keep Tab/Shift+Tab within the open overlay or inert/disable background content, and restore focus to the opener on close. A native `<dialog>` or shared modal/action helper is acceptable if it provides equivalent behavior.

## Scope checked

- Mobile hamburger sidebar: `App.svelte` now hides the sidebar behind a mobile-only hamburger and renders the sidebar persistently at `md+`.
- Desktop persistent sidebar: `App.svelte`/`Sidebar.svelte` keep a full-height side sidebar at `md+`.
- Sticky footer: `QuestionLayoutSpotlight.svelte` uses `sticky bottom-0`, not absolute positioning.
- Context default/animation: `showContext` defaults to `false`; the panel opens with ease-in-out fade/fly transitions and close affordances.
- Dialog accessibility: actionable residual issue noted above.

## Validation notes

- Commands run: `git status --short`; `git diff --stat`; `git diff -- ...`; targeted `read` calls; `nl -ba ... | sed ...` for line references.
- No browser/CDP used. No tests or long commands run.

## Residual risks

- This was a static/source review only; no runtime keyboard traversal, screen-reader behavior, viewport screenshots, or browser focus behavior were validated.
