# Unit 02 Hamburger RED — Mobile sidebar behind hamburger

## changedFiles
- `apps/web/src/components/mobileQuestionUi.static.test.ts`
- `docs/plans/2026-06-24-postbox-dashboard-mobile/artifacts/02-hamburger-red.md`

## testsAddedOrUpdated
- `Unit 02 mobile-first question UI static contract > hides the mobile sidebar behind an accessible hamburger menu instead of showing a top list by default`
  - Asserts the app shell declares closed mobile navigation state, exposes a mobile-only hamburger button with an accessible open/toggle label, the hamburger opens navigation, the default sidebar is hidden on mobile, and the old mobile top-list sizing (`max-h-[45vh]`) is gone.
- `Unit 02 mobile-first question UI static contract > keeps desktop and tablet-wide layouts on a persistent sidebar beside the main view`
  - Asserts the shell still widens to side-by-side layout and the sidebar remains full-height, side-divided, width-constrained, and visible at desktop/tablet-wide breakpoints.
- Existing sticky footer and context panel tests were left in place unchanged.

## commandsRun
- `npx vitest run apps/web/src/components/mobileQuestionUi.static.test.ts` — failed as expected (first RED run; mobile top-list detector needed tightening).
- `npx vitest run apps/web/src/components/mobileQuestionUi.static.test.ts` — failed as expected with 1 failing hamburger-sidebar test and 3 passing existing/desktop assertions.
- `git diff --cached --name-only && printf '\n--- short status ---\n' && git status --short` — passed; no cached/staged files were listed before short status output.

## validationOutput
Targeted RED command:

```text
npx vitest run apps/web/src/components/mobileQuestionUi.static.test.ts

apps/web/src/components/mobileQuestionUi.static.test.ts (4 tests | 1 failed)
× hides the mobile sidebar behind an accessible hamburger menu instead of showing a top list by default

Expected all hamburger/mobile-hidden contract flags to be true, but current implementation received:
- declaresClosedMobileNavigationState: false
- exposesMobileOnlyHamburger: false
- hamburgerOpensNavigation: false
- defaultSidebarHiddenOnMobile: false
- avoidsMobileTopListSizing: false

3 tests passed, covering the desktop persistent sidebar plus the existing sticky footer and animated context assertions.
```

This is the intended RED: current `App.svelte` renders `<Sidebar />` directly, has no mobile hamburger/open state, and current `Sidebar.svelte` uses mobile top-list sizing (`max-h-[45vh]`) instead of being hidden by default on mobile.

## residualRisks
- These are static/source-level tests because the project Vitest environment is node-only and no DOM component-test harness is installed.
- The hamburger test intentionally accepts a small set of accessible Tailwind/source signals; an implementation using a different public styling hook may need the test updated while preserving the same behavior contract.
- The working tree already contains unrelated unstaged/untracked files from earlier Unit 02 work; this RED slice only edited the test file and added this artifact.

## noStagedFiles
true
