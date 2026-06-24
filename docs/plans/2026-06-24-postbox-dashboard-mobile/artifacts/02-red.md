# Unit 02 RED — Mobile-first question UI, sticky footer, animated context

## changedFiles
- `apps/web/src/components/mobileQuestionUi.static.test.ts`
- `docs/plans/2026-06-24-postbox-dashboard-mobile/artifacts/02-red.md`

## testsAddedOrUpdated
- `Unit 02 mobile-first question UI static contract > uses a mobile-first app shell before widening to a desktop sidebar layout`
  - Asserts the app shell starts mobile-first (`flex-col`/grid/wrap), widens at a breakpoint, and the sidebar class is not always fixed desktop `w-80`.
- `Unit 02 mobile-first question UI static contract > keeps the question project/branch footer sticky instead of absolutely positioned`
  - Asserts the question footer class uses `sticky bottom-0` and does not use `absolute`.
- `Unit 02 mobile-first question UI static contract > keeps context closed by default and opens it as an ease-in-out animated panel with close affordances`
  - Asserts context remains closed by default, opens from the Context trigger, closes by Escape/backdrop/close button, and the opened panel has transition/duration/animation plus `ease-in-out`.

## commandsRun
- `npx vitest run apps/web/src/components/mobileQuestionUi.static.test.ts` — failed as expected (initial run before tightening sidebar selector).
- `npx vitest run apps/web/src/components/mobileQuestionUi.static.test.ts` — failed as expected with 3 failing tests.
- `git diff --cached --name-only` — passed/no output, confirming no staged files.

## validationOutput
Targeted RED command:

```text
npx vitest run apps/web/src/components/mobileQuestionUi.static.test.ts

apps/web/src/components/mobileQuestionUi.static.test.ts (3 tests | 3 failed)
× uses a mobile-first app shell before widening to a desktop sidebar layout
  Received shellHasMobileStack=false, shellWidensAtBreakpoint=false,
  sidebarWidthIsResponsive=false, sidebarIsNotAlwaysDesktopWidth=false.
× keeps the question project/branch footer sticky instead of absolutely positioned
  Received isSticky=false, pinsToBottom=true, notAbsolute=false.
× keeps context closed by default and opens it as an ease-in-out animated panel with close affordances
  Received closedByDefault/open/close affordances=true, but panelAnimates=false and panelUsesEaseInOut=false.
```

These failures prove the current UI is still a horizontal desktop shell, the question footer is absolute rather than sticky, and the context panel opens without an ease-in-out animation.

## residualRisks
- Static/source assertions are intentionally used because the current Vitest setup is node-only and there is no component DOM-testing setup in the project.
- The responsive assertions name acceptable Tailwind/source signals; a future implementation using different CSS indirection may need the test updated to point at that public styling hook.
- Existing unrelated unstaged/untracked files were present before this RED slice (`apps/web/src/lib/store.svelte.ts`, `vitest.config.ts`, `apps/web/src/lib/store.svelte.test.ts`, plan docs). They were not modified by this test-writer slice.

## noStagedFiles
true
