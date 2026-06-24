# Unit 05 GREEN — PWA install button in sidebar

## changedFiles
- `apps/web/src/components/PwaInstallButton.svelte`
- `apps/web/src/components/Sidebar.svelte`
- `docs/plans/2026-06-24-postbox-pwa-push/artifacts/05-install-button-green.md`

## testsAddedOrUpdated
- None in GREEN. Used existing RED coverage in `apps/web/src/pwaInstallButton.static.test.ts`.

## commandsRun
- `npx vitest run apps/web/src/pwaInstallButton.static.test.ts`
  - Result: failed before implementation as expected: 1 failed file / 3 failed tests.
- `npx vitest run apps/web/src/pwaInstallButton.static.test.ts`
  - Result: passed after implementation: 1 passed file / 3 passed tests.
- `npm run typecheck -w @pi-postbox/web`
  - Result: passed: `svelte-check found 0 errors and 0 warnings`.
- `npm run build -w @pi-postbox/web`
  - Result: passed: Vite production build completed.
- `npx vitest run apps/web/src/pwaInstallButton.static.test.ts && npm run typecheck -w @pi-postbox/web && npm run build -w @pi-postbox/web`
  - Result: passed after the final handler refinement.
- `git diff --cached --quiet; echo $?`
  - Result: `0` (no staged files).
- `git status --short`
  - Result: showed the expected existing unstaged/untracked PWA/push work plus this unit's new component and green artifact; no staged files.

## validationOutput
- Targeted install button test: `apps/web/src/pwaInstallButton.static.test.ts` passed all 3 tests.
- Web typecheck: `svelte-check found 0 errors and 0 warnings`.
- Web build: Vite transformed 157 modules and built successfully.

## implementationNotes
- Added `PwaInstallButton.svelte`, which captures `beforeinstallprompt`, calls `preventDefault()`, stores the deferred prompt for explicit user action, detects standalone display mode via `matchMedia("(display-mode: standalone)")`, detects iOS `navigator.standalone`, and hides/clears install UI in standalone mode.
- The install button is rendered only when `canInstall && !isStandalone`; clicking it calls the saved prompt, awaits `userChoice`, records `accepted`/`dismissed`, and clears the one-shot prompt.
- Mounted the control inside the existing sidebar footer with the notification control and Decision history button so the mobile sidebar still uses the existing flex/sidebar footer layout.

## residualRisks
- Browser install prompts are vendor-controlled and were validated here with existing static/source-contract tests plus web typecheck/build, not a real Chromium install prompt session.
- The working tree already contains other unstaged/untracked PWA/push unit files outside this GREEN slice; they were not staged by this task.

## noStagedFiles
true
