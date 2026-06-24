# Unit 05 RED — PWA install button in sidebar

## changedFiles
- `apps/web/src/pwaInstallButton.static.test.ts`
- `docs/plans/2026-06-24-postbox-pwa-push/artifacts/05-install-button-red.md`

## testsAddedOrUpdated
- `apps/web/src/pwaInstallButton.static.test.ts`
  - `PWA install prompt sidebar button static contract > mounts a PWA install button control in the bottom sidebar chrome`
    - Expects a `PwaInstallButton.svelte` component to exist, be imported by `Sidebar.svelte`, and be rendered inside the existing sidebar `<footer>` alongside the bottom chrome.
  - `PWA install prompt sidebar button static contract > captures beforeinstallprompt and only exposes install UI when the app is not standalone`
    - Expects install-prompt code to listen for `beforeinstallprompt`, call `preventDefault()`, keep the saved prompt event for explicit user action, detect standalone display mode plus iOS `navigator.standalone`, and conditionally render only when installable and not standalone.
  - `PWA install prompt sidebar button static contract > installs from an explicit sidebar button click and records whether the prompt was accepted or dismissed`
    - Expects an explicit install button wired with `onclick`, calls the saved prompt's `prompt()`, waits for `userChoice`, and records `accepted`/`dismissed` outcome state.

## commandsRun
- `npx vitest run apps/web/src/pwaInstallButton.static.test.ts`
  - Result: failed as expected (RED).
- `git diff --cached --quiet; echo $? && git status --short`
  - Result: `0` from `git diff --cached --quiet` (no staged files); status showed existing unstaged/untracked work plus the new RED test file.

## validationOutput
Targeted Vitest command failed with 1 failed file / 3 failed tests:

- `mounts a PWA install button control in the bottom sidebar chrome`
  - `footerRemainsBottomChrome` was already true, proving the existing bottom sidebar footer remains present.
  - `installButtonComponentExists`, `installButtonImportedInSidebar`, and `installButtonRenderedInSidebarFooter` were false because the install button component is not implemented or mounted yet.
- `captures beforeinstallprompt and only exposes install UI when the app is not standalone`
  - All install-prompt capture/standalone gating assertions were false because no install-prompt source exists yet.
- `installs from an explicit sidebar button click and records whether the prompt was accepted or dismissed`
  - All explicit button/click/prompt/userChoice/outcome assertions were false because no install action UI exists yet.

This is the expected RED: the app already has the sidebar footer, but it has no PWA install button, no `beforeinstallprompt` capture, no standalone/PWA suppression, and no explicit install click outcome handling.

## residualRisks
- The test is static/source-contract focused to match the current Node-only Vitest setup and existing web UI test style; it does not exercise a real browser install prompt.
- The test defines `components/PwaInstallButton.svelte` as the expected public UI seam for GREEN. Implementation can keep install-prompt state in that component or in one of the accepted helper files read by the test (`lib/pwaInstallPrompt.ts`, `lib/pwaInstall.ts`, or `lib/installPrompt.ts`).
- Existing dirty/untracked files from prior PWA/push units were present before this RED pass and were not modified by this task.

## noStagedFiles
true
