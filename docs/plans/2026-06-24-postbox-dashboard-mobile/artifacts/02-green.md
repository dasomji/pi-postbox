# Unit 02 GREEN — Mobile-first question UI, sticky footer, animated context

## changedFiles
- `apps/web/src/App.svelte`
- `apps/web/src/components/Sidebar.svelte`
- `apps/web/src/components/QuestionLayoutSpotlight.svelte`
- `docs/plans/2026-06-24-postbox-dashboard-mobile/artifacts/02-green.md`

## testsAddedOrUpdated
- None in GREEN; used existing RED test `apps/web/src/components/mobileQuestionUi.static.test.ts`.

## commandsRun
- `npx vitest run apps/web/src/components/mobileQuestionUi.static.test.ts` — passed.
- `npm run typecheck` — passed.
- `npm run typecheck -w @pi-postbox/web` — passed.
- `npm run build -w @pi-postbox/web` — passed.
- `git diff --cached --name-only` — passed/no output.

## validationOutput
```text
npx vitest run apps/web/src/components/mobileQuestionUi.static.test.ts
Test Files  1 passed (1)
Tests       3 passed (3)

npm run typecheck
tsc -b completed successfully.

npm run typecheck -w @pi-postbox/web
svelte-check found 0 errors and 0 warnings.

npm run build -w @pi-postbox/web
vite v6.4.3 built production web assets successfully; 153 modules transformed.
```

## implementationSummary
- App shell is mobile-first (`flex-col`) and widens to a row layout at `md`.
- Sidebar is full-width and height-capped on mobile, then becomes a bounded-width desktop sidebar at `md` without a fixed always-on `w-80`.
- Question layout now uses normal document flow with a sticky `bottom-0` project/branch footer instead of an absolute footer.
- Primary question actions stack on small screens and return to a row on wider screens.
- Context remains closed by default, opens from the Context trigger, closes via Escape/backdrop/close button, and uses ease-in-out fade/fly transitions with a mobile bottom-sheet shape that becomes a side panel on wider screens.

## residualRisks
- No browser screenshot evidence was captured because project preflight noted Chrome/Chromium may be unavailable; validation is static contract + Svelte typecheck + production build.
- Existing unrelated unstaged/untracked files remain in the worktree from other units/slices (`apps/web/src/lib/store.svelte.ts`, `vitest.config.ts`, `apps/web/src/lib/store.svelte.test.ts`, plus plan/test artifacts). They were not modified by this GREEN slice.

## noStagedFiles
true
